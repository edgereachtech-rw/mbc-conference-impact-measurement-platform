import type { ImportRefusalReason, ImportResolutionRequest } from '@mbc/shared';

import type { ClientContext } from '../auth/service.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';
import type { RowValues } from './normalise.js';
import type { Actor } from './service.js';

/**
 * Conflict resolution (backlog D5 "Valid actions", D5.1, D9 audit contract).
 *
 * One decision, one transaction: the row and the row's normalised address are locked, the row,
 * the run, the event, the address ownership and the registrations of the event are re-read, the
 * action is validated against the conflict reason and the ownership rule, and only then is anything
 * written. `import.conflict_resolved` is written inside the transaction; a refusal writes
 * `import.resolution_refused` and a failure after acceptance writes `import.resolution_failed`,
 * both outside it. A refusal response carries a reason category and never a record of another
 * identity.
 *
 * Nothing here creates a current address for a historical or provisional one, creates a user
 * account, changes an identity's canonical email, or moves a registration between identities.
 */

export interface ResolutionHooks {
  /** Test hook: runs inside the transaction after validation and before any write. */
  beforeResolutionWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export interface ConflictResolverDeps {
  prisma: () => PrismaClient;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  now?: () => Date;
  hooks?: ResolutionHooks;
}

export interface ResolutionOutcome {
  row: ResolvedRowSummary;
  /** True when the same decision had already been applied and nothing changed. */
  alreadyResolved: boolean;
}

export interface ResolvedRowSummary {
  id: string;
  runId: string;
  rowNumber: number;
  resolution: ImportResolutionRequest['action'];
  resolvedAt: Date | null;
  identityId: string | null;
  delegateId: string | null;
}

const ROW_SELECT = {
  id: true,
  runId: true,
  rowNumber: true,
  resolution: true,
  resolvedAt: true,
  identityId: true,
  delegateId: true,
} as const;

/** A refusal: audited outside the transaction, answered with a reason category only. */
class Refused extends Error {
  constructor(public readonly reason: ImportRefusalReason) {
    super(reason);
    this.name = 'Refused';
  }
}

const REFUSAL_MESSAGES: Record<ImportRefusalReason, string> = {
  row_not_resolvable: 'This row is not an open conflict of a committed run.',
  already_resolved: 'This row has already been resolved with a different decision.',
  action_not_valid_for_conflict: 'That action is not valid for this type of conflict.',
  confirmation_missing: 'Record the required confirmation before applying this action.',
  address_reserved: 'This address belongs to another identity; it cannot be attached or created.',
  under_migration_review:
    'This address is reserved pending a migration decision; only reject or correct the source.',
  identity_not_found: 'The identity to link to does not exist.',
  account_inactive:
    'The identity’s account is inactive; reactivate it first (E2-13), then link the row.',
  registration_exists:
    'A registration for this person or address already exists in the event; re-import the corrected file instead.',
  other_rows_unresolved:
    'Resolve the other rows that share this email in the same file first (reject or correct the source).',
  event_archived: 'The event is archived; nothing can be added to it.',
};

export function refusalMessage(reason: ImportRefusalReason): string {
  return REFUSAL_MESSAGES[reason];
}

export class ConflictResolver {
  private readonly now: () => Date;

  constructor(private readonly deps: ConflictResolverDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get prisma(): PrismaClient {
    return this.deps.prisma();
  }

  async resolve(
    rowId: string,
    request: ImportResolutionRequest,
    actor: Actor,
    client: ClientContext,
  ): Promise<ResolutionOutcome> {
    // Pre-read outside the transaction only to answer 404 and to carry run/event ids into audits.
    const head = await this.prisma.importRow.findUnique({
      where: { id: rowId },
      select: { id: true, runId: true, run: { select: { eventId: true } } },
    });
    if (!head) throw new HttpError(404, 'not_found', 'Import row not found.');
    const eventId = head.run.eventId;

    try {
      const outcome = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:row:${rowId}`}))`;
          const row = await tx.importRow.findUniqueOrThrow({
            where: { id: rowId },
            include: { run: { select: { id: true, eventId: true, source: true, status: true } } },
          });
          if (row.outcome !== 'conflict' || row.run.status !== 'committed') {
            throw new Refused('row_not_resolvable');
          }
          if (row.resolution) {
            // Safe retry: the same decision answers with the stored result; a different one is refused.
            if (row.resolution === request.action && sameTarget(row.identityId, request)) {
              return { row: summary(row), alreadyResolved: true };
            }
            throw new Refused('already_resolved');
          }
          const values = row.values as RowValues | null;
          if (!values) throw new Refused('row_not_resolvable');
          const email = values.email;
          // Serialise on the address like the import commit and (later) the email-change workflow.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email:${email}`}))`;

          const event = await tx.event.findUniqueOrThrow({
            where: { id: row.run.eventId },
            select: { status: true },
          });
          if (event.status === 'archived') throw new Refused('event_archived');

          const reason = row.reasonCode ?? '';
          const action = request.action;

          // Reject and correct-the-source are always available (D5).
          if (action === 'reject' || action === 'correct_source') {
            await this.deps.hooks?.beforeResolutionWrite?.(tx);
            const updated = await tx.importRow.update({
              where: { id: rowId },
              data: {
                resolution: action,
                resolvedAt: this.now(),
                resolvedByUserId: actor.userId,
                resolutionNote: request.note ?? null,
              },
              select: ROW_SELECT,
            });
            await audit(tx, {
              action: 'import.conflict_resolved',
              entityType: 'import_row',
              entityId: rowId,
              eventId: row.run.eventId,
              actorUserId: actor.userId,
              newValue: { runId: row.runId, rowId, row: row.rowNumber, action, reason },
              ...client,
            });
            return { row: summary(updated), alreadyResolved: false };
          }

          // Ownership of the address, read fresh under the lock (D5.1 invariants 3, 9).
          const owner = await tx.identityEmail.findUnique({
            where: { emailNormalised: email },
            select: {
              identityId: true,
              kind: true,
              identity: { select: { userAccount: { select: { status: true } } } },
            },
          });
          if (owner?.kind === 'provisional' || reason === 'address_under_migration_review') {
            throw new Refused('under_migration_review');
          }

          // In-file conflicts: link or create only once the other rows of that email are settled.
          if (reason === 'shared_email_in_file' || reason === 'inconsistent_repeat') {
            const siblings = await tx.importRow.findMany({
              where: { runId: row.runId, outcome: 'conflict', id: { not: rowId } },
              select: { values: true, resolution: true },
            });
            const open = siblings.filter((s) => {
              const v = s.values as RowValues | null;
              return (
                v?.email === email && s.resolution !== 'reject' && s.resolution !== 'correct_source'
              );
            });
            if (open.length > 0) throw new Refused('other_rows_unresolved');
          }

          if (action === 'create_identity') {
            if (!request.differentPerson) throw new Refused('confirmation_missing');
            // Never for rules 2 and 3 (owned addresses), never for a historical address (invariant 3).
            if (reason === 'email_owned_by_other_identity' || reason === 'name_mismatch') {
              throw new Refused('action_not_valid_for_conflict');
            }
            if (reason === 'previous_email_of_identity' || reason === 'inactive_account') {
              throw new Refused('action_not_valid_for_conflict');
            }
            if (owner) throw new Refused('address_reserved');
            await this.assertNoRegistration(tx, row.run.eventId, row.run.source, values, null);
            await this.deps.hooks?.beforeResolutionWrite?.(tx);
            const now = this.now();
            const identity = await tx.delegateIdentity.create({
              data: { displayName: values.name },
              select: { id: true },
            });
            const delegate = await this.createRegistration(
              tx,
              row.run.eventId,
              row.run.source,
              identity.id,
              null,
              values,
              now,
            );
            const updated = await tx.importRow.update({
              where: { id: rowId },
              data: {
                resolution: action,
                resolvedAt: now,
                resolvedByUserId: actor.userId,
                resolutionNote: request.note ?? null,
                identityId: identity.id,
                delegateId: delegate.id,
              },
              select: ROW_SELECT,
            });
            const entry = await audit(tx, {
              action: 'import.conflict_resolved',
              entityType: 'import_row',
              entityId: rowId,
              eventId: row.run.eventId,
              actorUserId: actor.userId,
              newValue: {
                runId: row.runId,
                rowId,
                row: row.rowNumber,
                action,
                reason,
                differentPerson: true,
                identityId: identity.id,
                delegateId: delegate.id,
              },
              ...client,
            });
            await tx.identityEmail.create({
              data: {
                identityId: identity.id,
                emailNormalised: email,
                kind: 'current',
                evidence: 'admin_decision',
                auditLogId: entry.id,
                actorUserId: actor.userId,
              },
            });
            await audit(tx, {
              action: 'identity.created',
              entityType: 'delegate_identity',
              entityId: identity.id,
              eventId: row.run.eventId,
              actorUserId: actor.userId,
              newValue: { identityId: identity.id, runId: row.runId, rowId },
              ...client,
            });
            await audit(tx, {
              action: 'delegate.imported',
              entityType: 'delegate',
              entityId: delegate.id,
              eventId: row.run.eventId,
              actorUserId: actor.userId,
              newValue: {
                delegateId: delegate.id,
                identityId: identity.id,
                runId: row.runId,
                rowId,
              },
              ...client,
            });
            return { row: summary(updated), alreadyResolved: false };
          }

          // link_existing
          if (!request.samePerson) throw new Refused('confirmation_missing');
          if (reason === 'external_id_mismatch' || reason === 'email_owned_by_other_identity') {
            throw new Refused('action_not_valid_for_conflict');
          }
          // The address must be this identity's own (current or historical) or nobody's.
          if (owner && owner.identityId !== request.identityId)
            throw new Refused('address_reserved');
          const identity = await tx.delegateIdentity.findUnique({
            where: { id: request.identityId },
            select: { id: true, userAccountId: true, userAccount: { select: { status: true } } },
          });
          if (!identity) throw new Refused('identity_not_found');
          if (identity.userAccount?.status === 'inactive') throw new Refused('account_inactive');
          await this.assertNoRegistration(tx, row.run.eventId, row.run.source, values, identity.id);
          await this.deps.hooks?.beforeResolutionWrite?.(tx);
          const now = this.now();
          const delegate = await this.createRegistration(
            tx,
            row.run.eventId,
            row.run.source,
            identity.id,
            identity.userAccountId,
            values,
            now,
          );
          const updated = await tx.importRow.update({
            where: { id: rowId },
            data: {
              resolution: action,
              resolvedAt: now,
              resolvedByUserId: actor.userId,
              resolutionNote: request.note ?? null,
              identityId: identity.id,
              delegateId: delegate.id,
            },
            select: ROW_SELECT,
          });
          const entry = await audit(tx, {
            action: 'import.conflict_resolved',
            entityType: 'import_row',
            entityId: rowId,
            eventId: row.run.eventId,
            actorUserId: actor.userId,
            newValue: {
              runId: row.runId,
              rowId,
              row: row.rowNumber,
              action,
              reason,
              samePerson: true,
              identityId: identity.id,
              delegateId: delegate.id,
            },
            ...client,
          });
          if (!owner) {
            // An unowned address attached by an admin decision is reserved to the identity as
            // history: it never becomes a current (sign-in) address through an import path.
            await tx.identityEmail.create({
              data: {
                identityId: identity.id,
                emailNormalised: email,
                kind: 'historical',
                evidence: 'admin_decision',
                auditLogId: entry.id,
                actorUserId: actor.userId,
              },
            });
          }
          await audit(tx, {
            action: 'identity.linked',
            entityType: 'delegate_identity',
            entityId: identity.id,
            eventId: row.run.eventId,
            actorUserId: actor.userId,
            newValue: { identityId: identity.id, delegateId: delegate.id, runId: row.runId, rowId },
            ...client,
          });
          await audit(tx, {
            action: 'delegate.imported',
            entityType: 'delegate',
            entityId: delegate.id,
            eventId: row.run.eventId,
            actorUserId: actor.userId,
            newValue: { delegateId: delegate.id, identityId: identity.id, runId: row.runId, rowId },
            ...client,
          });
          return { row: summary(updated), alreadyResolved: false };
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
      this.deps.logger.info(
        { rowId, runId: head.runId, action: request.action, retry: outcome.alreadyResolved },
        'import conflict resolved',
      );
      return outcome;
    } catch (error) {
      if (error instanceof Refused) {
        await this.writeOutsideTx(
          'import.resolution_refused',
          head.runId,
          rowId,
          eventId,
          actor,
          client,
          request.action,
          error.reason,
        );
        throw new HttpError(409, 'resolution_refused', refusalMessage(error.reason));
      }
      this.deps.logger.error(
        { rowId, runId: head.runId, name: error instanceof Error ? error.name : 'unknown' },
        'import conflict resolution failed; transaction rolled back',
      );
      captureException(error, { requestId: `import-row:${rowId}` });
      await this.writeOutsideTx(
        'import.resolution_failed',
        head.runId,
        rowId,
        eventId,
        actor,
        client,
        request.action,
        'internal_error',
      );
      throw new HttpError(
        500,
        'resolution_failed',
        'The decision could not be applied. Nothing was changed; you can try again.',
      );
    }
  }

  /** Refusal and failure events in their own write, after the rollback (D9). */
  private async writeOutsideTx(
    action: 'import.resolution_refused' | 'import.resolution_failed',
    runId: string,
    rowId: string,
    eventId: string,
    actor: Actor,
    client: ClientContext,
    requested: string,
    reason: string,
  ): Promise<void> {
    try {
      await audit(this.prisma, {
        action,
        entityType: 'import_row',
        entityId: rowId,
        eventId,
        actorUserId: actor.userId,
        newValue: { runId, rowId, action: requested, reason },
        ...client,
      });
    } catch (error) {
      this.deps.logger.error(
        { rowId, action, reason },
        'resolution audit entry could not be written',
      );
      captureException(error, { requestId: `import-row:${rowId}` });
    }
  }

  /** No non-duplicate registration may already hold this address, this external id, or this identity in the event. */
  private async assertNoRegistration(
    tx: Prisma.TransactionClient,
    eventId: string,
    source: string,
    values: RowValues,
    identityId: string | null,
  ): Promise<void> {
    const clash = await tx.delegate.findFirst({
      where: {
        eventId,
        registrationStatus: { not: 'duplicate' },
        OR: [
          { email: { equals: values.email, mode: 'insensitive' } },
          ...(values.externalRegistrationId
            ? [
                {
                  registrationSource: source,
                  externalRegistrationId: values.externalRegistrationId,
                },
              ]
            : []),
          ...(identityId ? [{ identityId }] : []),
        ],
      },
      select: { id: true },
    });
    if (clash) throw new Refused('registration_exists');
  }

  private createRegistration(
    tx: Prisma.TransactionClient,
    eventId: string,
    source: string,
    identityId: string,
    userAccountId: string | null,
    v: RowValues,
    now: Date,
  ) {
    return tx.delegate.create({
      data: {
        eventId,
        identityId,
        userAccountId,
        name: v.name,
        email: v.email,
        organisation: v.organisation,
        jobTitle: v.jobTitle,
        country: v.country,
        attendanceFormat: v.attendanceFormat,
        capacity: v.capacity,
        nominatingOrganisation: v.nominatingOrganisation,
        registrationStatus: v.registrationStatus,
        registrationSource: source,
        externalRegistrationId: v.externalRegistrationId,
        importedAt: now,
      },
      select: { id: true },
    });
  }
}

function sameTarget(storedIdentityId: string | null, request: ImportResolutionRequest): boolean {
  return request.action !== 'link_existing' || request.identityId === storedIdentityId;
}

function summary(row: {
  id: string;
  runId: string;
  rowNumber: number;
  resolution: ImportResolutionRequest['action'] | null;
  resolvedAt: Date | null;
  identityId: string | null;
  delegateId: string | null;
}): ResolvedRowSummary {
  return {
    id: row.id,
    runId: row.runId,
    rowNumber: row.rowNumber,
    resolution: row.resolution ?? 'reject',
    resolvedAt: row.resolvedAt,
    identityId: row.identityId,
    delegateId: row.delegateId,
  };
}
