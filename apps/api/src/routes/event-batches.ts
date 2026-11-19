import {
  eventBatchCreateSchema,
  eventBatchPatchSchema,
  type EventBatchCreate,
  type EventBatchPatch,
  type EventBatchView,
} from '@mbc/shared';
import { Router, type Response } from 'express';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { DETAIL_INCLUDE, eventDetailOf } from './event-setup.js';

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const UUID = /^[0-9a-f-]{36}$/i;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Batches of an event (decision 2026-11-19): named groups of delegates, each on one of the
 * event's days. Admin-only; every change is audited. Deleting a batch leaves its delegates in
 * the event with no batch, that is, on every day.
 */
export function eventBatchesRouter({ prisma, middleware }: Deps): Router {
  const router = Router();
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, dates: { select: { id: true, date: true } } },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  function editable(event: { status: string }) {
    if (event.status === 'archived') {
      throw new HttpError(409, 'event_archived', 'An archived event cannot be changed.');
    }
  }

  async function listOf(eventId: string): Promise<EventBatchView[]> {
    const rows = await prisma().eventBatch.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        eventDateId: true,
        order: true,
        eventDate: { select: { date: true } },
        _count: { select: { delegates: true } },
      },
      orderBy: [{ eventDate: { date: 'asc' } }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      eventDateId: b.eventDateId,
      date: isoDate(b.eventDate.date),
      order: b.order,
      delegates: b._count.delegates,
    }));
  }

  /** The event as the admin screens read it, so a change lands without a reload. */
  async function detailOf(eventId: string) {
    return eventDetailOf(
      await prisma().event.findUniqueOrThrow({ where: { id: eventId }, include: DETAIL_INCLUDE }),
    );
  }

  function dateOf(event: { dates: Array<{ id: string }> }, eventDateId: string) {
    if (!event.dates.some((d) => d.id === eventDateId)) {
      throw new HttpError(422, 'date_not_in_event', 'Choose one of the event’s own dates.');
    }
    return eventDateId;
  }

  router.get('/events/:eventId/batches', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    res.json({ batches: await listOf(event.id), event: await detailOf(event.id) });
  });

  router.post(
    '/events/:eventId/batches',
    guard,
    validate(eventBatchCreateSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      editable(event);
      const input = req.body as EventBatchCreate;
      const eventDateId = dateOf(event, input.eventDateId);
      const clash = await prisma().eventBatch.findFirst({
        where: { eventId: event.id, name: { equals: input.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'batch_exists', 'A batch with this name exists.');
      const last = await prisma().eventBatch.aggregate({
        where: { eventId: event.id },
        _max: { order: true },
      });
      const created = await prisma().$transaction(async (tx) => {
        const row = await tx.eventBatch.create({
          data: {
            eventId: event.id,
            eventDateId,
            name: input.name,
            order: (last._max.order ?? 0) + 1,
          },
          select: { id: true },
        });
        await audit(tx, {
          action: 'event.batch_created',
          entityType: 'event_batch',
          entityId: row.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { batchId: row.id, name: input.name, eventDateId },
          ...clientOf(res),
        });
        return row;
      });
      res
        .status(201)
        .json({ batch: created, batches: await listOf(event.id), event: await detailOf(event.id) });
    },
  );

  router.patch(
    '/events/:eventId/batches/:batchId',
    guard,
    validate(eventBatchPatchSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      editable(event);
      const batchId = String(req.params.batchId);
      const current = await prisma().eventBatch.findFirst({
        where: { id: UUID.test(batchId) ? batchId : undefined, eventId: event.id },
        select: { id: true, name: true, eventDateId: true },
      });
      if (!current) throw new HttpError(404, 'not_found', 'Batch not found.');
      const patch = req.body as EventBatchPatch;
      const name = patch.name ?? current.name;
      const eventDateId = patch.eventDateId
        ? dateOf(event, patch.eventDateId)
        : current.eventDateId;
      if (patch.name && patch.name.toLowerCase() !== current.name.toLowerCase()) {
        const clash = await prisma().eventBatch.findFirst({
          where: { eventId: event.id, name: { equals: patch.name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (clash) throw new HttpError(409, 'batch_exists', 'A batch with this name exists.');
      }
      await prisma().$transaction(async (tx) => {
        await tx.eventBatch.update({ where: { id: current.id }, data: { name, eventDateId } });
        await audit(tx, {
          action: 'event.batch_updated',
          entityType: 'event_batch',
          entityId: current.id,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: { name: current.name, eventDateId: current.eventDateId },
          newValue: { name, eventDateId },
          ...clientOf(res),
        });
      });
      res.json({ batches: await listOf(event.id), event: await detailOf(event.id) });
    },
  );

  router.delete('/events/:eventId/batches/:batchId', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    editable(event);
    const batchId = String(req.params.batchId);
    const current = await prisma().eventBatch.findFirst({
      where: { id: UUID.test(batchId) ? batchId : undefined, eventId: event.id },
      select: { id: true, name: true, _count: { select: { delegates: true } } },
    });
    if (!current) throw new HttpError(404, 'not_found', 'Batch not found.');
    await prisma().$transaction(async (tx) => {
      // The delegates stay, on every day of the event (batch_id is set null by the database).
      await tx.eventBatch.delete({ where: { id: current.id } });
      await audit(tx, {
        action: 'event.batch_deleted',
        entityType: 'event_batch',
        entityId: current.id,
        eventId: event.id,
        actorUserId: principal.userId,
        oldValue: { name: current.name, delegates: current._count.delegates },
        ...clientOf(res),
      });
    });
    res.json({ batches: await listOf(event.id), event: await detailOf(event.id) });
  });

  return router;
}
