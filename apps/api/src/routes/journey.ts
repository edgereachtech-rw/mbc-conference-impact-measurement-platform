import {
  appliedStatuses,
  assessmentStages,
  stageWindowState,
  waveLabel,
  type Journey,
  reflectionWindowState,
  transferPlanVisible,
} from '@mbc/shared';
import { Router } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import type { PrismaClient } from '../db.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const UUID = /^[0-9a-f-]{36}$/i;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
/** Session feedback the organisers have started and not yet closed. */
const OPEN_FEEDBACK = {
  feedbackEnabled: true,
  feedbackOpenedAt: { not: null },
  feedbackClosedAt: null,
} as const;

/**
 * The delegate's own journey through one event (task of 2026-10-31, §3): attendance by date,
 * each assessment stage's state, reflections and session feedback given, and the Transfer Plan
 * in numbers. Resolved from the session's own registration; no delegate id is ever accepted
 * from the client, so nobody can read another delegate's journey.
 */
export function journeyRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const eligible = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  router.get('/me/events/:eventId/journey', middleware.requireAuth, async (req, res) => {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'The journey belongs to delegates.');
    }
    const eventId = String(req.params.eventId);
    if (!UUID.test(eventId) || !principal.identityId) {
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    }
    const db = prisma();
    const delegate = await db.delegate.findFirst({
      where: {
        eventId,
        identityId: principal.identityId,
        registrationStatus: { in: [...eligible()] },
        event: { status: 'active' },
      },
      select: {
        id: true,
        // Follow-ups the organisers have sent this delegate (2026-11-09): only those are listed.
        assessmentInvitations: {
          where: { kind: 'invitation', status: 'sent' },
          select: { stageConfigId: true },
        },
        event: {
          select: {
            id: true,
            name: true,
            timezone: true,
            transferPlanVisibility: true,
            transferPlanShownFrom: true,
            dates: {
              orderBy: { date: 'asc' },
              select: { id: true, date: true, attendanceClosedAt: true },
            },
            assessmentStages: {
              select: {
                id: true,
                stage: true,
                wave: true,
                dueAfterDays: true,
                enabled: true,
                status: true,
                opensAt: true,
                closesAt: true,
                _count: { select: { questions: { where: { retiredAt: null } } } },
              },
            },
          },
        },
      },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    const at = clock();
    const [responses, attendance, reflections, feedbackSessions, feedback, plan, supportRequests] =
      await Promise.all([
        db.assessmentResponse.findMany({
          where: { delegateId: delegate.id, stage: { eventId } },
          select: { stageConfigId: true, submittedAt: true },
        }),
        db.attendanceRecord.findMany({
          where: { eventId, delegateId: delegate.id },
          select: { eventDateId: true, status: true },
        }),
        // Reflections the delegate can open right now (2026-11-08): a draft or a closed one is
        // hidden from them, and one that opens later is nothing to do yet.
        db.reflectionActivity.findMany({
          where: { eventId, status: 'published' },
          select: {
            id: true,
            status: true,
            opensAt: true,
            closesAt: true,
            _count: { select: { responses: { where: { delegateId: delegate.id } } } },
          },
        }),
        // Sessions whose feedback is open right now (2026-11-07): a pending one is not something
        // the delegate can do yet, and a closed one is no longer shown to them at all.
        db.eventSession.count({ where: { eventId, ...OPEN_FEEDBACK } }),
        db.sessionFeedbackResponse.count({
          where: { eventId, delegateId: delegate.id, session: OPEN_FEEDBACK },
        }),
        // The latest of the delegate's plans (2026-11-06): the one they are working on now.
        db.transferPlan.findFirst({
          where: { eventId, delegateId: delegate.id },
          orderBy: { sequence: 'desc' },
          include: {
            actions: {
              orderBy: { order: 'asc' },
              select: {
                action: true,
                isPriority: true,
                progressStatus: true,
                measures: { select: { actualValue: true } },
                _count: { select: { evidenceRecords: true } },
              },
            },
          },
        }),
        db.supportRequest.count({ where: { eventId, delegateId: delegate.id } }),
      ]);
    const byDate = new Map(attendance.map((a) => [a.eventDateId, a.status]));
    const dates = delegate.event.dates.map((d) => ({
      date: isoDate(d.date),
      status: byDate.get(d.id) ?? ('not_checked_in' as const),
      closed: Boolean(d.attendanceClosedAt),
    }));
    const present = dates.filter((d) => d.status === 'attended' || d.status === 'partial');
    const status: Journey['attendance']['status'] =
      dates.length && present.length === dates.length && dates.every((d) => d.status === 'attended')
        ? 'attended'
        : present.length
          ? 'partial'
          : dates.length && dates.every((d) => d.closed)
            ? 'absent'
            : 'pending';
    const journey: Journey = {
      event: {
        id: delegate.event.id,
        name: delegate.event.name,
        timezone: delegate.event.timezone,
      },
      attendance: { status, dates },
      // One row per configured wave, in stage then wave order, plus a row for a stage the event
      // does not run at all. Mapping the four stage names would report the first follow-up wave
      // and silently drop the rest (the 60- and 90-day ones), which is what it did before waves.
      assessments: assessmentStages.flatMap<Journey['assessments'][number]>((stage) => {
        const invited = new Set(delegate.assessmentInvitations.map((i) => i.stageConfigId));
        const configured = delegate.event.assessmentStages
          .filter((x) => x.stage === stage && x.enabled && x._count.questions > 0)
          // A follow-up is a next step only once its invitation has been sent (2026-11-09).
          .filter((x) => x.stage !== 'follow_up' || invited.has(x.id))
          .sort((a, b) => a.wave - b.wave);
        if (configured.length === 0) {
          return [
            {
              stage,
              wave: 1,
              waveLabel: '',
              state: 'not_configured',
              submittedAt: null,
            },
          ];
        }
        return configured.map((s) => {
          const mine = responses.find((r) => r.stageConfigId === s.id);
          const window = stageWindowState(s, at);
          const state: Journey['assessments'][number]['state'] = mine?.submittedAt
            ? 'submitted'
            : mine
              ? 'draft'
              : window === 'open'
                ? 'open'
                : window === 'closed'
                  ? 'closed'
                  : 'not_yet_open';
          return {
            stage,
            wave: s.wave,
            waveLabel: waveLabel(s.stage, s.wave, s.dueAfterDays),
            state,
            submittedAt: mine?.submittedAt?.toISOString() ?? null,
          };
        });
      }),
      reflections: (() => {
        const open = reflections.filter((r) => reflectionWindowState(r, clock()) === 'open');
        return {
          available: open.length,
          submitted: open.filter((r) => r._count.responses > 0).length,
        };
      })(),
      feedback: { sessions: feedbackSessions, submitted: feedback },
      // Transfer Planning hidden by the organisers (2026-11-08): no plan, no next step.
      transferPlanHidden: !transferPlanVisible(delegate.event, clock()),
      plan:
        plan && transferPlanVisible(delegate.event, clock())
          ? {
              status: plan.status,
              actions: plan.actions.length,
              priority: (plan.actions.find((a) => a.isPriority) ?? plan.actions[0])?.action || null,
              applied: plan.actions.filter((a) => appliedStatuses.includes(a.progressStatus))
                .length,
              measures: plan.actions.reduce((n, a) => n + a.measures.length, 0),
              withResult: plan.actions.reduce(
                (n, a) => n + a.measures.filter((m) => m.actualValue.trim()).length,
                0,
              ),
              evidence: plan.actions.reduce((n, a) => n + a._count.evidenceRecords, 0),
              reminder: plan.reminderFrequency,
              nextReminderAt: plan.nextReminderAt?.toISOString() ?? null,
              updatedAt: plan.updatedAt.toISOString(),
            }
          : null,
      // Support requests exist since 2026-11-07 (brief 11.7): "ok" once the delegate has one.
      supportRequests: { state: supportRequests > 0 ? 'ok' : 'no_response' },
    };
    res.json({ journey });
  });

  return router;
}
