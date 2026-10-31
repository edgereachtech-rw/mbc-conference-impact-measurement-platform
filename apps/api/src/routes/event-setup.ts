import {
  assessmentStageConfigSchema,
  assessmentStages,
  eventCodeFromName,
  eventCreateSchema,
  eventDatesSchema,
  eventPatchSchema,
  eventProfileIssues,
  eventPublishIssues,
  eventStatusSchema,
  sessionCreateSchema,
  sessionPatchSchema,
  sessionTimeIssue,
  sortIsoDates,
  type AssessmentStage,
  type EventDetail,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fromIsoDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

const DETAIL_INCLUDE = {
  dates: { orderBy: { date: 'asc' as const } },
  sessions: {
    include: { eventDate: { select: { date: true } } },
  },
  assessmentStages: {
    include: { _count: { select: { questions: { where: { retiredAt: null } } } } },
  },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** The event as every admin screen reads it: profile, dates in order, sessions by date and time, stages in order. */
export function eventDetailOf(event: EventRow): EventDetail {
  const stageOrder = new Map(assessmentStages.map((s, i) => [s, i]));
  const sessions = [...event.sessions]
    .map((s) => ({
      id: s.id,
      eventDateId: s.eventDateId,
      date: isoDate(s.eventDate.date),
      title: s.title,
      sessionType: s.sessionType,
      startTime: s.startTime,
      endTime: s.endTime,
      description: s.description,
      venue: s.venue,
      speaker: s.speaker,
      capacity: s.capacity,
      feedbackEnabled: s.feedbackEnabled,
      transferPlanningFinal: s.transferPlanningFinal,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.startTime.localeCompare(b.startTime) ||
        a.title.localeCompare(b.title),
    );
  return {
    id: event.id,
    code: event.slug,
    slug: event.slug,
    name: event.name,
    description: event.description,
    eventType: event.eventType,
    organiser: event.organiser,
    format: event.format,
    timezone: event.timezone,
    theme: event.theme,
    location: event.location,
    website: event.website,
    imageUrl: event.imageUrl,
    additionalInfo: event.additionalInfo,
    status: event.status,
    startsOn: isoDate(event.startsOn),
    endsOn: isoDate(event.endsOn),
    dates: event.dates.map((d) => ({ id: d.id, date: isoDate(d.date) })),
    sessions,
    assessmentStages: [...event.assessmentStages]
      .sort((a, b) => (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0))
      .map((s) => ({
        stage: s.stage,
        enabled: s.enabled,
        opensAt: s.opensAt ? s.opensAt.toISOString() : null,
        closesAt: s.closesAt ? s.closesAt.toISOString() : null,
        target: s.target,
        targetGroup: s.targetGroup,
        status: s.status,
        questionCount: s._count.questions,
        updatedAt: s.updatedAt.toISOString(),
      })),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export async function loadEventDetail(
  prisma: PrismaClient,
  eventId: string,
): Promise<EventDetail | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: DETAIL_INCLUDE });
  return event ? eventDetailOf(event) : null;
}

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

/**
 * Event creation and configuration (backlog E1, brief of 2026-10-30), M.Bryan admins only:
 * structured profile, individually selected dates, optional sessions bound to those dates, three
 * independently configured assessment stages, and publication. Every change is audited.
 */
export function eventSetupRouter({ prisma, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEditable(eventId: string) {
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      include: DETAIL_INCLUDE,
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    if (event.status === 'archived') {
      throw new HttpError(409, 'event_archived', 'An archived event cannot be changed.');
    }
    return event;
  }

  /** Keeps the derived start and end in step with the selected dates (brief section 4). */
  function derivedRange(dates: readonly string[]) {
    const sorted = sortIsoDates(dates);
    return { startsOn: fromIsoDate(sorted[0]!), endsOn: fromIsoDate(sorted[sorted.length - 1]!) };
  }

  /** The name's code, or the first free "-2", "-3"… variant when another event already has it. */
  async function uniqueCode(name: string): Promise<string> {
    const base = eventCodeFromName(name);
    const taken = new Set(
      (
        await prisma().event.findMany({
          where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
          select: { slug: true },
        })
      ).map((e) => e.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; n < 10_000; n += 1) {
      if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
    }
    throw new HttpError(409, 'code_taken', 'No free event code could be generated from this name.');
  }

  // ---------------------------------------------------------------- code preview

  /** The code a name would get right now, so the form can show it before saving. */
  router.get('/events/code-preview', guard, async (req, res) => {
    requireAdmin(res);
    const name = String(req.query.name ?? '').trim();
    if (!name) {
      res.json({ base: null, code: null, available: true });
      return;
    }
    const base = eventCodeFromName(name);
    const code = await uniqueCode(name);
    res.json({ base, code, available: code === base });
  });

  // ---------------------------------------------------------------- create

  router.post('/events', guard, validated(eventCreateSchema), async (req, res) => {
    const principal = requireAdmin(res);
    const input = req.body as z.infer<typeof eventCreateSchema>;
    const profileIssues = eventProfileIssues(input);
    if (profileIssues.length) throw new HttpError(422, 'validation_failed', profileIssues[0]!);
    const dates = sortIsoDates(input.dates);
    const { dates: _dates, ...profile } = input;
    const code = await uniqueCode(profile.name);
    const created = await prisma().$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          slug: code,
          ...profile,
          ...derivedRange(dates),
          status: 'draft',
          dates: { create: dates.map((date) => ({ date: fromIsoDate(date) })) },
          assessmentStages: { create: assessmentStages.map((stage) => ({ stage })) },
          participationCategories: {
            create:
              profile.format === 'hybrid'
                ? [
                    { code: 'physical', name: 'In person' },
                    { code: 'virtual', name: 'Virtual' },
                  ]
                : [
                    {
                      code: profile.format === 'virtual' ? 'virtual' : 'physical',
                      name: profile.format === 'virtual' ? 'Virtual' : 'In person',
                    },
                  ],
          },
        },
        include: DETAIL_INCLUDE,
      });
      await audit(tx, {
        action: 'event.created',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: { code, name: profile.name, eventType: profile.eventType, dates },
        ...clientOf(res),
      });
      return event;
    });
    res.status(201).json({ event: eventDetailOf(created) });
  });

  // ---------------------------------------------------------------- profile

  router.patch('/events/:eventId', guard, validated(eventPatchSchema), async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEditable(String(req.params.eventId));
    const patch = req.body as z.infer<typeof eventPatchSchema>;
    const fields = patch;
    const merged = {
      format: fields.format ?? event.format,
      location: fields.location === undefined ? event.location : fields.location,
    };
    const profileIssues = eventProfileIssues(merged);
    if (profileIssues.length) throw new HttpError(422, 'validation_failed', profileIssues[0]!);
    if (Object.keys(fields).length === 0) {
      // Nothing to change (for example only a read-only field was sent): no update, no audit row.
      res.json({ event: eventDetailOf(event) });
      return;
    }
    const data: Prisma.EventUpdateInput = { ...fields };
    const updated = await prisma().$transaction(async (tx) => {
      const row = await tx.event.update({ where: { id: event.id }, data, include: DETAIL_INCLUDE });
      await audit(tx, {
        action: 'event.updated',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        oldValue: Object.fromEntries(
          Object.keys(patch).map((k) => [k, (event as Record<string, unknown>)[k] ?? null]),
        ) as Prisma.InputJsonValue,
        newValue: patch as Prisma.InputJsonValue,
        ...clientOf(res),
      });
      return row;
    });
    res.json({ event: eventDetailOf(updated) });
  });

  // ---------------------------------------------------------------- dates

  router.put('/events/:eventId/dates', guard, validated(eventDatesSchema), async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEditable(String(req.params.eventId));
    const wanted = sortIsoDates((req.body as z.infer<typeof eventDatesSchema>).dates);
    const current = new Map(event.dates.map((d) => [isoDate(d.date), d]));
    const removed = [...current.keys()].filter((d) => !wanted.includes(d));
    const added = wanted.filter((d) => !current.has(d));
    const blocked = removed
      .map((d) => ({
        date: d,
        sessions: event.sessions.filter((s) => s.eventDateId === current.get(d)!.id).length,
      }))
      .filter((d) => d.sessions > 0);
    if (blocked.length) {
      throw new HttpError(
        409,
        'dates_have_sessions',
        `Move or delete the sessions on ${blocked.map((b) => `${b.date} (${b.sessions})`).join(', ')} before removing ${blocked.length === 1 ? 'that date' : 'those dates'}.`,
      );
    }
    const updated = await prisma().$transaction(async (tx) => {
      if (removed.length) {
        await tx.eventDate.deleteMany({
          where: { eventId: event.id, date: { in: removed.map(fromIsoDate) } },
        });
      }
      if (added.length) {
        await tx.eventDate.createMany({
          data: added.map((date) => ({ eventId: event.id, date: fromIsoDate(date) })),
        });
      }
      const row = await tx.event.update({
        where: { id: event.id },
        data: derivedRange(wanted),
        include: DETAIL_INCLUDE,
      });
      await audit(tx, {
        action: 'event.dates_changed',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        oldValue: { dates: [...current.keys()].sort() },
        newValue: { dates: wanted, added, removed },
        ...clientOf(res),
      });
      return row;
    });
    res.json({ event: eventDetailOf(updated) });
  });

  // ---------------------------------------------------------------- sessions

  router.post(
    '/events/:eventId/sessions',
    guard,
    validated(sessionCreateSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEditable(String(req.params.eventId));
      const input = req.body as z.infer<typeof sessionCreateSchema>;
      const eventDate = event.dates.find((d) => isoDate(d.date) === input.date);
      if (!eventDate) {
        throw new HttpError(
          422,
          'date_not_in_event',
          'Sessions can only be scheduled on one of the event’s selected dates.',
        );
      }
      const { date: _date, ...fields } = input;
      const updated = await prisma().$transaction(async (tx) => {
        const session = await tx.eventSession.create({
          data: { ...fields, eventId: event.id, eventDateId: eventDate.id },
          select: { id: true },
        });
        await audit(tx, {
          action: 'event.session_created',
          entityType: 'event_session',
          entityId: session.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { ...fields, date: input.date } as Prisma.InputJsonValue,
          ...clientOf(res),
        });
        return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: DETAIL_INCLUDE });
      });
      res.status(201).json({ event: eventDetailOf(updated) });
    },
  );

  router.patch(
    '/events/:eventId/sessions/:sessionId',
    guard,
    validated(sessionPatchSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEditable(String(req.params.eventId));
      const session = event.sessions.find((s) => s.id === String(req.params.sessionId));
      if (!session) throw new HttpError(404, 'not_found', 'Session not found.');
      const patch = req.body as z.infer<typeof sessionPatchSchema>;
      const timeIssue = sessionTimeIssue(
        patch.startTime ?? session.startTime,
        patch.endTime ?? session.endTime,
      );
      if (timeIssue) throw new HttpError(422, 'validation_failed', timeIssue);
      let eventDateId = session.eventDateId;
      if (patch.date !== undefined) {
        const eventDate = event.dates.find((d) => isoDate(d.date) === patch.date);
        if (!eventDate) {
          throw new HttpError(
            422,
            'date_not_in_event',
            'Sessions can only be scheduled on one of the event’s selected dates.',
          );
        }
        eventDateId = eventDate.id;
      }
      const { date: _date, ...fields } = patch;
      const updated = await prisma().$transaction(async (tx) => {
        await tx.eventSession.update({
          where: { id: session.id },
          data: { ...fields, eventDateId },
        });
        await audit(tx, {
          action: 'event.session_updated',
          entityType: 'event_session',
          entityId: session.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: patch as Prisma.InputJsonValue,
          ...clientOf(res),
        });
        return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: DETAIL_INCLUDE });
      });
      res.json({ event: eventDetailOf(updated) });
    },
  );

  router.delete('/events/:eventId/sessions/:sessionId', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEditable(String(req.params.eventId));
    const session = event.sessions.find((s) => s.id === String(req.params.sessionId));
    if (!session) throw new HttpError(404, 'not_found', 'Session not found.');
    const updated = await prisma().$transaction(async (tx) => {
      await tx.eventSession.delete({ where: { id: session.id } });
      await audit(tx, {
        action: 'event.session_deleted',
        entityType: 'event_session',
        entityId: session.id,
        eventId: event.id,
        actorUserId: principal.userId,
        oldValue: { title: session.title, date: isoDate(session.eventDate.date) },
        ...clientOf(res),
      });
      return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: DETAIL_INCLUDE });
    });
    res.json({ event: eventDetailOf(updated) });
  });

  // ---------------------------------------------------------------- assessment stages

  router.put(
    '/events/:eventId/assessments/:stage',
    guard,
    validated(assessmentStageConfigSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = String(req.params.stage) as AssessmentStage;
      if (!assessmentStages.includes(stage)) {
        throw new HttpError(404, 'not_found', 'Unknown assessment stage.');
      }
      const event = await loadEditable(String(req.params.eventId));
      const input = req.body as z.infer<typeof assessmentStageConfigSchema>;
      const data = {
        enabled: input.enabled,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        target: input.target,
        targetGroup: input.target === 'group' ? (input.targetGroup ?? null) : null,
        status: input.status,
      };
      const previous = event.assessmentStages.find((s) => s.stage === stage);
      if (
        (input.status === 'open' || input.status === 'scheduled') &&
        (previous?._count.questions ?? 0) === 0
      ) {
        throw new HttpError(
          422,
          'stage_without_questions',
          'Add at least one question before scheduling or opening this stage.',
        );
      }
      const updated = await prisma().$transaction(async (tx) => {
        await tx.assessmentStageConfig.upsert({
          where: { eventId_stage: { eventId: event.id, stage } },
          create: { eventId: event.id, stage, ...data },
          update: data,
        });
        await audit(tx, {
          action: 'event.assessment_configured',
          entityType: 'assessment_stage_config',
          entityId: previous?.id ?? null,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: previous
            ? {
                stage,
                enabled: previous.enabled,
                opensAt: previous.opensAt?.toISOString() ?? null,
                closesAt: previous.closesAt?.toISOString() ?? null,
                target: previous.target,
                status: previous.status,
              }
            : null,
          newValue: { stage, ...input } as Prisma.InputJsonValue,
          ...clientOf(res),
        });
        return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: DETAIL_INCLUDE });
      });
      res.json({ event: eventDetailOf(updated) });
    },
  );

  // ---------------------------------------------------------------- publication

  router.post('/events/:eventId/status', guard, validated(eventStatusSchema), async (req, res) => {
    const principal = requireAdmin(res);
    const event = await prisma().event.findUnique({
      where: { id: String(req.params.eventId) },
      include: DETAIL_INCLUDE,
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    const { status } = req.body as z.infer<typeof eventStatusSchema>;
    if (status === 'active') {
      const issues = eventPublishIssues(eventDetailOf(event));
      if (issues.length) throw new HttpError(422, 'not_publishable', issues.join(' '));
    }
    if (status === event.status) {
      res.json({ event: eventDetailOf(event) });
      return;
    }
    const updated = await prisma().$transaction(async (tx) => {
      const row = await tx.event.update({
        where: { id: event.id },
        data: { status },
        include: DETAIL_INCLUDE,
      });
      await audit(tx, {
        action: 'event.status_changed',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        oldValue: { status: event.status },
        newValue: { status, at: clock().toISOString() },
        ...clientOf(res),
      });
      return row;
    });
    res.json({ event: eventDetailOf(updated) });
  });

  return router;
}
