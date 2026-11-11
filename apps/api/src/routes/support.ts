import {
  groupBarriers,
  supportRequestCreateSchema,
  supportRequestUpdateSchema,
  type MySupportRequest,
  type SupportRequestView,
  type SupportRequests,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const UUID = /^[0-9a-f-]{36}$/i;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function validated<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      next(new HttpError(422, 'validation_failed', detail));
      return;
    }
    req.body = parsed.data;
    next();
  };
}

const REQUEST_INCLUDE = {
  delegate: { select: { id: true, name: true, email: true, organisation: true } },
} satisfies Prisma.SupportRequestInclude;
type RequestRow = Prisma.SupportRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/**
 * Transfer support (brief 11.7; backlog E13): the organisers see who asked for support, what
 * for, the barrier behind it, what was done, and whether it is still open. Requests come from
 * follow-up answers (see `support/requests.ts`) and from the delegate's own plan page.
 */
export function supportRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);
  const eligible = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
    const event = await prisma().event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  /** The action titles and who addressed what, looked up once for a list. */
  async function decorate(rows: RequestRow[]) {
    const actionIds = rows.map((r) => r.actionId).filter((id): id is string => Boolean(id));
    const userIds = rows.map((r) => r.addressedByUserId).filter((id): id is string => Boolean(id));
    const [actions, users] = await Promise.all([
      actionIds.length
        ? prisma().transferPlanAction.findMany({
            where: { id: { in: actionIds } },
            select: { id: true, action: true },
          })
        : [],
      userIds.length
        ? prisma().userAccount.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true },
          })
        : [],
    ]);
    const actionOf = new Map(actions.map((a) => [a.id, a.action]));
    const userOf = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r): SupportRequestView => ({
      id: r.id,
      eventId: r.eventId,
      delegate: r.delegate,
      source: r.source,
      kind: r.kind,
      context: r.context,
      action: r.actionId ? (actionOf.get(r.actionId) ?? null) : null,
      request: r.request,
      barrier: r.barrier,
      status: r.status,
      actionTaken: r.actionTaken,
      addressedBy: r.addressedByUserId ? (userOf.get(r.addressedByUserId) ?? null) : null,
      addressedAt: iso(r.addressedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- organisers

  router.get('/events/:eventId/support-requests', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const rows = await prisma().supportRequest.findMany({
      where: { eventId: event.id, delegate: { registrationStatus: { in: [...eligible()] } } },
      include: REQUEST_INCLUDE,
      // Open ones first, newest first within each.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    const requests = await decorate(rows);
    const body: SupportRequests = {
      requests,
      counts: {
        open: requests.filter((r) => r.status === 'open').length,
        addressed: requests.filter((r) => r.status === 'addressed').length,
        openSupport: requests.filter((r) => r.status === 'open' && r.kind === 'support').length,
        openBarriers: requests.filter((r) => r.status === 'open' && r.kind === 'barrier').length,
      },
      // Every barrier named: the barrier items, plus what a delegate wrote in the "what is in
      // the way" box of a request asked from the plan page (a follow-up's barrier beside a
      // request is already its own item).
      barriers: groupBarriers(
        requests.map((r) =>
          r.kind === 'barrier' ? r.request : r.source === 'delegate' ? r.barrier : '',
        ),
      ),
    };
    res.json(body);
  });

  router.patch(
    '/events/:eventId/support-requests/:requestId',
    guard,
    validated(supportRequestUpdateSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const requestId = String(req.params.requestId);
      if (!UUID.test(requestId)) throw new HttpError(404, 'not_found', 'Request not found.');
      const input = req.body as z.infer<typeof supportRequestUpdateSchema>;
      const existing = await prisma().supportRequest.findFirst({
        where: { id: requestId, eventId: event.id },
        select: { id: true, status: true },
      });
      if (!existing) throw new HttpError(404, 'not_found', 'Request not found.');
      const at = clock();
      const row = await prisma().$transaction(async (tx) => {
        const updated = await tx.supportRequest.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            actionTaken: input.actionTaken,
            // Addressing stamps who and when; reopening clears both.
            addressedAt: input.status === 'addressed' ? at : null,
            addressedByUserId: input.status === 'addressed' ? principal.userId : null,
          },
          include: REQUEST_INCLUDE,
        });
        await audit(tx, {
          action: 'support_request.updated',
          entityType: 'support_request',
          entityId: updated.id,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: { status: existing.status },
          newValue: { status: updated.status, actionTakenLength: input.actionTaken.length },
          ...clientOf(res),
        });
        return updated;
      });
      res.json({ request: (await decorate([row]))[0] });
    },
  );

  // ---------------------------------------------------------------- delegates

  async function myRegistration(res: Response, eventId: string) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate' || !principal.identityId) {
      throw new HttpError(403, 'forbidden', 'Support requests belong to delegates.');
    }
    if (!UUID.test(eventId))
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    const delegate = await prisma().delegate.findFirst({
      where: {
        eventId,
        identityId: principal.identityId,
        registrationStatus: { in: [...eligible()] },
        event: { status: 'active' },
      },
      select: { id: true, eventId: true },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    return { principal, delegate };
  }

  const mine = (rows: SupportRequestView[]): MySupportRequest[] =>
    rows.map(({ delegate: _delegate, ...rest }) => rest);

  router.get('/me/events/:eventId/support-requests', middleware.requireAuth, async (req, res) => {
    const { delegate } = await myRegistration(res, String(req.params.eventId));
    const rows = await prisma().supportRequest.findMany({
      where: { eventId: delegate.eventId, delegateId: delegate.id },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests: mine(await decorate(rows)) });
  });

  router.post(
    '/me/events/:eventId/support-requests',
    middleware.requireAuth,
    validated(supportRequestCreateSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const input = req.body as z.infer<typeof supportRequestCreateSchema>;
      // The action named must be one of the delegate's own.
      if (input.actionId) {
        const action = await prisma().transferPlanAction.findFirst({
          where: {
            id: input.actionId,
            plan: { eventId: delegate.eventId, delegateId: delegate.id },
          },
          select: { id: true },
        });
        if (!action)
          throw new HttpError(422, 'validation_failed', 'actionId: not one of your actions.');
      }
      const row = await prisma().$transaction(async (tx) => {
        const created = await tx.supportRequest.create({
          data: {
            eventId: delegate.eventId,
            delegateId: delegate.id,
            source: 'delegate',
            actionId: input.actionId,
            context: 'Transfer plan page',
            request: input.request,
            barrier: input.barrier,
          },
          include: REQUEST_INCLUDE,
        });
        await audit(tx, {
          action: 'support_request.created',
          entityType: 'support_request',
          entityId: created.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: { source: 'delegate', withAction: Boolean(input.actionId) },
          ...clientOf(res),
        });
        return created;
      });
      res.status(201).json({ request: mine(await decorate([row]))[0] });
    },
  );

  return router;
}
