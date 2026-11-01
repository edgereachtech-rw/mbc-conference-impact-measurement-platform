import { appliedStatuses, assessmentStages, stageWindowState, type Journey } from '@mbc/shared';
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
        event: {
          select: {
            id: true,
            name: true,
            timezone: true,
            dates: {
              orderBy: { date: 'asc' },
              select: { id: true, date: true, attendanceClosedAt: true },
            },
            assessmentStages: {
              select: {
                id: true,
                stage: true,
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
    const [responses, attendance, reflections, feedbackSessions, feedback, plan] =
      await Promise.all([
        db.assessmentResponse.findMany({
          where: { delegateId: delegate.id, stage: { eventId } },
          select: { stageConfigId: true, submittedAt: true },
        }),
        db.attendanceRecord.findMany({
          where: { eventId, delegateId: delegate.id },
          select: { eventDateId: true, status: true },
        }),
        db.reflectionActivity.findMany({
          where: { eventId, status: { not: 'draft' } },
          select: {
            id: true,
            _count: { select: { responses: { where: { delegateId: delegate.id } } } },
          },
        }),
        db.eventSession.count({ where: { eventId, feedbackEnabled: true } }),
        db.sessionFeedbackResponse.count({ where: { eventId, delegateId: delegate.id } }),
        db.transferPlan.findUnique({
          where: { eventId_delegateId: { eventId, delegateId: delegate.id } },
          include: {
            actions: {
              orderBy: { order: 'asc' },
              select: {
                action: true,
                isPriority: true,
                progressStatus: true,
                measures: { select: { status: true, actualValue: true } },
                _count: { select: { evidenceRecords: true } },
              },
            },
          },
        }),
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
      assessments: assessmentStages.map((stage) => {
        const s = delegate.event.assessmentStages.find((x) => x.stage === stage);
        if (!s || !s.enabled || s._count.questions === 0) {
          return { stage, state: 'not_configured' as const, submittedAt: null };
        }
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
        return { stage, state, submittedAt: mine?.submittedAt?.toISOString() ?? null };
      }),
      reflections: {
        available: reflections.length,
        submitted: reflections.filter((r) => r._count.responses > 0).length,
      },
      feedback: { sessions: feedbackSessions, submitted: feedback },
      plan: plan
        ? {
            status: plan.status,
            actions: plan.actions.length,
            priority: (plan.actions.find((a) => a.isPriority) ?? plan.actions[0])?.action || null,
            applied: plan.actions.filter((a) => appliedStatuses.includes(a.progressStatus)).length,
            measures: plan.actions.reduce((n, a) => n + a.measures.length, 0),
            withResult: plan.actions.reduce(
              (n, a) =>
                n +
                a.measures.filter((m) => m.status === 'identified' && m.actualValue.trim()).length,
              0,
            ),
            evidence: plan.actions.reduce((n, a) => n + a._count.evidenceRecords, 0),
            reminder: plan.reminderFrequency,
            nextReminderAt: plan.nextReminderAt?.toISOString() ?? null,
            updatedAt: plan.updatedAt.toISOString(),
          }
        : null,
      supportRequests: { state: 'not_collected' },
    };
    res.json({ journey });
  });

  return router;
}
