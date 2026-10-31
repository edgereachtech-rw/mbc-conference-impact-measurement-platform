import { randomBytes } from 'node:crypto';

import {
  DEFAULT_FEEDBACK_QUESTIONS,
  feedbackQuestionFieldsSchema,
  feedbackQuestionOrderSchema,
  feedbackQuestionPatchSchema,
  feedbackRatingLabels,
  feedbackRatings,
  feedbackSettingsSchema,
  feedbackSubmitSchema,
  feedbackWindowState,
  ratingDistribution,
  type FeedbackDashboard,
  type FeedbackQuestionView,
  type FeedbackSessionView,
  type MyFeedback,
  type MyFeedbackListItem,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { csvCell } from '../imports/service.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const UUID = /^[0-9a-f-]{36}$/i;
const CODE = /^[A-Za-z0-9_-]{8,40}$/;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
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

const QUESTION_INCLUDE = { _count: { select: { answers: true } } } as const;
type QuestionRow = Prisma.SessionFeedbackQuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;
const questionViewOf = (q: QuestionRow): FeedbackQuestionView => ({
  id: q.id,
  questionKey: q.questionKey,
  version: q.version,
  order: q.order,
  prompt: q.prompt,
  type: q.type,
  required: q.required,
  responseCount: q._count.answers,
});

const SESSION_INCLUDE = {
  eventDate: { select: { date: true } },
  feedbackQuestions: {
    where: { retiredAt: null },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: QUESTION_INCLUDE,
  },
  _count: { select: { attendance: true, feedbackResponses: true } },
} satisfies Prisma.EventSessionInclude;
type SessionRow = Prisma.EventSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

/** A short, unguessable code for the session's link and QR code. */
export function newFeedbackCode(): string {
  return randomBytes(9).toString('base64url');
}

/**
 * Session feedback: enabled per session by admins, reached by the session's link or QR code,
 * answered after the session by delegates recorded as attending it. One response per delegate,
 * updatable with earlier revisions kept; the dashboard counts the latest. Never creates
 * attendance. Answers are never logged.
 */
export function feedbackRouter({ prisma, config, middleware, now }: Deps): Router {
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

  function sessionViewOf(s: SessionRow, at: Date): FeedbackSessionView {
    return {
      id: s.id,
      eventDateId: s.eventDateId,
      date: isoDate(s.eventDate.date),
      title: s.title,
      sessionType: s.sessionType,
      startTime: s.startTime,
      endTime: s.endTime,
      speaker: s.speaker,
      enabled: s.feedbackEnabled,
      code: s.feedbackEnabled ? s.feedbackCode : null,
      path: s.feedbackEnabled && s.feedbackCode ? `/feedback/${s.feedbackCode}` : null,
      openedAt: iso(s.feedbackOpenedAt),
      closesAt: iso(s.feedbackClosesAt),
      window: feedbackWindowState({ enabled: s.feedbackEnabled, closesAt: s.feedbackClosesAt }, at),
      questions: s.feedbackQuestions.map(questionViewOf),
      attended: s._count.attendance,
      submitted: s._count.feedbackResponses,
    };
  }

  async function loadEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, status: true, timezone: true },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  async function loadSession(eventId: string, sessionId: string) {
    if (!UUID.test(sessionId)) throw new HttpError(404, 'not_found', 'Session not found.');
    const row = await prisma().eventSession.findFirst({
      where: { id: sessionId, eventId },
      include: SESSION_INCLUDE,
    });
    if (!row) throw new HttpError(404, 'not_found', 'Session not found.');
    return row;
  }

  // ---------------------------------------------------------------- admin: configuration

  router.get('/events/:eventId/feedback', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const sessions = await prisma().eventSession.findMany({
      where: { eventId: event.id },
      include: SESSION_INCLUDE,
      orderBy: [{ eventDate: { date: 'asc' } }, { startTime: 'asc' }, { createdAt: 'asc' }],
    });
    const at = clock();
    res.json({ sessions: sessions.map((s) => sessionViewOf(s, at)) });
  });

  // Enabling creates the code and, for a session without questions, the default questionnaire.
  router.patch(
    '/events/:eventId/feedback/sessions/:sessionId',
    guard,
    validated(feedbackSettingsSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = await loadSession(event.id, String(req.params.sessionId));
      const input = req.body as z.infer<typeof feedbackSettingsSchema>;
      const at = clock();
      const updated = await prisma().$transaction(async (tx) => {
        const row = await tx.eventSession.update({
          where: { id: session.id },
          data: {
            feedbackEnabled: input.enabled,
            feedbackCode: session.feedbackCode ?? (input.enabled ? newFeedbackCode() : null),
            feedbackClosesAt:
              input.closesAt === undefined
                ? session.feedbackClosesAt
                : input.closesAt
                  ? new Date(input.closesAt)
                  : null,
          },
          include: SESSION_INCLUDE,
        });
        let seeded = 0;
        if (input.enabled && row.feedbackQuestions.length === 0) {
          const existing = await tx.sessionFeedbackQuestion.count({ where: { sessionId: row.id } });
          if (existing === 0) {
            await tx.sessionFeedbackQuestion.createMany({
              data: DEFAULT_FEEDBACK_QUESTIONS.map((q, i) => ({
                sessionId: row.id,
                eventId: event.id,
                order: i + 1,
                prompt: q.prompt,
                type: q.type,
                required: q.required,
              })),
            });
            seeded = DEFAULT_FEEDBACK_QUESTIONS.length;
          }
        }
        await audit(tx, {
          action: input.enabled ? 'feedback.enabled' : 'feedback.disabled',
          entityType: 'event_session',
          entityId: row.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: {
            title: row.title,
            closesAt: iso(row.feedbackClosesAt),
            seeded,
            at: at.toISOString(),
          },
          ...clientOf(res),
        });
        return seeded
          ? tx.eventSession.findUniqueOrThrow({ where: { id: row.id }, include: SESSION_INCLUDE })
          : row;
      });
      res.json({ session: sessionViewOf(updated, at) });
    },
  );

  // Starts the encouraged five-minute period: a timestamp for delegates and the dashboard.
  router.post('/events/:eventId/feedback/sessions/:sessionId/open', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const session = await loadSession(event.id, String(req.params.sessionId));
    if (!session.feedbackEnabled) {
      throw new HttpError(409, 'feedback_disabled', 'Enable feedback for this session first.');
    }
    const at = clock();
    const updated = await prisma().$transaction(async (tx) => {
      const row = await tx.eventSession.update({
        where: { id: session.id },
        data: { feedbackOpenedAt: at },
        include: SESSION_INCLUDE,
      });
      await audit(tx, {
        action: 'feedback.opened',
        entityType: 'event_session',
        entityId: row.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: { title: row.title, openedAt: at.toISOString() },
        ...clientOf(res),
      });
      return row;
    });
    res.json({ session: sessionViewOf(updated, at) });
  });

  // ---------------------------------------------------------------- admin: questions

  router.post(
    '/events/:eventId/feedback/sessions/:sessionId/questions',
    guard,
    validated(feedbackQuestionFieldsSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = await loadSession(event.id, String(req.params.sessionId));
      const input = req.body as z.infer<typeof feedbackQuestionFieldsSchema>;
      const last = await prisma().sessionFeedbackQuestion.aggregate({
        where: { sessionId: session.id, retiredAt: null },
        _max: { order: true },
      });
      const created = await prisma().$transaction(async (tx) => {
        const row = await tx.sessionFeedbackQuestion.create({
          data: {
            sessionId: session.id,
            eventId: event.id,
            order: (last._max.order ?? 0) + 1,
            prompt: input.prompt,
            type: input.type,
            required: input.required,
          },
          include: QUESTION_INCLUDE,
        });
        await audit(tx, {
          action: 'feedback.question_created',
          entityType: 'session_feedback_question',
          entityId: row.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { sessionId: session.id, prompt: row.prompt, type: row.type },
          ...clientOf(res),
        });
        return row;
      });
      res.status(201).json({ question: questionViewOf(created) });
    },
  );

  router.patch(
    '/events/:eventId/feedback/sessions/:sessionId/questions/:questionId',
    guard,
    validated(feedbackQuestionPatchSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = await loadSession(event.id, String(req.params.sessionId));
      const current = session.feedbackQuestions.find((q) => q.id === String(req.params.questionId));
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      const patch = req.body as z.infer<typeof feedbackQuestionPatchSchema>;
      const next = {
        prompt: patch.prompt ?? current.prompt,
        type: patch.type ?? current.type,
        required: patch.required ?? current.required,
      };
      const meaningChanged = next.prompt !== current.prompt || next.type !== current.type;
      const versioned = meaningChanged && current._count.answers > 0;
      const at = clock();
      const row = await prisma().$transaction(async (tx) => {
        let saved: QuestionRow;
        if (versioned) {
          await tx.sessionFeedbackQuestion.update({
            where: { id: current.id },
            data: { retiredAt: at },
          });
          saved = await tx.sessionFeedbackQuestion.create({
            data: {
              sessionId: session.id,
              eventId: event.id,
              questionKey: current.questionKey,
              version: current.version + 1,
              order: current.order,
              ...next,
            },
            include: QUESTION_INCLUDE,
          });
        } else {
          saved = await tx.sessionFeedbackQuestion.update({
            where: { id: current.id },
            data: next,
            include: QUESTION_INCLUDE,
          });
        }
        await audit(tx, {
          action: versioned ? 'feedback.question_versioned' : 'feedback.question_updated',
          entityType: 'session_feedback_question',
          entityId: saved.id,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: {
            prompt: current.prompt,
            type: current.type,
            required: current.required,
            version: current.version,
          },
          newValue: { ...next, version: saved.version },
          ...clientOf(res),
        });
        return saved;
      });
      res.json({ question: questionViewOf(row) });
    },
  );

  router.delete(
    '/events/:eventId/feedback/sessions/:sessionId/questions/:questionId',
    guard,
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = await loadSession(event.id, String(req.params.sessionId));
      const current = session.feedbackQuestions.find((q) => q.id === String(req.params.questionId));
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      const keep = current._count.answers > 0;
      await prisma().$transaction(async (tx) => {
        if (keep) {
          await tx.sessionFeedbackQuestion.update({
            where: { id: current.id },
            data: { retiredAt: clock() },
          });
        } else {
          await tx.sessionFeedbackQuestion.delete({ where: { id: current.id } });
        }
        await audit(tx, {
          action: keep ? 'feedback.question_retired' : 'feedback.question_deleted',
          entityType: 'session_feedback_question',
          entityId: current.id,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: { prompt: current.prompt, answers: current._count.answers },
          ...clientOf(res),
        });
      });
      res.status(204).end();
    },
  );

  router.put(
    '/events/:eventId/feedback/sessions/:sessionId/questions/order',
    guard,
    validated(feedbackQuestionOrderSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = await loadSession(event.id, String(req.params.sessionId));
      const { questionIds } = req.body as z.infer<typeof feedbackQuestionOrderSchema>;
      const ids = session.feedbackQuestions.map((q) => q.id);
      if (questionIds.length !== ids.length || !ids.every((id) => questionIds.includes(id))) {
        throw new HttpError(
          422,
          'validation_failed',
          'questionIds: list every active question exactly once.',
        );
      }
      await prisma().$transaction(async (tx) => {
        for (const [index, id] of questionIds.entries()) {
          await tx.sessionFeedbackQuestion.update({ where: { id }, data: { order: index + 1 } });
        }
        await audit(tx, {
          action: 'feedback.questions_reordered',
          entityType: 'event_session',
          entityId: session.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { questionIds },
          ...clientOf(res),
        });
      });
      const fresh = await loadSession(event.id, session.id);
      res.json({ session: sessionViewOf(fresh, clock()) });
    },
  );

  // ---------------------------------------------------------------- admin: dashboard and export

  /** The latest answers per delegate, mapped to the current question versions. */
  async function latestAnswers(session: SessionRow) {
    const [responses, allQuestions] = await Promise.all([
      prisma().sessionFeedbackResponse.findMany({
        where: { sessionId: session.id },
        select: {
          submittedAt: true,
          updatedAt: true,
          delegate: { select: { id: true, name: true } },
          answers: { select: { questionId: true, value: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma().sessionFeedbackQuestion.findMany({
        where: { sessionId: session.id },
        select: { id: true, questionKey: true },
      }),
    ]);
    const keyOf = new Map(allQuestions.map((q) => [q.id, q.questionKey]));
    const currentByKey = new Map(session.feedbackQuestions.map((q) => [q.questionKey, q.id]));
    return responses.map((r) => ({
      delegate: r.delegate,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
      answers: new Map(
        r.answers.map((a) => [
          currentByKey.get(keyOf.get(a.questionId) ?? '') ?? a.questionId,
          a.value,
        ]),
      ),
    }));
  }

  async function dashboardOf(
    event: { id: string; name: string },
    session: SessionRow,
    anonymised: boolean,
  ): Promise<FeedbackDashboard> {
    const rows = await latestAnswers(session);
    const at = clock();
    const view = sessionViewOf(session, at);
    return {
      event: { id: event.id, name: event.name },
      session: view,
      distributions: view.questions
        .filter((q) => q.type === 'rating')
        .map((q) => ({
          questionId: q.id,
          prompt: q.prompt,
          ...ratingDistribution(rows.map((r) => r.answers.get(q.id) ?? '')),
        })),
      written: view.questions
        .filter((q) => q.type === 'long_text')
        .map((q) => ({
          questionId: q.id,
          prompt: q.prompt,
          responses: rows
            .filter((r) => (r.answers.get(q.id) ?? '').trim())
            .map((r) => ({
              delegate: anonymised ? null : r.delegate,
              value: r.answers.get(q.id)!,
              submittedAt: r.updatedAt.toISOString(),
            })),
        })),
      anonymised,
      generatedAt: at.toISOString(),
    };
  }

  router.get('/events/:eventId/feedback/sessions/:sessionId/dashboard', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const session = await loadSession(event.id, String(req.params.sessionId));
    const anonymised = String(req.query.anonymised ?? '') === 'true';
    const dashboard = await dashboardOf(event, session, anonymised);
    await audit(prisma(), {
      action: 'feedback.viewed',
      entityType: 'event_session',
      entityId: session.id,
      eventId: event.id,
      actorUserId: principal.userId,
      newValue: { anonymised, responses: dashboard.session.submitted },
      ...clientOf(res),
    });
    res.json({ dashboard });
  });

  // CSV: the session block, one distribution table per rating question, then the written
  // responses of the latest revision per delegate. anonymised=true leaves delegate names out.
  router.get(
    '/events/:eventId/feedback/sessions/:sessionId/export.csv',
    guard,
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = await loadSession(event.id, String(req.params.sessionId));
      const anonymised = String(req.query.anonymised ?? '') === 'true';
      const d = await dashboardOf(event, session, anonymised);
      const lines: string[][] = [
        ['Event', d.event.name],
        ['Session', d.session.title],
        ['Date', d.session.date],
        ['Time', `${d.session.startTime}-${d.session.endTime}`],
        ['Speaker or facilitator', d.session.speaker ?? ''],
        ['Delegates recorded as attending', String(d.session.attended)],
        ['Feedback submissions (latest per delegate)', String(d.session.submitted)],
        ['Generated at (UTC)', d.generatedAt],
        [],
      ];
      for (const dist of d.distributions) {
        lines.push([dist.prompt], ['Rating', 'Responses', 'Percentage']);
        for (const r of dist.ratings) {
          lines.push([feedbackRatingLabels[r.rating], String(r.count), `${r.percent}%`]);
        }
        lines.push(['Total', String(dist.total), dist.total ? '100%' : '0%'], []);
      }
      for (const w of d.written) {
        lines.push(
          [w.prompt],
          anonymised
            ? ['Response', 'Submitted at (UTC)']
            : ['Delegate', 'Response', 'Submitted at (UTC)'],
        );
        for (const r of w.responses) {
          lines.push(
            anonymised
              ? [r.value, r.submittedAt]
              : [r.delegate?.name ?? '', r.value, r.submittedAt],
          );
        }
        lines.push([]);
      }
      await audit(prisma(), {
        action: 'feedback.exported',
        entityType: 'event_session',
        entityId: session.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: { anonymised, responses: d.session.submitted },
        ...clientOf(res),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="session-feedback-${d.session.date}${anonymised ? '-anonymised' : ''}.csv"`,
      );
      res.send(`\uFEFF${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`);
    },
  );

  // ---------------------------------------------------------------- delegate

  function requireDelegate(res: Response) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate' || !principal.identityId) {
      throw new HttpError(403, 'forbidden', 'Session feedback is given by delegates.');
    }
    return principal;
  }

  /** The session behind a code, with the caller's registration and attendance for it. */
  async function sessionForDelegate(res: Response, code: string) {
    const principal = requireDelegate(res);
    if (!CODE.test(code)) throw new HttpError(404, 'not_found', 'This feedback link is not valid.');
    const session = await prisma().eventSession.findFirst({
      where: { feedbackCode: code, feedbackEnabled: true, event: { status: 'active' } },
      include: { ...SESSION_INCLUDE, event: { select: { id: true, name: true, timezone: true } } },
    });
    if (!session) throw new HttpError(404, 'not_found', 'This feedback link is not valid.');
    const delegate = await prisma().delegate.findFirst({
      where: {
        eventId: session.eventId,
        identityId: principal.identityId!,
        registrationStatus: { in: [...eligible()] },
      },
      select: { id: true },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'This feedback link is not valid.');
    const [attendance, response] = await Promise.all([
      prisma().sessionAttendance.findUnique({
        where: { delegateId_sessionId: { delegateId: delegate.id, sessionId: session.id } },
        select: { id: true },
      }),
      prisma().sessionFeedbackResponse.findUnique({
        where: { sessionId_delegateId: { sessionId: session.id, delegateId: delegate.id } },
        select: {
          id: true,
          revision: true,
          submittedAt: true,
          updatedAt: true,
          answers: { select: { questionId: true, value: true } },
        },
      }),
    ]);
    return { principal, session, delegate, attended: Boolean(attendance), response };
  }

  function myFeedbackOf(s: Awaited<ReturnType<typeof sessionForDelegate>>, at: Date): MyFeedback {
    const window = feedbackWindowState(
      { enabled: s.session.feedbackEnabled, closesAt: s.session.feedbackClosesAt },
      at,
    );
    return {
      session: {
        id: s.session.id,
        eventId: s.session.event.id,
        eventName: s.session.event.name,
        date: isoDate(s.session.eventDate.date),
        title: s.session.title,
        speaker: s.session.speaker,
        startTime: s.session.startTime,
        endTime: s.session.endTime,
        timezone: s.session.event.timezone,
      },
      window: window === 'open' ? 'open' : 'closed',
      openedAt: iso(s.session.feedbackOpenedAt),
      closesAt: iso(s.session.feedbackClosesAt),
      attended: s.attended,
      questions: s.session.feedbackQuestions.map((q) => {
        const { responseCount: _n, ...view } = questionViewOf(q);
        return view;
      }),
      response: s.response
        ? {
            submittedAt: s.response.submittedAt.toISOString(),
            updatedAt: s.response.updatedAt.toISOString(),
            revision: s.response.revision,
            answers: Object.fromEntries(s.response.answers.map((a) => [a.questionId, a.value])),
          }
        : null,
      canSubmit: window === 'open' && s.attended,
    };
  }

  router.get('/me/feedback/:code', middleware.requireAuth, async (req, res) => {
    const s = await sessionForDelegate(res, String(req.params.code));
    res.json({ feedback: myFeedbackOf(s, clock()) });
  });

  router.put(
    '/me/feedback/:code',
    middleware.requireAuth,
    validated(feedbackSubmitSchema),
    async (req, res) => {
      const s = await sessionForDelegate(res, String(req.params.code));
      const at = clock();
      const window = feedbackWindowState(
        { enabled: s.session.feedbackEnabled, closesAt: s.session.feedbackClosesAt },
        at,
      );
      if (window !== 'open') {
        throw new HttpError(409, 'feedback_closed', 'Feedback for this session is closed.');
      }
      if (!s.attended) {
        throw new HttpError(
          403,
          'not_attended',
          'Feedback is open to delegates recorded as attending this session. If you attended, ask the organisers to record it.',
        );
      }
      const { answers } = req.body as z.infer<typeof feedbackSubmitSchema>;
      const byId = new Map(s.session.feedbackQuestions.map((q) => [q.id, q]));
      const problems: Record<string, string> = {};
      const kept: Array<{ questionId: string; value: string }> = [];
      for (const [questionId, raw] of Object.entries(answers)) {
        const q = byId.get(questionId);
        if (!q) {
          problems[questionId] = 'This question is not part of the feedback form.';
          continue;
        }
        const value = raw.trim();
        if (!value) continue;
        if (q.type === 'rating' && !(feedbackRatings as readonly string[]).includes(value)) {
          problems[questionId] = 'Choose one of the ratings.';
          continue;
        }
        kept.push({ questionId, value });
      }
      for (const q of s.session.feedbackQuestions) {
        if (q.required && !kept.some((k) => k.questionId === q.id) && !problems[q.id]) {
          problems[q.id] =
            q.type === 'rating'
              ? 'Choose a rating before you submit.'
              : 'This question needs an answer before you submit.';
        }
      }
      if (Object.keys(problems).length) {
        res.status(422).json({
          error: {
            code: 'answers_invalid',
            message: 'Some answers need attention.',
            requestId: String(res.getHeader('x-request-id') ?? ''),
          },
          problems,
        });
        return;
      }
      const attendanceBefore = await prisma().sessionAttendance.count({
        where: { delegateId: s.delegate.id },
      });
      const updated = Boolean(s.response);
      await prisma().$transaction(async (tx) => {
        let responseId: string;
        if (s.response) {
          // Keep the previous revision, then replace the answers.
          await tx.sessionFeedbackRevision.create({
            data: {
              responseId: s.response.id,
              revision: s.response.revision,
              answers: Object.fromEntries(s.response.answers.map((a) => [a.questionId, a.value])),
              submittedAt: s.response.updatedAt,
            },
          });
          await tx.sessionFeedbackAnswer.deleteMany({ where: { responseId: s.response.id } });
          await tx.sessionFeedbackResponse.update({
            where: { id: s.response.id },
            data: { revision: s.response.revision + 1, updatedAt: at },
          });
          responseId = s.response.id;
        } else {
          const created = await tx.sessionFeedbackResponse.create({
            data: {
              sessionId: s.session.id,
              eventId: s.session.eventId,
              delegateId: s.delegate.id,
              submittedAt: at,
              updatedAt: at,
            },
          });
          responseId = created.id;
        }
        if (kept.length) {
          await tx.sessionFeedbackAnswer.createMany({
            data: kept.map((k) => ({ responseId, questionId: k.questionId, value: k.value })),
          });
        }
        await audit(tx, {
          action: updated ? 'feedback.updated' : 'feedback.submitted',
          entityType: 'session_feedback_response',
          entityId: responseId,
          eventId: s.session.eventId,
          actorUserId: s.principal.userId,
          newValue: {
            sessionId: s.session.id,
            delegateId: s.delegate.id,
            answered: kept.length,
            revision: (s.response?.revision ?? 0) + 1,
          },
          ...clientOf(res),
        });
      });
      // Feedback never records attendance; the count is unchanged by construction.
      void attendanceBefore;
      const fresh = await sessionForDelegate(res, String(req.params.code));
      res.status(updated ? 200 : 201).json({ feedback: myFeedbackOf(fresh, at) });
    },
  );

  // The delegate's sessions with feedback enabled, for the event page.
  router.get('/me/events/:eventId/feedback', middleware.requireAuth, async (req, res) => {
    const principal = requireDelegate(res);
    const eventId = String(req.params.eventId);
    if (!UUID.test(eventId))
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    const delegate = await prisma().delegate.findFirst({
      where: {
        eventId,
        identityId: principal.identityId!,
        registrationStatus: { in: [...eligible()] },
        event: { status: 'active' },
      },
      select: { id: true },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    const [sessions, attended, responses] = await Promise.all([
      prisma().eventSession.findMany({
        where: { eventId, feedbackEnabled: true, feedbackCode: { not: null } },
        select: {
          id: true,
          feedbackCode: true,
          feedbackClosesAt: true,
          title: true,
          speaker: true,
          eventDate: { select: { date: true } },
        },
        orderBy: [{ eventDate: { date: 'asc' } }, { startTime: 'asc' }],
      }),
      prisma().sessionAttendance.findMany({
        where: { delegateId: delegate.id },
        select: { sessionId: true },
      }),
      prisma().sessionFeedbackResponse.findMany({
        where: { delegateId: delegate.id },
        select: { sessionId: true, updatedAt: true },
      }),
    ]);
    const at = clock();
    const attendedIds = new Set(attended.map((a) => a.sessionId));
    const submitted = new Map(responses.map((r) => [r.sessionId, r.updatedAt]));
    const items: MyFeedbackListItem[] = sessions.map((s) => ({
      sessionId: s.id,
      code: s.feedbackCode!,
      path: `/feedback/${s.feedbackCode}`,
      date: isoDate(s.eventDate.date),
      title: s.title,
      speaker: s.speaker,
      window:
        feedbackWindowState({ enabled: true, closesAt: s.feedbackClosesAt }, at) === 'open'
          ? 'open'
          : 'closed',
      attended: attendedIds.has(s.id),
      submittedAt: submitted.get(s.id)?.toISOString() ?? null,
    }));
    res.json({ sessions: items });
  });

  return router;
}
