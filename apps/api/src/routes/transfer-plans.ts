import {
  actionProgressSchema,
  actionProgressStatuses,
  nextReminderAfter,
  planHasContent,
  referenceQuestionsSaveSchema,
  transferPlanSaveSchema,
  transferPlanSubmitSchema,
  type ActionProgressStatus,
  type MyTransferPlan,
  type PlanActionView,
  type TransferPlanAdminDetail,
  type TransferPlanListItem,
  type TransferPlanView,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { referenceAnswersFor } from '../assessments/references.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const UUID = /^[0-9a-f-]{36}$/i;
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const dayOf = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

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

const PLAN_INCLUDE = {
  actions: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: { progress: { orderBy: { recordedAt: 'desc' } } },
  },
  reminders: { orderBy: { createdAt: 'desc' }, take: 20 },
} satisfies Prisma.TransferPlanInclude;
type PlanRow = Prisma.TransferPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

const DELEGATE_SELECT = {
  id: true,
  name: true,
  email: true,
  organisation: true,
  attendanceFormat: true,
} as const;

function actionViewOf(a: PlanRow['actions'][number]): PlanActionView {
  return {
    id: a.id,
    order: a.order,
    isPriority: a.isPriority,
    priorityLearning: a.priorityLearning,
    action: a.action,
    opportunity: a.opportunity,
    firstStep: a.firstStep,
    startOn: isoDate(a.startOn),
    targetOn: isoDate(a.targetOn),
    stakeholders: a.stakeholders,
    support: a.support,
    barriers: a.barriers,
    evidence: a.evidence,
    expectedResult: a.expectedResult,
    measure: a.measure,
    baseline: a.baseline,
    reviewOn: isoDate(a.reviewOn),
    progressStatus: a.progressStatus,
    progress: a.progress.map((p) => ({
      id: p.id,
      status: p.status,
      note: p.note,
      evidence: p.evidence,
      results: p.results,
      challenges: p.challenges,
      newTargetOn: isoDate(p.newTargetOn),
      recordedAt: p.recordedAt.toISOString(),
    })),
  };
}

export function planViewOf(p: PlanRow): TransferPlanView {
  return {
    id: p.id,
    eventId: p.eventId,
    status: p.status,
    version: p.version,
    submittedAt: iso(p.submittedAt),
    updatedAt: p.updatedAt.toISOString(),
    reminder: {
      frequency: p.reminderFrequency,
      startOn: isoDate(p.reminderStartOn),
      nextReminderAt: iso(p.nextReminderAt),
    },
    actions: p.actions.map(actionViewOf),
  };
}

/**
 * Individual Transfer Plans: one per delegate per event, created on first access, saved as a
 * draft across every Transfer Planning session, submitted once (snapshot kept) and kept open
 * for progress and changes afterwards. Admins review; delegates see only their own. Nothing
 * here records attendance. Plan text is never logged.
 */
export function transferPlanRouter({ prisma, config, middleware, now }: Deps): Router {
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

  async function myRegistration(res: Response, eventId: string) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'Transfer Plans belong to delegates.');
    }
    if (!UUID.test(eventId) || !principal.identityId) {
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    }
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

  /** The event's Transfer Planning sessions in schedule order; the final one is flagged or last. */
  async function planningSessions(eventId: string) {
    const rows = await prisma().eventSession.findMany({
      where: { eventId, sessionType: 'transfer_planning' },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        transferPlanningFinal: true,
        eventDate: { select: { date: true } },
      },
    });
    const sorted = rows
      .map((s) => ({ ...s, date: isoDate(s.eventDate.date)! }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    const flagged = sorted.findIndex((s) => s.transferPlanningFinal);
    const finalIndex = flagged >= 0 ? flagged : sorted.length - 1;
    return sorted.map((s, i) => ({
      id: s.id,
      date: s.date,
      title: s.title,
      startTime: s.startTime,
      endTime: s.endTime,
      order: i + 1,
      isFinal: i === finalIndex,
    }));
  }

  /** Submission opens with the start of the designated final session (any time when none is scheduled). */
  async function canSubmitAt(eventId: string, timezone: string, at: Date) {
    const sessions = await planningSessions(eventId);
    const final = sessions.find((s) => s.isFinal);
    if (!final) return { sessions, canSubmit: true };
    // The session's wall-clock start in the event's zone, compared as an instant.
    const startLocal = new Date(`${final.date}T${final.startTime}:00`);
    const offsetMinutes = (() => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
      }).formatToParts(startLocal);
      const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
      const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
      return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
    })();
    const start = new Date(
      Date.UTC(
        Number(final.date.slice(0, 4)),
        Number(final.date.slice(5, 7)) - 1,
        Number(final.date.slice(8, 10)),
        Number(final.startTime.slice(0, 2)),
        Number(final.startTime.slice(3, 5)),
      ) -
        offsetMinutes * 60_000,
    );
    return { sessions, canSubmit: at >= start };
  }

  /** The delegate's pre-event answers to the event's reference questions. */
  const referencesFor = (eventId: string, delegateId: string) =>
    referenceAnswersFor(prisma(), eventId, delegateId);

  async function loadOrCreatePlan(eventId: string, delegateId: string) {
    const existing = await prisma().transferPlan.findUnique({
      where: { eventId_delegateId: { eventId, delegateId } },
      include: PLAN_INCLUDE,
    });
    if (existing) return existing;
    return prisma().transferPlan.create({
      data: { eventId, delegateId },
      include: PLAN_INCLUDE,
    });
  }

  async function myView(eventId: string, delegateId: string): Promise<MyTransferPlan> {
    const [plan, event] = await Promise.all([
      loadOrCreatePlan(eventId, delegateId),
      prisma().event.findUniqueOrThrow({ where: { id: eventId }, select: { timezone: true } }),
    ]);
    const { sessions, canSubmit } = await canSubmitAt(eventId, event.timezone, clock());
    return {
      plan: planViewOf(plan),
      sessions,
      canSubmit: plan.status === 'draft' && canSubmit,
      references: await referencesFor(eventId, delegateId),
      reminders: plan.reminders.map((r) => ({
        scheduledFor: r.scheduledFor.toISOString(),
        sentAt: iso(r.sentAt),
        status: r.status,
      })),
    };
  }

  // ---------------------------------------------------------------- delegate

  router.get('/me/events/:eventId/transfer-plan', middleware.requireAuth, async (req, res) => {
    const { delegate } = await myRegistration(res, String(req.params.eventId));
    res.json(await myView(delegate.eventId, delegate.id));
  });

  router.put(
    '/me/events/:eventId/transfer-plan',
    middleware.requireAuth,
    validated(transferPlanSaveSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const input = req.body as z.infer<typeof transferPlanSaveSchema>;
      const plan = await loadOrCreatePlan(delegate.eventId, delegate.id);
      if (input.version !== plan.version) {
        throw new HttpError(
          409,
          'stale_plan',
          'Your plan changed since you opened it, possibly in another tab. Reload it and apply your changes again.',
        );
      }
      const known = new Set(plan.actions.map((a) => a.id));
      for (const a of input.actions) {
        if (a.id && !known.has(a.id)) {
          throw new HttpError(
            422,
            'validation_failed',
            'actions: an id does not belong to this plan.',
          );
        }
      }
      // Exactly one first priority when any is flagged: the first flagged wins.
      let prioritySeen = false;
      const actions = input.actions.map((a) => {
        const isPriority = a.isPriority && !prioritySeen;
        if (isPriority) prioritySeen = true;
        return { ...a, isPriority };
      });
      const at = clock();
      const keepIds = new Set(actions.filter((a) => a.id).map((a) => a.id!));
      const removed = plan.actions.filter((a) => !keepIds.has(a.id)).map((a) => a.id);
      const nextReminderAt = nextReminderAfter(
        input.reminder.frequency,
        at,
        input.reminder.startOn,
      );
      const saved = await prisma().$transaction(async (tx) => {
        if (removed.length) {
          await tx.transferPlanAction.deleteMany({
            where: { id: { in: removed }, planId: plan.id },
          });
        }
        for (const [index, a] of actions.entries()) {
          const data = {
            order: index + 1,
            isPriority: a.isPriority,
            priorityLearning: a.priorityLearning,
            action: a.action,
            opportunity: a.opportunity,
            firstStep: a.firstStep,
            startOn: dayOf(a.startOn),
            targetOn: dayOf(a.targetOn),
            stakeholders: a.stakeholders,
            support: a.support,
            barriers: a.barriers,
            evidence: a.evidence,
            expectedResult: a.expectedResult,
            measure: a.measure,
            baseline: a.baseline,
            reviewOn: dayOf(a.reviewOn),
          };
          if (a.id) await tx.transferPlanAction.update({ where: { id: a.id }, data });
          else await tx.transferPlanAction.create({ data: { ...data, planId: plan.id } });
        }
        const row = await tx.transferPlan.update({
          where: { id: plan.id },
          data: {
            version: plan.version + 1,
            reminderFrequency: input.reminder.frequency,
            reminderStartOn: dayOf(input.reminder.startOn),
            nextReminderAt,
            updatedByUserId: principal.userId,
          },
          include: PLAN_INCLUDE,
        });
        await audit(tx, {
          action: 'transfer_plan.saved',
          entityType: 'transfer_plan',
          entityId: plan.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: {
            version: row.version,
            status: row.status,
            actions: actions.length,
            removed: removed.length,
            reminderFrequency: input.reminder.frequency,
          },
          ...clientOf(res),
        });
        return row;
      });
      void saved;
      res.json(await myView(delegate.eventId, delegate.id));
    },
  );

  router.post(
    '/me/events/:eventId/transfer-plan/submit',
    middleware.requireAuth,
    validated(transferPlanSubmitSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const { version } = req.body as z.infer<typeof transferPlanSubmitSchema>;
      const plan = await loadOrCreatePlan(delegate.eventId, delegate.id);
      if (plan.status === 'submitted') {
        throw new HttpError(
          409,
          'already_submitted',
          'Your plan is already submitted; edit it as it is.',
        );
      }
      if (version !== plan.version) {
        throw new HttpError(
          409,
          'stale_plan',
          'Your plan changed since you opened it. Reload it first.',
        );
      }
      if (!planHasContent(plan.actions)) {
        throw new HttpError(422, 'plan_empty', 'Describe at least one action before submitting.');
      }
      const event = await prisma().event.findUniqueOrThrow({
        where: { id: delegate.eventId },
        select: { timezone: true },
      });
      const at = clock();
      const { canSubmit } = await canSubmitAt(delegate.eventId, event.timezone, at);
      if (!canSubmit) {
        throw new HttpError(
          409,
          'not_yet',
          'Plans are submitted during the final Transfer Planning session; keep saving your draft until then.',
        );
      }
      await prisma().$transaction(async (tx) => {
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: {
            status: 'submitted',
            submittedAt: at,
            submittedSnapshot: planViewOf({
              ...plan,
              submittedAt: at,
            }) as unknown as Prisma.InputJsonValue,
            version: plan.version + 1,
            updatedByUserId: principal.userId,
          },
        });
        await audit(tx, {
          action: 'transfer_plan.submitted',
          entityType: 'transfer_plan',
          entityId: plan.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: { actions: plan.actions.length, version: plan.version + 1 },
          ...clientOf(res),
        });
      });
      res.json(await myView(delegate.eventId, delegate.id));
    },
  );

  router.post(
    '/me/events/:eventId/transfer-plan/actions/:actionId/progress',
    middleware.requireAuth,
    validated(actionProgressSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const actionId = String(req.params.actionId);
      if (!UUID.test(actionId)) throw new HttpError(404, 'not_found', 'Action not found.');
      const plan = await loadOrCreatePlan(delegate.eventId, delegate.id);
      const action = plan.actions.find((a) => a.id === actionId);
      if (!action) throw new HttpError(404, 'not_found', 'Action not found.');
      const input = req.body as z.infer<typeof actionProgressSchema>;
      const at = clock();
      await prisma().$transaction(async (tx) => {
        await tx.transferPlanProgress.create({
          data: {
            actionId: action.id,
            status: input.status,
            note: input.note || null,
            evidence: input.evidence || null,
            results: input.results || null,
            challenges: input.challenges || null,
            newTargetOn: dayOf(input.newTargetOn),
            recordedAt: at,
            recordedByUserId: principal.userId,
          },
        });
        await tx.transferPlanAction.update({
          where: { id: action.id },
          data: {
            progressStatus: input.status,
            ...(input.newTargetOn ? { targetOn: dayOf(input.newTargetOn) } : {}),
          },
        });
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: { version: plan.version + 1, updatedByUserId: principal.userId },
        });
        await audit(tx, {
          action: 'transfer_plan.progress_recorded',
          entityType: 'transfer_plan_action',
          entityId: action.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          oldValue: { status: action.progressStatus },
          newValue: { status: input.status, targetChanged: Boolean(input.newTargetOn) },
          ...clientOf(res),
        });
      });
      res.status(201).json(await myView(delegate.eventId, delegate.id));
    },
  );

  // ---------------------------------------------------------------- admin

  async function loadEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: { id: true, timezone: true },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  router.get('/events/:eventId/transfer-plans', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const plans = await prisma().transferPlan.findMany({
      where: { eventId: event.id, delegate: { registrationStatus: { in: [...eligible()] } } },
      include: {
        delegate: { select: DELEGATE_SELECT },
        actions: {
          orderBy: { order: 'asc' },
          select: { action: true, isPriority: true, progressStatus: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const items: TransferPlanListItem[] = plans.map((p) => {
      const progress = Object.fromEntries(actionProgressStatuses.map((s) => [s, 0])) as Record<
        ActionProgressStatus,
        number
      >;
      for (const a of p.actions) progress[a.progressStatus] += 1;
      return {
        delegate: p.delegate,
        status: p.status,
        actions: p.actions.length,
        priorityAction: (p.actions.find((a) => a.isPriority) ?? p.actions[0])?.action || null,
        submittedAt: iso(p.submittedAt),
        updatedAt: p.updatedAt.toISOString(),
        progress,
        reminderFrequency: p.reminderFrequency,
      };
    });
    const sessions = await planningSessions(event.id);
    res.json({ plans: items, sessions });
  });

  router.get('/events/:eventId/transfer-plans/:delegateId', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const delegateId = String(req.params.delegateId);
    if (!UUID.test(delegateId)) throw new HttpError(404, 'not_found', 'Plan not found.');
    const plan = await prisma().transferPlan.findFirst({
      where: { eventId: event.id, delegateId },
      include: { ...PLAN_INCLUDE, delegate: { select: DELEGATE_SELECT } },
    });
    if (!plan) throw new HttpError(404, 'not_found', 'Plan not found.');
    const history = await prisma().auditLog.findMany({
      where: {
        eventId: event.id,
        OR: [
          { entityType: 'transfer_plan', entityId: plan.id },
          { entityType: 'transfer_plan_action', entityId: { in: plan.actions.map((a) => a.id) } },
        ],
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
      select: { occurredAt: true, actorUserId: true, action: true, newValue: true },
    });
    const actorIds = [
      ...new Set(history.map((h) => h.actorUserId).filter((x): x is string => Boolean(x))),
    ];
    const actors = actorIds.length
      ? await prisma().userAccount.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailOf = new Map(actors.map((a) => [a.id, a.email]));
    const detail: TransferPlanAdminDetail = {
      delegate: plan.delegate,
      plan: planViewOf(plan),
      snapshot: (plan.submittedSnapshot as TransferPlanView | null) ?? null,
      references: await referencesFor(event.id, plan.delegateId),
      history: history.map((h) => ({
        at: h.occurredAt.toISOString(),
        by: h.actorUserId ? (emailOf.get(h.actorUserId) ?? null) : null,
        action: h.action,
        detail: h.newValue ?? null,
      })),
      reminders: plan.reminders.map((r) => ({
        scheduledFor: r.scheduledFor.toISOString(),
        sentAt: iso(r.sentAt),
        status: r.status,
      })),
    };
    await audit(prisma(), {
      action: 'transfer_plan.viewed',
      entityType: 'transfer_plan',
      entityId: plan.id,
      eventId: event.id,
      actorUserId: principal.userId,
      newValue: { delegateId: plan.delegateId },
      ...clientOf(res),
    });
    res.json({ plan: detail });
  });

  // Which pre-event questions the event shows back beside the plan, in order.
  router.get('/events/:eventId/reference-questions', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const [refs, questions] = await Promise.all([
      prisma().eventReferenceQuestion.findMany({
        where: { eventId: event.id },
        orderBy: { order: 'asc' },
      }),
      prisma().assessmentQuestion.findMany({
        where: { eventId: event.id, retiredAt: null, stage: { stage: 'pre_conference' } },
        orderBy: [{ order: 'asc' }],
        select: { questionKey: true, prompt: true, type: true },
      }),
    ]);
    res.json({ references: refs.map((r) => r.questionKey), questions });
  });

  router.put(
    '/events/:eventId/reference-questions',
    guard,
    validated(referenceQuestionsSaveSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const input = req.body as z.infer<typeof referenceQuestionsSaveSchema>;
      const keys = [...new Set(input.questionKeys)];
      if (keys.length) {
        const found = await prisma().assessmentQuestion.groupBy({
          by: ['questionKey'],
          where: { eventId: event.id, questionKey: { in: keys } },
        });
        if (found.length < keys.length) {
          throw new HttpError(
            422,
            'validation_failed',
            'A reference must be one of this event’s pre-event questions.',
          );
        }
      }
      await prisma().$transaction(async (tx) => {
        await tx.eventReferenceQuestion.deleteMany({ where: { eventId: event.id } });
        if (keys.length) {
          await tx.eventReferenceQuestion.createMany({
            data: keys.map((questionKey, index) => ({
              eventId: event.id,
              order: index + 1,
              questionKey,
            })),
          });
        }
        await audit(tx, {
          action: 'event.reference_questions_set',
          entityType: 'event',
          entityId: event.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { questionKeys: keys },
          ...clientOf(res),
        });
      });
      res.json({ references: keys });
    },
  );

  return router;
}
