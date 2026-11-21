import {
  actionProgressLabels,
  actionProgressStatuses,
  actionSubmissionGaps,
  commitmentSaveSchema,
  commitmentStatuses,
  DEFAULT_CHECKLIST_TEMPLATE,
  NO_REMINDERS,
  templateActions,
  waveLabel,
  type ChecklistTemplate,
  type CommitmentSave,
  type CommitmentStatus,
  type PlanChecklist,
  evidenceSaveSchema,
  evidenceSupports,
  measureSummaries,
  measuresSaveSchema,
  addDaysTo,
  dateIn,
  IMPACT_CHECK_DAYS,
  IMPACT_CHECK_ROUNDS,
  impactCheckAnswerSchema,
  impactCheckAnswersFor,
  nextReminderAfter,
  planCompletionGaps,
  planHasContent,
  planOutcomeLabels,
  planTitleOf,
  referenceQuestionsSaveSchema,
  summariseMeasures,
  transferPlanVisible,
  transferPlanCompleteSchema,
  transferPlanSaveSchema,
  transferPlanSubmitSchema,
  type ActionProgressStatus,
  type EvidenceSupport,
  type EvidenceView,
  type ImpactCheckView,
  type MeasureReportRow,
  type MeasureSummary,
  type MeasureView,
  type MyTransferPlan,
  type MyTransferPlans,
  type PlanActionView,
  type PlanOutcome,
  type ReminderPreference,
  type TransferPlanAdminDetail,
  type TransferPlanListItem,
  type TransferPlanSummary,
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
import { batchScopeOf, inBatch } from '../lib/batch-scope.js';
import { isDocumentFormat, planDocument, sendDocument } from '../export/submissions.js';
import { csvCell } from '../imports/service.js';
import { organiserName } from '../mail/branding.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderTransferPlanCompleted } from '../mail/templates/index.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  /** For the note to the organisers when a delegate completes a plan (2026-11-06). */
  mailer?: () => Mailer;
  mailConfig?: () => MailConfig;
  logger?: Logger;
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

const ACTION_INCLUDE = {
  progress: { orderBy: { recordedAt: 'desc' } },
  measures: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: { results: { orderBy: [{ resultOn: 'desc' }, { recordedAt: 'desc' }] } },
  },
  evidenceRecords: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.TransferPlanActionInclude;
const PLAN_INCLUDE = {
  actions: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: ACTION_INCLUDE,
  },
  reminders: { orderBy: { createdAt: 'desc' }, take: 20 },
  impactChecks: { orderBy: { round: 'asc' } },
} satisfies Prisma.TransferPlanInclude;
type PlanRow = Prisma.TransferPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;
export type ActionRow = PlanRow['actions'][number];

const DELEGATE_SELECT = {
  id: true,
  name: true,
  email: true,
  organisation: true,
  attendanceFormat: true,
} as const;

export function measureViewOf(m: ActionRow['measures'][number]): MeasureView {
  return {
    id: m.id,
    order: m.order,
    kind: m.kind,
    name: m.name,
    importance: m.importance,
    method: m.method,
    unit: m.unit,
    direction: m.direction,
    baselineState: m.baselineState,
    baselineValue: m.baselineValue,
    baselineOn: isoDate(m.baselineOn),
    targetState: m.targetState,
    targetValue: m.targetValue,
    targetOn: isoDate(m.targetOn),
    actualValue: m.actualValue,
    actualOn: isoDate(m.actualOn),
    source: m.source,
    influences: m.influences,
    support: m.support,
    results: m.results.map((r) => ({
      id: r.id,
      value: r.value,
      resultOn: isoDate(r.resultOn),
      method: r.method,
      meaning: r.meaning,
      isFinal: r.isFinal,
      sourceType: r.sourceType,
      source: r.source,
      hasInfluences: r.hasInfluences,
      influences: r.influences,
      support: r.support,
      measureName: r.measureName,
      measureKind: r.measureKind,
      unit: r.unit,
      recordedAt: r.recordedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function evidenceViewOf(e: ActionRow['evidenceRecords'][number]): EvidenceView {
  return {
    id: e.id,
    order: e.order,
    measureId: e.measureId,
    type: e.type,
    description: e.description,
    evidenceOn: isoDate(e.evidenceOn),
    support: e.support,
    supportedBy: e.supportedBy,
    reference: e.reference,
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** Evidence records counted by how they are supported; never "verified". */
function evidenceCounts(records: ReadonlyArray<{ support: EvidenceSupport }>) {
  const counts = Object.fromEntries(evidenceSupports.map((s) => [s, 0])) as Record<
    EvidenceSupport,
    number
  >;
  for (const e of records) counts[e.support] += 1;
  return counts;
}

function actionViewOf(a: ActionRow): PlanActionView {
  return {
    id: a.id,
    order: a.order,
    isPriority: a.isPriority,
    title: a.title,
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
      wave: p.followUpWave,
      waveLabel: p.waveLabel,
      occurredOn: isoDate(p.occurredOn),
      note: p.note,
      evidence: p.evidence,
      results: p.results,
      challenges: p.challenges,
      newTargetOn: isoDate(p.newTargetOn),
      recordedAt: p.recordedAt.toISOString(),
    })),
    measureStatus: a.measureStatus,
    reminder: reminderViewOf(a),
    measures: a.measures.map(measureViewOf),
    evidenceRecords: a.evidenceRecords.map(evidenceViewOf),
  };
}

/** The columns an action's reminder preference becomes, with its next time from `at`. */
function reminderDataOf(reminder: ReminderPreference, at: Date, timezone: string) {
  const pref: ReminderPreference = {
    ...reminder,
    startOn: reminder.startOn ?? null,
    endOn: reminder.endOn ?? null,
    days: reminder.frequency === 'twice_weekly' ? [...reminder.days].sort() : [],
  };
  return {
    reminderFrequency: pref.frequency,
    reminderStartOn: dayOf(pref.startOn),
    reminderEndOn: dayOf(pref.endOn),
    reminderTime: pref.time,
    reminderDays: pref.days,
    nextReminderAt: nextReminderAfter(pref, at, timezone),
  };
}

/** An action's reminder as the delegate set it, with when the next one goes out. */
function reminderViewOf(p: {
  reminderFrequency: ActionRow['reminderFrequency'];
  reminderStartOn: Date | null;
  reminderEndOn: Date | null;
  reminderTime: string;
  reminderDays: number[];
  nextReminderAt: Date | null;
}) {
  return {
    frequency: p.reminderFrequency,
    startOn: isoDate(p.reminderStartOn),
    endOn: isoDate(p.reminderEndOn),
    time: p.reminderTime,
    days: p.reminderDays,
    nextReminderAt: iso(p.nextReminderAt),
  };
}

export function planViewOf(p: PlanRow): TransferPlanView {
  return {
    id: p.id,
    eventId: p.eventId,
    sequence: p.sequence,
    title: p.title,
    trainingName: p.trainingName,
    checklist: (p.checklist as PlanChecklist | null) ?? null,
    status: p.status,
    version: p.version,
    submittedAt: iso(p.submittedAt),
    completedAt: iso(p.completedAt),
    outcome: p.outcome,
    outcomeNote: p.outcomeNote,
    impactChecks: p.impactChecks.map(impactCheckViewOf),
    updatedAt: p.updatedAt.toISOString(),
    actions: p.actions.map(actionViewOf),
  };
}

function impactCheckViewOf(c: PlanRow['impactChecks'][number]): ImpactCheckView {
  return {
    id: c.id,
    round: c.round,
    dueOn: isoDate(c.dueOn)!,
    notifiedAt: iso(c.notifiedAt),
    answeredAt: iso(c.answeredAt),
    answer: c.answer,
    note: c.note,
    evidence: c.evidence,
  };
}

/** An impact check that has fallen due and has no answer yet, as of `today` (YYYY-MM-DD). */
const checkDueOn = (p: PlanRow, today: string) =>
  p.impactChecks.some((c) => !c.answeredAt && isoDate(c.dueOn)! <= today);

/**
 * Individual Transfer Plans: one per delegate per event, created on first access, saved as a
 * draft across every Transfer Planning session, submitted once (snapshot kept) and kept open
 * for progress and changes afterwards. Admins review; delegates see only their own. Nothing
 * here records attendance. Plan text is never logged.
 */
export function transferPlanRouter({
  prisma,
  config,
  middleware,
  mailer,
  mailConfig,
  logger,
  now,
}: Deps): Router {
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
      select: {
        id: true,
        eventId: true,
        event: { select: { transferPlanVisibility: true, transferPlanShownFrom: true } },
      },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    // Hidden by the organisers (2026-11-08): nothing of the plan is served to the delegate.
    if (!transferPlanVisible(delegate.event, clock())) {
      throw new HttpError(
        409,
        'transfer_plan_hidden',
        'Transfer Planning is not open to delegates for this event right now.',
      );
    }
    return { principal, delegate: { id: delegate.id, eventId: delegate.eventId } };
  }

  /**
   * The event's Transfer Planning sessions in schedule order. The last one is where plans are
   * submitted: there is nothing to configure, because a session later in the schedule than the
   * closing one would be the wrong answer anyway (decision of 2026-11-02, which removed the
   * per-session flag that could say otherwise and could be set on two sessions at once).
   */
  async function planningSessions(eventId: string) {
    const rows = await prisma().eventSession.findMany({
      where: { eventId, sessionType: 'transfer_planning' },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        eventDate: { select: { date: true } },
      },
    });
    const sorted = rows
      .map((s) => ({ ...s, date: isoDate(s.eventDate.date)! }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    return sorted.map((s, i) => ({
      id: s.id,
      date: s.date,
      title: s.title,
      startTime: s.startTime,
      endTime: s.endTime,
      order: i + 1,
      isFinal: i === sorted.length - 1,
    }));
  }

  /**
   * A draft can be submitted at any time (decision 2026-11-08). Until then submission opened
   * with the start of the last Transfer Planning session; the sessions are still listed so the
   * delegate knows when the plan is worked on together.
   */
  async function canSubmitAt(eventId: string) {
    return { sessions: await planningSessions(eventId), canSubmit: true };
  }

  /** The event's plan mode and, for the checklist-and-commitment form, its wording (2026-11-20). */
  async function planSetup(eventId: string) {
    const event = await prisma().event.findUniqueOrThrow({
      where: { id: eventId },
      select: { transferPlanMode: true, transferPlanTemplate: true, timezone: true, endsOn: true },
    });
    return {
      mode: event.transferPlanMode,
      template:
        (event.transferPlanTemplate as ChecklistTemplate | null) ?? DEFAULT_CHECKLIST_TEMPLATE,
      timezone: event.timezone,
    };
  }

  /** The delegate's pre-event answers to the event's reference questions. */
  const referencesFor = (eventId: string, delegateId: string) =>
    referenceAnswersFor(prisma(), eventId, delegateId);

  /**
   * One plan per delegate (decision 2026-11-11, back to section 9 of the brief): it is created
   * on first access so the plan page is never empty, and no route creates another.
   */
  async function ensureFirstPlan(eventId: string, delegateId: string) {
    const count = await prisma().transferPlan.count({ where: { eventId, delegateId } });
    if (count === 0) {
      await prisma().transferPlan.create({ data: { eventId, delegateId, sequence: 1 } });
    }
  }

  /** One of the delegate's own plans; anyone else's id is simply "not found". */
  async function loadPlan(eventId: string, delegateId: string, planId: string) {
    if (!UUID.test(planId)) throw new HttpError(404, 'not_found', 'Plan not found.');
    const plan = await prisma().transferPlan.findFirst({
      where: { id: planId, eventId, delegateId },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw new HttpError(404, 'not_found', 'Plan not found.');
    return plan;
  }

  /** A completed plan is finished: its results and evidence stand as recorded. */
  function assertEditable(plan: { status: PlanRow['status'] }) {
    if (plan.status === 'completed') {
      throw new HttpError(
        409,
        'plan_completed',
        'This plan is completed and can no longer be changed. What it records stands as your result.',
      );
    }
  }

  function summaryOf(p: PlanRow, today: string): TransferPlanSummary {
    return {
      id: p.id,
      sequence: p.sequence,
      title: p.title,
      status: p.status,
      actions: p.actions.filter((a) => a.action.trim() !== '').length,
      priorityAction: (p.actions.find((a) => a.isPriority) ?? p.actions[0])?.action.trim() || null,
      submittedAt: iso(p.submittedAt),
      completedAt: iso(p.completedAt),
      outcome: p.outcome,
      checkDue: checkDueOn(p, today),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async function myPlans(eventId: string, delegateId: string): Promise<MyTransferPlans> {
    await ensureFirstPlan(eventId, delegateId);
    const [plans, event] = await Promise.all([
      prisma().transferPlan.findMany({
        where: { eventId, delegateId },
        orderBy: { sequence: 'asc' },
        include: PLAN_INCLUDE,
      }),
      prisma().event.findUniqueOrThrow({ where: { id: eventId }, select: { timezone: true } }),
    ]);
    const today = dateIn(clock(), event.timezone);
    return { plans: plans.map((p) => summaryOf(p, today)) };
  }

  async function myView(
    eventId: string,
    delegateId: string,
    planId: string,
  ): Promise<MyTransferPlan> {
    const [plan, { sessions, canSubmit }] = await Promise.all([
      loadPlan(eventId, delegateId, planId),
      canSubmitAt(eventId),
    ]);
    const setup = await planSetup(eventId);
    return {
      plan: planViewOf(plan),
      mode: setup.mode,
      ...(setup.mode === 'commitment' ? { template: setup.template } : {}),
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

  /** The organisers hear of every completed plan (2026-11-06); a mail failure never undoes it. */
  async function notifyAdminsOfCompletion(
    plan: PlanRow,
    delegateName: string,
    outcome: PlanOutcome,
  ) {
    if (!mailer || !mailConfig) return;
    const [event, admins] = await Promise.all([
      prisma().event.findUniqueOrThrow({
        where: { id: plan.eventId },
        select: {
          id: true,
          name: true,
          startsOn: true,
          endsOn: true,
          timezone: true,
          location: true,
        },
      }),
      prisma().userAccount.findMany({
        where: { role: 'admin', status: 'active' },
        select: { email: true },
      }),
    ]);
    if (admins.length === 0) return;
    const branding = brandingForEvent(mailConfig(), event);
    const rendered = renderTransferPlanCompleted(branding, {
      delegateName,
      planTitle: planTitleOf(plan),
      actions: plan.actions.filter((a) => a.action.trim() !== '').length,
      outcome: planOutcomeLabels[outcome],
      adminUrl: `${config.appUrl.replace(/\/$/, '')}/admin/events/${event.id}#transfer-plans`,
    });
    let sent = 0;
    for (const admin of admins) {
      try {
        await mailer().send({
          to: admin.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        sent += 1;
      } catch (error) {
        logger?.warn({ err: error }, 'transfer plan completion notice failed');
      }
    }
    logger?.info({ admins: admins.length, sent }, 'transfer plan completion notices');
  }

  // ---------------------------------------------------------------- delegate

  router.get('/me/events/:eventId/transfer-plans', middleware.requireAuth, async (req, res) => {
    const { delegate } = await myRegistration(res, String(req.params.eventId));
    res.json(await myPlans(delegate.eventId, delegate.id));
  });

  router.get(
    '/me/events/:eventId/transfer-plans/:planId',
    middleware.requireAuth,
    async (req, res) => {
      const { delegate } = await myRegistration(res, String(req.params.eventId));
      res.json(await myView(delegate.eventId, delegate.id, String(req.params.planId)));
    },
  );

  router.put(
    '/me/events/:eventId/transfer-plans/:planId',
    middleware.requireAuth,
    validated(transferPlanSaveSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const input = req.body as z.infer<typeof transferPlanSaveSchema>;
      const plan = await loadPlan(delegate.eventId, delegate.id, String(req.params.planId));
      assertEditable(plan);
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
      const event = await prisma().event.findUniqueOrThrow({
        where: { id: delegate.eventId },
        select: { timezone: true },
      });
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
            title: a.title,
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
            measureStatus: a.measureStatus,
            // The action's own reminder (2026-11-11); its next time follows the preference.
            ...reminderDataOf(a.reminder, at, event.timezone),
          };
          if (a.id) await tx.transferPlanAction.update({ where: { id: a.id }, data });
          else await tx.transferPlanAction.create({ data: { ...data, planId: plan.id } });
        }
        const row = await tx.transferPlan.update({
          where: { id: plan.id },
          data: {
            version: plan.version + 1,
            title: input.title,
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
            remindersOn: actions.filter((a) => a.reminder.frequency !== 'none').length,
          },
          ...clientOf(res),
        });
        return row;
      });
      void saved;
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
    },
  );

  /**
   * The checklist-and-commitment form (2026-11-20): the training named, the actions ticked, the
   * one committed to with what, by when and what will show it, and the reminder choice. It is
   * the plan's one action, submitted at once; saving again changes it. Only on an event in the
   * commitment mode, and only actions of its own checklist count.
   */
  router.put(
    '/me/events/:eventId/transfer-plans/:planId/commitment',
    middleware.requireAuth,
    validated(commitmentSaveSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const input = req.body as CommitmentSave;
      const setup = await planSetup(delegate.eventId);
      if (setup.mode !== 'commitment') {
        throw new HttpError(
          409,
          'wrong_plan_mode',
          'This event uses the full Transfer Plan, not the checklist and commitment.',
        );
      }
      const plan = await loadPlan(delegate.eventId, delegate.id, String(req.params.planId));
      assertEditable(plan);
      if (input.version !== plan.version) throw stale();
      const known = new Map(templateActions(setup.template).map((a) => [a.key, a]));
      if (input.ticked.some((k) => !known.has(k))) {
        throw new HttpError(
          422,
          'validation_failed',
          'ticked: an action is not on this checklist.',
        );
      }
      const chosen = known.get(input.commitmentKey)!;
      const at = clock();
      const reminder: ReminderPreference = input.reminderOn
        ? {
            frequency: 'once',
            startOn: input.reminderOn,
            endOn: input.reminderOn,
            time: '09:00',
            days: [],
          }
        : NO_REMINDERS;
      // One action: the committed one. Its title and learning are the checklist action, its
      // text the delegate's own answer, its evidence what will show it was done.
      const data = {
        order: 1,
        isPriority: true,
        title: chosen.text.slice(0, 120),
        priorityLearning: chosen.text,
        action: input.what,
        targetOn: dayOf(input.byOn),
        evidence: input.evidence,
        ...reminderDataOf(reminder, at, setup.timezone),
      };
      const first = plan.actions[0];
      const wasDraft = plan.status === 'draft';
      await prisma().$transaction(async (tx) => {
        if (plan.actions.length > 1) {
          await tx.transferPlanAction.deleteMany({
            where: { planId: plan.id, id: { in: plan.actions.slice(1).map((a) => a.id) } },
          });
        }
        if (first) await tx.transferPlanAction.update({ where: { id: first.id }, data });
        else await tx.transferPlanAction.create({ data: { ...data, planId: plan.id } });
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: {
            version: plan.version + 1,
            trainingName: input.trainingName,
            checklist: {
              ticked: input.ticked,
              commitmentKey: input.commitmentKey,
            } as Prisma.InputJsonValue,
            updatedByUserId: principal.userId,
          },
        });
        await audit(tx, {
          action: 'transfer_plan.saved',
          entityType: 'transfer_plan',
          entityId: plan.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: {
            version: plan.version + 1,
            commitment: true,
            ticked: input.ticked.length,
            remindersOn: input.reminderOn ? 1 : 0,
          },
          ...clientOf(res),
        });
      });
      if (wasDraft) {
        // Saved is submitted: the follow-ups and reminders start from here.
        const fresh = await loadPlan(delegate.eventId, delegate.id, plan.id);
        await prisma().$transaction(async (tx) => {
          await tx.transferPlan.update({
            where: { id: plan.id },
            data: {
              status: 'submitted',
              submittedAt: at,
              submittedSnapshot: planViewOf({
                ...fresh,
                status: 'submitted',
                submittedAt: at,
              }) as unknown as Prisma.InputJsonValue,
              version: fresh.version + 1,
            },
          });
          await audit(tx, {
            action: 'transfer_plan.submitted',
            entityType: 'transfer_plan',
            entityId: plan.id,
            eventId: delegate.eventId,
            actorUserId: principal.userId,
            newValue: { actions: 1, version: fresh.version + 1, commitment: true },
            ...clientOf(res),
          });
        });
      }
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
    },
  );

  router.post(
    '/me/events/:eventId/transfer-plans/:planId/submit',
    middleware.requireAuth,
    validated(transferPlanSubmitSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const { version } = req.body as z.infer<typeof transferPlanSubmitSchema>;
      const plan = await loadPlan(delegate.eventId, delegate.id, String(req.params.planId));
      assertEditable(plan);
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
      if (plan.actions.length === 0 || !planHasContent(plan.actions)) {
        throw new HttpError(422, 'plan_empty', 'Describe at least one action before submitting.');
      }
      // Every action needs its title, priority learning and workplace action (spec 2026-11-08);
      // the gaps go back by action so the form can point at them.
      const gaps = actionSubmissionGaps(plan.actions);
      if (gaps.length > 0) {
        res.status(422).json({
          error: {
            code: 'plan_incomplete',
            message: `Complete every action before submitting: ${gaps
              .map((g) => `action ${g.index + 1} needs ${g.missing.join(', ')}`)
              .join('; ')}.`,
            requestId: String(res.getHeader('x-request-id') ?? ''),
          },
          gaps,
        });
        return;
      }
      // Submission is open at any time (decision 2026-11-08).
      const at = clock();
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
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
    },
  );

  /** The delegate's own action, by id, with the plan it belongs to. */
  async function myAction(res: Response, eventId: string, planId: string, actionId: string) {
    const { principal, delegate } = await myRegistration(res, eventId);
    if (!UUID.test(actionId)) throw new HttpError(404, 'not_found', 'Action not found.');
    const plan = await loadPlan(delegate.eventId, delegate.id, planId);
    assertEditable(plan);
    const action = plan.actions.find((a) => a.id === actionId);
    if (!action) throw new HttpError(404, 'not_found', 'Action not found.');
    return { principal, delegate, plan, action };
  }

  const stale = () =>
    new HttpError(
      409,
      'stale_plan',
      'Your plan changed since you opened it, possibly in another tab. Reload it and apply your changes again.',
    );

  // Business measures of one action (backlog E14-1, E14-2; spec of 2026-11-08): the action's
  // answer ("can you identify a measure?") and the measure definitions. The list is replaced and
  // ids are kept; actual results live in their own records and are untouched here. Saving bumps
  // the plan's version like any other change; no second plan is ever created.
  router.put(
    '/me/events/:eventId/transfer-plans/:planId/actions/:actionId/measures',
    middleware.requireAuth,
    validated(measuresSaveSchema),
    async (req, res) => {
      const { principal, delegate, plan, action } = await myAction(
        res,
        String(req.params.eventId),
        String(req.params.planId),
        String(req.params.actionId),
      );
      const input = req.body as z.infer<typeof measuresSaveSchema>;
      if (input.version !== plan.version) throw stale();
      const known = new Map(action.measures.map((m) => [m.id, m]));
      for (const m of input.measures) {
        if (m.id && !known.has(m.id)) {
          throw new HttpError(
            422,
            'validation_failed',
            'measures: an id does not belong to this action.',
          );
        }
      }
      const keepIds = new Set(input.measures.filter((m) => m.id).map((m) => m.id!));
      const removed = action.measures.filter((m) => !keepIds.has(m.id)).map((m) => m.id);
      await prisma().$transaction(async (tx) => {
        if (removed.length) {
          await tx.transferPlanMeasure.deleteMany({
            where: { id: { in: removed }, actionId: action.id },
          });
        }
        for (const [index, m] of input.measures.entries()) {
          const data = {
            order: index + 1,
            kind: m.kind,
            name: m.name,
            importance: m.importance,
            method: m.method,
            unit: m.unit,
            direction: m.direction,
            baselineState: m.baselineState,
            baselineValue: m.baselineState === 'known' ? m.baselineValue : '',
            baselineOn: m.baselineState === 'known' ? dayOf(m.baselineOn) : null,
            targetState: m.targetState,
            targetValue: m.targetState === 'set' ? m.targetValue : '',
            targetOn: m.targetState === 'set' ? dayOf(m.targetOn) : null,
          };
          if (m.id && known.has(m.id)) {
            await tx.transferPlanMeasure.update({ where: { id: m.id }, data });
          } else {
            await tx.transferPlanMeasure.create({ data: { ...data, actionId: action.id } });
          }
        }
        await tx.transferPlanAction.update({
          where: { id: action.id },
          data: { measureStatus: input.measureStatus },
        });
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: { version: plan.version + 1, updatedByUserId: principal.userId },
        });
        await audit(tx, {
          action: 'transfer_plan.measures_saved',
          entityType: 'transfer_plan_action',
          entityId: action.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: {
            measureStatus: input.measureStatus,
            measures: input.measures.length,
            removed: removed.length,
            summary: summariseMeasures(
              input.measureStatus,
              input.measures.map((m) => ({
                baselineValue: m.baselineState === 'known' ? m.baselineValue : '',
                actualValue: (m.id && known.get(m.id)?.actualValue) || '',
              })),
            ),
          },
          ...clientOf(res),
        });
      });
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
    },
  );

  // Evidence of application on one action (backlog E14-3 to E14-5): descriptions, their type,
  // date and whether each is self-reported or supported by another source. No file is taken.
  router.put(
    '/me/events/:eventId/transfer-plans/:planId/actions/:actionId/evidence',
    middleware.requireAuth,
    validated(evidenceSaveSchema),
    async (req, res) => {
      const { principal, delegate, plan, action } = await myAction(
        res,
        String(req.params.eventId),
        String(req.params.planId),
        String(req.params.actionId),
      );
      const input = req.body as z.infer<typeof evidenceSaveSchema>;
      if (input.version !== plan.version) throw stale();
      const known = new Set(action.evidenceRecords.map((e) => e.id));
      const measureIds = new Set(action.measures.map((m) => m.id));
      for (const e of input.evidence) {
        if (e.id && !known.has(e.id)) {
          throw new HttpError(
            422,
            'validation_failed',
            'evidence: an id does not belong to this action.',
          );
        }
        if (e.measureId && !measureIds.has(e.measureId)) {
          throw new HttpError(
            422,
            'validation_failed',
            'evidence: a measure does not belong to this action.',
          );
        }
      }
      const keepIds = new Set(input.evidence.filter((e) => e.id).map((e) => e.id!));
      const removed = action.evidenceRecords.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
      await prisma().$transaction(async (tx) => {
        if (removed.length) {
          await tx.transferPlanEvidence.deleteMany({
            where: { id: { in: removed }, actionId: action.id },
          });
        }
        for (const [index, e] of input.evidence.entries()) {
          const data = {
            order: index + 1,
            measureId: e.measureId,
            type: e.type,
            description: e.description,
            evidenceOn: dayOf(e.evidenceOn),
            support: e.support,
            supportedBy: e.supportedBy,
            reference: e.reference,
          };
          if (e.id) await tx.transferPlanEvidence.update({ where: { id: e.id }, data });
          else await tx.transferPlanEvidence.create({ data: { ...data, actionId: action.id } });
        }
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: { version: plan.version + 1, updatedByUserId: principal.userId },
        });
        await audit(tx, {
          action: 'transfer_plan.evidence_saved',
          entityType: 'transfer_plan_action',
          entityId: action.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: {
            evidence: input.evidence.length,
            removed: removed.length,
            ...evidenceCounts(input.evidence),
          },
          ...clientOf(res),
        });
      });
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
    },
  );

  /**
   * Marks a submitted plan completed (2026-11-06): every written action must carry a result and
   * evidence, or the gaps come back for the delegate to fill. Completion stops the reminders,
   * freezes the plan and tells the organisers.
   */
  router.post(
    '/me/events/:eventId/transfer-plans/:planId/complete',
    middleware.requireAuth,
    validated(transferPlanCompleteSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const { version, improvement, note } = req.body as z.infer<typeof transferPlanCompleteSchema>;
      const plan = await loadPlan(delegate.eventId, delegate.id, String(req.params.planId));
      assertEditable(plan);
      if (plan.status !== 'submitted') {
        throw new HttpError(409, 'not_submitted', 'Submit the plan before completing it.');
      }
      if (version !== plan.version) {
        throw new HttpError(
          409,
          'stale_plan',
          'Your plan changed since you opened it. Reload it first.',
        );
      }
      // Completion shows application: every written action carried out, with evidence.
      const gaps = planCompletionGaps(plan.actions);
      if (gaps.length) {
        res.status(422).json({
          error: {
            code: 'plan_incomplete',
            message:
              'Every action needs to be applied, with evidence, before the plan can be completed.',
            requestId: String(res.getHeader('x-request-id') ?? ''),
          },
          gaps,
        });
        return;
      }
      // Impact is the delegate's own report, never read off completion, and the reports label
      // it as self-reported. It stands on the evidence recorded on the actions; no separate
      // results are recorded (decision 2026-11-09).
      const outcome: PlanOutcome = improvement === 'seen' ? 'impact_demonstrated' : 'applied';
      const at = clock();
      const event = await prisma().event.findUniqueOrThrow({
        where: { id: delegate.eventId },
        select: { timezone: true },
      });
      await prisma().$transaction(async (tx) => {
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: {
            status: 'completed',
            completedAt: at,
            outcome,
            outcomeNote: note,
            version: plan.version + 1,
            updatedByUserId: principal.userId,
            // Completion stops every action's reminders for good.
            actions: {
              updateMany: { where: {}, data: { reminderFrequency: 'none', nextReminderAt: null } },
            },
            // The first impact check: has the improvement appeared (or continued) since?
            impactChecks: {
              create: {
                round: 1,
                dueOn: dayOf(addDaysTo(dateIn(at, event.timezone), IMPACT_CHECK_DAYS))!,
              },
            },
          },
        });
        await audit(tx, {
          action: 'transfer_plan.completed',
          entityType: 'transfer_plan',
          entityId: plan.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: { actions: plan.actions.length, version: plan.version + 1, outcome },
          ...clientOf(res),
        });
      });
      const who = await prisma().delegate.findUniqueOrThrow({
        where: { id: delegate.id },
        select: { name: true },
      });
      try {
        await notifyAdminsOfCompletion(plan, who.name, outcome);
      } catch (error) {
        // The plan is completed either way; the organisers can still see it on their list.
        logger?.warn({ err: error }, 'transfer plan completion notice not sent');
      }
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
    },
  );

  /**
   * The delegate answers an impact check (2026-11-06): from "applied", whether a measurable
   * improvement has appeared; from "impact demonstrated", whether it has continued. The answer
   * moves the outcome only in the direction the evidence supports, and a further check is
   * scheduled while the question is still open and rounds remain.
   */
  router.post(
    '/me/events/:eventId/transfer-plans/:planId/impact-checks/:checkId',
    middleware.requireAuth,
    validated(impactCheckAnswerSchema),
    async (req, res) => {
      const { principal, delegate } = await myRegistration(res, String(req.params.eventId));
      const input = req.body as z.infer<typeof impactCheckAnswerSchema>;
      const plan = await loadPlan(delegate.eventId, delegate.id, String(req.params.planId));
      const checkId = String(req.params.checkId);
      const check = UUID.test(checkId) ? plan.impactChecks.find((c) => c.id === checkId) : null;
      if (!check) throw new HttpError(404, 'not_found', 'Impact check not found.');
      if (plan.status !== 'completed') {
        throw new HttpError(409, 'not_completed', 'Complete the plan before an impact check.');
      }
      if (check.answeredAt) {
        throw new HttpError(409, 'already_answered', 'This check is already answered.');
      }
      if (!impactCheckAnswersFor(plan.outcome).includes(input.answer)) {
        throw new HttpError(
          422,
          'validation_failed',
          'answer: that answer does not apply to this plan at this point.',
        );
      }
      const at = clock();
      const event = await prisma().event.findUniqueOrThrow({
        where: { id: delegate.eventId },
        select: { timezone: true },
      });
      const outcome: PlanOutcome =
        input.answer === 'improved'
          ? 'impact_demonstrated'
          : input.answer === 'sustained'
            ? 'sustained_impact'
            : plan.outcome;
      // Another check while the question is open: an improvement not yet seen, or one newly
      // seen that may or may not last. A sustained or faded improvement ends the checks.
      const another =
        (input.answer === 'not_yet' || input.answer === 'improved') &&
        check.round < IMPACT_CHECK_ROUNDS;
      await prisma().$transaction(async (tx) => {
        await tx.transferPlanImpactCheck.update({
          where: { id: check.id },
          data: {
            answeredAt: at,
            answer: input.answer,
            note: input.note,
            evidence: input.evidence,
          },
        });
        await tx.transferPlan.update({
          where: { id: plan.id },
          data: {
            outcome,
            version: plan.version + 1,
            updatedByUserId: principal.userId,
            ...(another
              ? {
                  impactChecks: {
                    create: {
                      round: check.round + 1,
                      dueOn: dayOf(addDaysTo(dateIn(at, event.timezone), IMPACT_CHECK_DAYS))!,
                    },
                  },
                }
              : {}),
          },
        });
        await audit(tx, {
          action: 'transfer_plan.impact_check',
          entityType: 'transfer_plan',
          entityId: plan.id,
          eventId: delegate.eventId,
          actorUserId: principal.userId,
          newValue: { round: check.round, answer: input.answer, outcome, another },
          ...clientOf(res),
        });
      });
      res.json(await myView(delegate.eventId, delegate.id, plan.id));
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
    const scope = await batchScopeOf(prisma(), event.id, req.query.batch);
    const plans = await prisma().transferPlan.findMany({
      where: {
        eventId: event.id,
        delegate: { registrationStatus: { in: [...eligible()] }, ...inBatch(scope) },
      },
      include: {
        delegate: { select: DELEGATE_SELECT },
        actions: {
          orderBy: { order: 'asc' },
          select: {
            action: true,
            title: true,
            isPriority: true,
            progressStatus: true,
            measureStatus: true,
            reminderFrequency: true,
            measures: { select: { baselineValue: true, actualValue: true } },
            evidenceRecords: { select: { support: true } },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { sequence: 'asc' }],
    });
    // One row per plan (2026-11-06): a delegate with several plans appears once per plan.
    const items: TransferPlanListItem[] = plans.map((p) => {
      const progress = Object.fromEntries(actionProgressStatuses.map((s) => [s, 0])) as Record<
        ActionProgressStatus,
        number
      >;
      const measures = Object.fromEntries(measureSummaries.map((s) => [s, 0])) as Record<
        MeasureSummary,
        number
      >;
      for (const a of p.actions) {
        progress[a.progressStatus] += 1;
        measures[summariseMeasures(a.measureStatus, a.measures)] += 1;
      }
      return {
        delegate: p.delegate,
        planId: p.id,
        sequence: p.sequence,
        title: p.title,
        status: p.status,
        completedAt: iso(p.completedAt),
        outcome: p.outcome,
        actions: p.actions.length,
        priorityAction: (() => {
          const first = p.actions.find((a) => a.isPriority) ?? p.actions[0];
          return first ? first.title.trim() || first.action || null : null;
        })(),
        submittedAt: iso(p.submittedAt),
        updatedAt: p.updatedAt.toISOString(),
        trainingName: p.trainingName,
        ticked: (p.checklist as PlanChecklist | null)?.ticked ?? [],
        progress,
        remindersOn: p.actions.filter((a) => a.reminderFrequency !== 'none').length,
        measures,
        evidence: evidenceCounts(p.actions.flatMap((a) => a.evidenceRecords)),
      };
    });
    const sessions = await planningSessions(event.id);
    res.json({ plans: items, sessions });
  });

  /**
   * The checklist-and-commitment answers by name (2026-11-20), for the organisers to share with
   * a client's L&D: one row per delegate with a plan, their batch and department, the training
   * named, one column per checklist action, the commitment with its date, what will show it and
   * the reminder day, then each follow-up's answer and update. Personal data by name: admins
   * only, and the download is audited like the other exports.
   */
  router.get('/events/:eventId/transfer-plans/commitments.csv', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const scope = await batchScopeOf(prisma(), event.id, req.query.batch);
    const setup = await planSetup(event.id);
    const [plans, waves] = await Promise.all([
      prisma().transferPlan.findMany({
        where: {
          eventId: event.id,
          delegate: { registrationStatus: { in: [...eligible()] }, ...inBatch(scope) },
        },
        include: {
          delegate: {
            select: {
              name: true,
              email: true,
              organisation: true,
              department: true,
              batch: { select: { name: true } },
            },
          },
          actions: {
            orderBy: { order: 'asc' },
            take: 1,
            include: { progress: { orderBy: { recordedAt: 'asc' } } },
          },
        },
        orderBy: { delegate: { name: 'asc' } },
      }),
      prisma().assessmentStageConfig.findMany({
        where: { eventId: event.id, stage: 'follow_up' },
        orderBy: { wave: 'asc' },
        select: { wave: true, dueAfterDays: true, title: true },
      }),
    ]);
    const actions = templateActions(setup.template);
    const labels = setup.template.followUp.statusLabels;
    const statusText = (status: string) =>
      (commitmentStatuses as readonly string[]).includes(status)
        ? labels[status as CommitmentStatus]
        : actionProgressLabels[status as keyof typeof actionProgressLabels];
    const waveName = (w: (typeof waves)[number]) =>
      w.title?.trim() || waveLabel('follow_up', w.wave, w.dueAfterDays) || `Follow-up ${w.wave}`;
    const header = [
      'Name',
      'Email',
      'Organisation',
      'Department',
      'Batch',
      setup.template.trainingNameLabel,
      ...actions.map((a) => `${a.group} · ${a.text}`),
      'Commitment',
      setup.template.commitment.whatLabel,
      setup.template.commitment.whenLabel,
      setup.template.commitment.evidenceLabel,
      'Reminder on',
      'Saved',
      ...waves.flatMap((w) => [`${waveName(w)}: status`, `${waveName(w)}: update`]),
    ];
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    // Every batch: batch by batch, then by name (2026-11-22).
    const order = scope
      ? []
      : (
          await prisma().eventBatch.findMany({
            where: { eventId: event.id },
            orderBy: { order: 'asc' },
            select: { name: true },
          })
        ).map((b) => b.name);
    const rank = (name: string | undefined) => {
      const i = name ? order.indexOf(name) : -1;
      return i < 0 ? order.length : i;
    };
    plans.sort(
      (a, b) =>
        rank(a.delegate.batch?.name) - rank(b.delegate.batch?.name) ||
        a.delegate.name.localeCompare(b.delegate.name, 'en', { sensitivity: 'base' }),
    );
    const rows = plans.map((plan) => {
      const checklist = (plan.checklist as PlanChecklist | null) ?? null;
      const ticked = new Set(checklist?.ticked ?? []);
      const action = plan.actions[0] ?? null;
      const committed = actions.find((a) => a.key === checklist?.commitmentKey);
      return [
        plan.delegate.name,
        plan.delegate.email,
        plan.delegate.organisation ?? '',
        plan.delegate.department ?? '',
        plan.delegate.batch?.name ?? '',
        plan.trainingName,
        ...actions.map((a) => (ticked.has(a.key) ? 'Yes' : '')),
        committed?.text ?? '',
        action?.action ?? '',
        day(action?.targetOn ?? null),
        action?.evidence ?? '',
        action && action.reminderFrequency === 'once' ? day(action.reminderStartOn) : '',
        plan.submittedAt ? plan.submittedAt.toISOString() : '',
        ...waves.flatMap((w) => {
          const update = action?.progress.find((x) => x.followUpWave === w.wave);
          return [update ? statusText(update.status) : '', update?.note ?? ''];
        }),
      ];
    });
    await audit(prisma(), {
      action: 'transfer_plan.exported',
      entityType: 'event',
      entityId: event.id,
      eventId: event.id,
      actorUserId: principal.userId,
      newValue: { rows: rows.length, kind: 'commitments' },
      ...clientOf(res),
    });
    const name = `commitments-${clock().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send([header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
  });

  /**
   * The Transfer Plans as a designed PDF or Word document (2026-11-21): every submitted or
   * completed plan (`?drafts=true` adds drafts), delegate by delegate, every action with all
   * its answers, its reminder and each follow-up's record; for the checklist-and-commitment
   * form, the training, the ticks, the commitment and the updates. Audited.
   */
  router.get('/events/:eventId/transfer-plans/submissions.:format', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const format = String(req.params.format);
    if (!isDocumentFormat(format)) throw new HttpError(404, 'not_found', 'No such format.');
    const event = await loadEvent(String(req.params.eventId));
    const scope = await batchScopeOf(prisma(), event.id, req.query.batch);
    const drafts = String(req.query.drafts ?? '') === 'true';
    const [setup, detail, plans] = await Promise.all([
      planSetup(event.id),
      prisma().event.findUniqueOrThrow({ where: { id: event.id }, select: { name: true } }),
      prisma().transferPlan.findMany({
        where: {
          eventId: event.id,
          delegate: { registrationStatus: { in: [...eligible()] }, ...inBatch(scope) },
          ...(drafts ? {} : { status: { in: ['submitted', 'completed'] } }),
        },
        include: {
          ...PLAN_INCLUDE,
          delegate: {
            select: {
              name: true,
              organisation: true,
              jobTitle: true,
              department: true,
              attendanceFormat: true,
              batch: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    const { blocks, meta } = planDocument({
      organiser: organiserName(),
      batch: scope?.name ?? null,
      batchOrder: scope
        ? undefined
        : (
            await prisma().eventBatch.findMany({
              where: { eventId: event.id },
              orderBy: { order: 'asc' },
              select: { name: true },
            })
          ).map((b) => b.name),
      eventName: detail.name,
      timezone: event.timezone,
      generatedAt: clock(),
      mode: setup.mode,
      template: setup.template,
      includesDrafts: drafts,
      plans: plans.map((p) => ({ delegate: p.delegate, plan: planViewOf(p) })),
    });
    await audit(prisma(), {
      action: 'transfer_plan.exported',
      entityType: 'event',
      entityId: event.id,
      eventId: event.id,
      actorUserId: principal.userId,
      newValue: { rows: plans.length, kind: 'submissions', format, drafts },
      ...clientOf(res),
    });
    await sendDocument(res, format, blocks, meta, `${detail.name} transfer plans`);
  });

  // Every planned action with its measures and evidence classification (backlog E14-4,
  // E16-6). Evidence text is left out unless asked for (?evidence=true), and asking is audited:
  // it does not belong in a general report or export by default.
  router.get('/events/:eventId/transfer-plans/measures', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const includeEvidence = req.query.evidence === 'true' || req.query.evidence === '1';
    const plans = await prisma().transferPlan.findMany({
      where: { eventId: event.id, delegate: { registrationStatus: { in: [...eligible()] } } },
      include: {
        delegate: { select: DELEGATE_SELECT },
        actions: { orderBy: { order: 'asc' }, include: ACTION_INCLUDE },
      },
      orderBy: [{ delegate: { name: 'asc' } }],
    });
    const rows: MeasureReportRow[] = plans.flatMap((p) =>
      p.actions.map((a) => ({
        delegate: p.delegate,
        planStatus: p.status,
        action: {
          id: a.id,
          order: a.order,
          title: a.title,
          action: a.action,
          isPriority: a.isPriority,
          progressStatus: a.progressStatus,
          measureStatus: a.measureStatus,
        },
        summary: summariseMeasures(a.measureStatus, a.measures),
        measures: a.measures.map(measureViewOf),
        evidence: evidenceCounts(a.evidenceRecords),
        evidenceRecords: includeEvidence ? a.evidenceRecords.map(evidenceViewOf) : null,
      })),
    );
    if (includeEvidence) {
      await audit(prisma(), {
        action: 'transfer_plan.evidence_exported',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: {
          rows: rows.length,
          evidence: rows.reduce((n, r) => n + (r.evidenceRecords?.length ?? 0), 0),
        },
        ...clientOf(res),
      });
    }
    res.json({ rows });
  });

  router.get('/events/:eventId/transfer-plans/:delegateId', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const delegateId = String(req.params.delegateId);
    if (!UUID.test(delegateId)) throw new HttpError(404, 'not_found', 'Plan not found.');
    // `?plan=<id>` picks one of the delegate's plans; without it, their latest (2026-11-06).
    const wanted = typeof req.query.plan === 'string' ? req.query.plan : null;
    if (wanted && !UUID.test(wanted)) throw new HttpError(404, 'not_found', 'Plan not found.');
    const plan = await prisma().transferPlan.findFirst({
      where: { eventId: event.id, delegateId, ...(wanted ? { id: wanted } : {}) },
      orderBy: { sequence: 'desc' },
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
