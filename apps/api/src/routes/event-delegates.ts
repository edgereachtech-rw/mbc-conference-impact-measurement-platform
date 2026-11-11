import {
  delegateCreateSchema,
  delegateListQuerySchema,
  delegateListStatuses,
  delegateTestMarkSchema,
  type DelegateCreate,
  type DelegateCreateResult,
  type DelegateListItem,
  type DelegateListQuery,
  type DelegateListStatus,
} from '@mbc/shared';
import { Router } from 'express';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canWriteDelegate, DELEGATE_READ_ROLES, hasRole } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { normaliseNameKey } from '../imports/normalise.js';
import { audit } from '../lib/audit.js';
import { normaliseEmail } from '../lib/email.js';
import { HttpError } from '../lib/errors.js';
import { delegateSearchFilter, displayOrganisation } from '../lib/organisation.js';

const UUID = /^[0-9a-f-]{36}$/i;

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const LIST_FIELDS = {
  id: true,
  name: true,
  email: true,
  organisation: true,
  nominatingOrganisation: true,
  jobTitle: true,
  country: true,
  attendanceFormat: true,
  capacity: true,
  registrationStatus: true,
  registrationSource: true,
  externalRegistrationId: true,
  identityId: true,
  signedUpAt: true,
  importedAt: true,
  createdAt: true,
} as const;

type ListRow = Prisma.DelegateGetPayload<{ select: typeof LIST_FIELDS }>;

/** A delegate without an organisation of their own is shown under the nominating one. */
function toListItem({ nominatingOrganisation, ...r }: ListRow): DelegateListItem {
  return {
    ...r,
    organisation: displayOrganisation({ organisation: r.organisation, nominatingOrganisation }),
    signedUpAt: r.signedUpAt ? r.signedUpAt.toISOString() : null,
    importedAt: r.importedAt ? r.importedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Delegate listing per event for the admin console (E2-6 subset): search, filter by status and
 * format, sort, paginate. Admin-only; every record of the event is in scope for an admin (E3-6).
 */
export function eventDelegateRouter({ prisma, middleware }: Deps): Router {
  const router = Router();

  router.get(
    '/events/:eventId/delegates',
    middleware.requireRole(...DELEGATE_READ_ROLES),
    async (req, res) => {
      if (!hasRole(principalOf(res), DELEGATE_READ_ROLES)) {
        throw new HttpError(403, 'forbidden', 'Admins only.');
      }
      const parsed = delegateListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new HttpError(422, 'validation_failed', detail);
      }
      const query: DelegateListQuery = parsed.data;
      const eventId = String(req.params.eventId);
      const event = await prisma().event.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (!event) throw new HttpError(404, 'not_found', 'Event not found.');

      const where: Prisma.DelegateWhereInput = {
        eventId,
        ...(query.status ? { registrationStatus: query.status } : {}),
        ...(query.attendanceFormat ? { attendanceFormat: query.attendanceFormat } : {}),
        ...(query.q ? delegateSearchFilter(query.q) : {}),
      };
      const orderBy: Prisma.DelegateOrderByWithRelationInput[] = [
        { [query.sort]: query.direction } as Prisma.DelegateOrderByWithRelationInput,
        { id: 'asc' },
      ];
      const [rows, total, grouped] = await Promise.all([
        prisma().delegate.findMany({
          where,
          select: LIST_FIELDS,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma().delegate.count({ where }),
        prisma().delegate.groupBy({
          by: ['registrationStatus'],
          where: { eventId },
          _count: { _all: true },
        }),
      ]);
      const counts = Object.fromEntries(delegateListStatuses.map((s) => [s, 0])) as Record<
        DelegateListStatus,
        number
      >;
      for (const g of grouped) counts[g.registrationStatus as DelegateListStatus] = g._count._all;
      const delegates = rows.map(toListItem);
      res.json({ delegates, page: query.page, pageSize: query.pageSize, total, counts });
    },
  );

  /**
   * Adds one delegate by hand (decision 2026-11-12): a registration that came by no file. The
   * person's identity is found by their address or created, under the rules an import applies
   * (backlog D5): a current address links its identity when the name is the same person's; a
   * previous or provisional address, another person's name on the address, or a deactivated
   * account refuses; a second registration of the person in the event refuses. Nothing is
   * emailed: the invitation is sent from the Delegates tab as for an imported delegate.
   */
  router.post(
    '/events/:eventId/delegates',
    middleware.requireRole(...DELEGATE_READ_ROLES),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canWriteDelegate(principal)) throw new HttpError(403, 'forbidden', 'Read-only role.');
      const parsed = delegateCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new HttpError(
          422,
          'validation_failed',
          `${issue?.path.join('.')}: ${issue?.message}`,
        );
      }
      const input: DelegateCreate = parsed.data;
      const eventId = String(req.params.eventId);
      const event = await prisma().event.findUnique({
        where: { id: eventId },
        select: { id: true, status: true },
      });
      if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
      if (event.status === 'archived') {
        throw new HttpError(
          409,
          'event_archived',
          'Delegates cannot be added to an archived event.',
        );
      }
      const email = normaliseEmail(input.email);

      const result = await prisma().$transaction(async (tx) => {
        // Ownership of the address (D5.1): one identity per address, across every kind.
        const owner = await tx.identityEmail.findUnique({
          where: { emailNormalised: email },
          select: {
            identityId: true,
            kind: true,
            identity: {
              select: {
                displayName: true,
                userAccountId: true,
                userAccount: { select: { status: true } },
              },
            },
          },
        });
        if (owner && owner.kind !== 'current') {
          throw new HttpError(
            409,
            'email_not_current',
            'This is a previous or provisional address of a person already on the platform. Use their current address.',
          );
        }
        if (
          owner &&
          normaliseNameKey(owner.identity.displayName) !== normaliseNameKey(input.name)
        ) {
          throw new HttpError(
            409,
            'name_mismatch',
            `This address already belongs to ${owner.identity.displayName}. Check the name; a different person needs a different address.`,
          );
        }
        if (owner?.identity.userAccount?.status === 'inactive') {
          throw new HttpError(
            409,
            'account_inactive',
            'This person’s account is deactivated. Reactivate it under Staff and accounts before adding a registration.',
          );
        }
        const clash = await tx.delegate.findFirst({
          where: {
            eventId,
            registrationStatus: { not: 'duplicate' },
            OR: [
              { email: { equals: email, mode: 'insensitive' } },
              ...(owner ? [{ identityId: owner.identityId }] : []),
            ],
          },
          select: { id: true },
        });
        if (clash) {
          throw new HttpError(
            409,
            'registration_exists',
            'This person is already registered for this event.',
          );
        }

        let identityId: string;
        let userAccountId: string | null = null;
        let identity: DelegateCreateResult['identity'];
        if (owner) {
          identityId = owner.identityId;
          userAccountId = owner.identity.userAccountId;
          identity = 'linked';
        } else {
          const created = await tx.delegateIdentity.create({
            data: { displayName: input.name },
            select: { id: true },
          });
          identityId = created.id;
          identity = 'created';
          const entry = await audit(tx, {
            action: 'identity.created',
            entityType: 'delegate_identity',
            entityId: identityId,
            eventId,
            actorUserId: principal.userId,
            newValue: { identityId, by: 'admin' },
            ...clientOf(res),
          });
          await tx.identityEmail.create({
            data: {
              identityId,
              emailNormalised: email,
              kind: 'current',
              evidence: 'admin_decision',
              auditLogId: entry.id,
              actorUserId: principal.userId,
            },
          });
        }
        const row = await tx.delegate.create({
          data: {
            eventId,
            identityId,
            userAccountId,
            name: input.name,
            email,
            organisation: input.organisation,
            nominatingOrganisation: input.nominatingOrganisation,
            jobTitle: input.jobTitle,
            country: input.country,
            attendanceFormat: input.attendanceFormat,
            capacity: input.capacity,
            registrationStatus: input.registrationStatus,
            registrationSource: 'manual',
          },
          select: LIST_FIELDS,
        });
        if (identity === 'linked') {
          await audit(tx, {
            action: 'identity.linked',
            entityType: 'delegate_identity',
            entityId: identityId,
            eventId,
            actorUserId: principal.userId,
            newValue: { identityId, delegateId: row.id, by: 'admin' },
            ...clientOf(res),
          });
        }
        // E2-4 / E17-4: who, when and which record; the values themselves stay on the record.
        await audit(tx, {
          action: 'delegate.created',
          entityType: 'delegate',
          entityId: row.id,
          eventId,
          actorUserId: principal.userId,
          newValue: { delegateId: row.id, identityId, identity, source: 'manual' },
          ...clientOf(res),
        });
        return { row, identity };
      });
      const body: DelegateCreateResult = {
        delegate: toListItem(result.row),
        identity: result.identity,
      };
      res.status(201).json(body);
    },
  );

  /**
   * Marks registrations as test delegates, or back to real ones (decision of 2026-11-05). Test
   * delegates are imported like everyone else; this is the one place they are told apart. Only
   * active ↔ test switches: a pending, cancelled or duplicate registration is skipped and counted,
   * so a careless "select all" cannot revive a cancellation.
   */
  router.post(
    '/events/:eventId/delegates/test',
    middleware.requireRole(...DELEGATE_READ_ROLES),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canWriteDelegate(principal)) throw new HttpError(403, 'forbidden', 'Read-only role.');
      const parsed = delegateTestMarkSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new HttpError(
          422,
          'validation_failed',
          `${issue?.path.join('.')}: ${issue?.message}`,
        );
      }
      const { delegateIds, test } = parsed.data;
      const eventId = String(req.params.eventId);
      if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
      const from = test ? 'active' : 'test';
      const to = test ? 'test' : 'active';
      const result = await prisma().$transaction(async (tx) => {
        const rows = await tx.delegate.findMany({
          where: { id: { in: delegateIds }, eventId },
          select: { id: true, registrationStatus: true },
        });
        const switching = rows.filter((r) => r.registrationStatus === from).map((r) => r.id);
        if (switching.length) {
          await tx.delegate.updateMany({
            where: { id: { in: switching } },
            data: { registrationStatus: to },
          });
          await audit(tx, {
            action: 'delegate.test_marked',
            entityType: 'event',
            entityId: eventId,
            eventId,
            actorUserId: principal.userId,
            // Counts and the direction only: never names or addresses.
            newValue: { to, updated: switching.length, skipped: rows.length - switching.length },
            ...clientOf(res),
          });
        }
        return { updated: switching.length, skipped: delegateIds.length - switching.length };
      });
      res.json(result);
    },
  );

  return router;
}
