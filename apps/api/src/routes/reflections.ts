import {
  reflectionActivityFieldsSchema,
  reflectionQuestionFieldsSchema,
  reflectionQuestionOrderSchema,
  reflectionQuestionPatchSchema,
  reflectionSubmitSchema,
  reflectionWindowState,
  type MyReflection,
  type ReflectionActivityView,
  type ReflectionConcern,
  type ReflectionDateView,
  type ReflectionQuestionView,
  type ReflectionResponses,
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
type QuestionRow = Prisma.ReflectionQuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;
const questionViewOf = (q: QuestionRow): ReflectionQuestionView => ({
  id: q.id,
  questionKey: q.questionKey,
  version: q.version,
  order: q.order,
  prompt: q.prompt,
  type: q.type,
  required: q.required,
  concern: q.concern,
  responseCount: q._count.answers,
});

const ACTIVITY_INCLUDE = {
  eventDate: { select: { date: true } },
  questions: {
    where: { retiredAt: null },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: QUESTION_INCLUDE,
  },
  _count: { select: { responses: true } },
} satisfies Prisma.ReflectionActivityInclude;
type ActivityRow = Prisma.ReflectionActivityGetPayload<{ include: typeof ACTIVITY_INCLUDE }>;

const DELEGATE_SELECT = { id: true, name: true, email: true, organisation: true } as const;

/**
 * Daily Learning Reflections: per event date, enabled by creating an activity, configured and
 * published by admins, answered once by each registered delegate. Answers are never logged.
 */
export function reflectionRouter({ prisma, config, middleware, now }: Deps): Router {
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
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        dates: { orderBy: { date: 'asc' }, select: { id: true, date: true } },
      },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  async function registeredCount(eventId: string) {
    return prisma().delegate.count({
      where: { eventId, registrationStatus: { in: [...eligible()] } },
    });
  }

  function activityViewOf(a: ActivityRow, registered: number): ReflectionActivityView {
    return {
      id: a.id,
      eventDateId: a.eventDateId,
      date: isoDate(a.eventDate.date),
      title: a.title,
      status: a.status,
      opensAt: iso(a.opensAt),
      closesAt: iso(a.closesAt),
      publishedAt: iso(a.publishedAt),
      closedAt: iso(a.closedAt),
      questions: a.questions.map(questionViewOf),
      submitted: a._count.responses,
      registered,
    };
  }

  async function loadActivity(eventId: string, activityId: string) {
    if (!UUID.test(activityId)) throw new HttpError(404, 'not_found', 'Reflection not found.');
    const row = await prisma().reflectionActivity.findFirst({
      where: { id: activityId, eventId },
      include: ACTIVITY_INCLUDE,
    });
    if (!row) throw new HttpError(404, 'not_found', 'Reflection not found.');
    return row;
  }

  async function concernsOf(eventId: string): Promise<ReflectionConcern[]> {
    const answers = await prisma().reflectionAnswer.findMany({
      where: { question: { eventId, concern: true }, response: { eventId } },
      select: {
        value: true,
        question: { select: { id: true, prompt: true } },
        response: {
          select: {
            submittedAt: true,
            delegate: { select: DELEGATE_SELECT },
            activity: { select: { id: true, title: true, eventDate: { select: { date: true } } } },
          },
        },
      },
      orderBy: { response: { submittedAt: 'desc' } },
    });
    return answers
      .filter((a) => a.value.trim().length > 0)
      .map((a) => ({
        activityId: a.response.activity.id,
        activityTitle: a.response.activity.title,
        date: isoDate(a.response.activity.eventDate.date),
        questionId: a.question.id,
        prompt: a.question.prompt,
        delegate: a.response.delegate,
        value: a.value,
        submittedAt: a.response.submittedAt.toISOString(),
      }));
  }

  async function listFor(eventId: string) {
    const event = await loadEvent(eventId);
    const [activities, registered] = await Promise.all([
      prisma().reflectionActivity.findMany({ where: { eventId }, include: ACTIVITY_INCLUDE }),
      registeredCount(eventId),
    ]);
    const byDate = new Map(activities.map((a) => [a.eventDateId, a]));
    const dates: ReflectionDateView[] = event.dates.map((d) => {
      const a = byDate.get(d.id);
      return {
        date: { id: d.id, date: isoDate(d.date) },
        activity: a ? activityViewOf(a, registered) : null,
      };
    });
    return { dates, concerns: await concernsOf(eventId) };
  }

  // ---------------------------------------------------------------- admin: activities

  router.get('/events/:eventId/reflections', guard, async (req, res) => {
    requireAdmin(res);
    res.json(await listFor(String(req.params.eventId)));
  });

  // Enabling a date = creating its reflection, as a draft.
  router.post(
    '/events/:eventId/reflections/dates/:dateId',
    guard,
    validated(reflectionActivityFieldsSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const date = event.dates.find((d) => d.id === String(req.params.dateId));
      if (!date) throw new HttpError(404, 'not_found', 'Event date not found.');
      const existing = await prisma().reflectionActivity.findUnique({
        where: { eventDateId: date.id },
      });
      if (existing)
        throw new HttpError(409, 'already_enabled', 'This date already has a reflection.');
      const input = req.body as z.infer<typeof reflectionActivityFieldsSchema>;
      const created = await prisma().$transaction(async (tx) => {
        const row = await tx.reflectionActivity.create({
          data: {
            eventId: event.id,
            eventDateId: date.id,
            title: input.title,
            opensAt: input.opensAt ? new Date(input.opensAt) : null,
            closesAt: input.closesAt ? new Date(input.closesAt) : null,
          },
          include: ACTIVITY_INCLUDE,
        });
        await audit(tx, {
          action: 'reflection.enabled',
          entityType: 'reflection_activity',
          entityId: row.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { date: isoDate(date.date), title: row.title },
          ...clientOf(res),
        });
        return row;
      });
      res.status(201).json({ activity: activityViewOf(created, await registeredCount(event.id)) });
    },
  );

  router.patch(
    '/events/:eventId/reflections/:activityId',
    guard,
    validated(reflectionActivityFieldsSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const current = await loadActivity(String(req.params.eventId), String(req.params.activityId));
      const input = req.body as z.infer<typeof reflectionActivityFieldsSchema>;
      const updated = await prisma().$transaction(async (tx) => {
        const row = await tx.reflectionActivity.update({
          where: { id: current.id },
          data: {
            title: input.title,
            opensAt: input.opensAt ? new Date(input.opensAt) : null,
            closesAt: input.closesAt ? new Date(input.closesAt) : null,
          },
          include: ACTIVITY_INCLUDE,
        });
        await audit(tx, {
          action: 'reflection.updated',
          entityType: 'reflection_activity',
          entityId: row.id,
          eventId: current.eventId,
          actorUserId: principal.userId,
          oldValue: {
            title: current.title,
            opensAt: iso(current.opensAt),
            closesAt: iso(current.closesAt),
          },
          newValue: { title: row.title, opensAt: iso(row.opensAt), closesAt: iso(row.closesAt) },
          ...clientOf(res),
        });
        return row;
      });
      res.json({ activity: activityViewOf(updated, await registeredCount(current.eventId)) });
    },
  );

  async function transition(req: Request, res: Response, to: 'published' | 'closed') {
    const principal = requireAdmin(res);
    const current = await loadActivity(String(req.params.eventId), String(req.params.activityId));
    if (to === 'published') {
      if (current.status !== 'draft') {
        throw new HttpError(409, 'not_draft', 'Only a draft can be published.');
      }
      if (current.questions.length === 0) {
        throw new HttpError(422, 'no_questions', 'Add at least one question before publishing.');
      }
    } else if (current.status !== 'published') {
      throw new HttpError(409, 'not_published', 'Only a published reflection can be closed.');
    }
    const at = clock();
    const updated = await prisma().$transaction(async (tx) => {
      const row = await tx.reflectionActivity.update({
        where: { id: current.id },
        data:
          to === 'published'
            ? { status: 'published', publishedAt: at }
            : { status: 'closed', closedAt: at },
        include: ACTIVITY_INCLUDE,
      });
      await audit(tx, {
        action: to === 'published' ? 'reflection.published' : 'reflection.closed',
        entityType: 'reflection_activity',
        entityId: row.id,
        eventId: current.eventId,
        actorUserId: principal.userId,
        newValue: { date: isoDate(row.eventDate.date), questions: row.questions.length },
        ...clientOf(res),
      });
      return row;
    });
    res.json({ activity: activityViewOf(updated, await registeredCount(current.eventId)) });
  }
  router.post('/events/:eventId/reflections/:activityId/publish', guard, (req, res) =>
    transition(req, res, 'published'),
  );
  router.post('/events/:eventId/reflections/:activityId/close', guard, (req, res) =>
    transition(req, res, 'closed'),
  );

  // Disabling a date = deleting its reflection, only while nobody has answered.
  router.delete('/events/:eventId/reflections/:activityId', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const current = await loadActivity(String(req.params.eventId), String(req.params.activityId));
    if (current._count.responses > 0) {
      throw new HttpError(409, 'has_responses', 'Delegates have answered; close it instead.');
    }
    await prisma().$transaction(async (tx) => {
      await tx.reflectionActivity.delete({ where: { id: current.id } });
      await audit(tx, {
        action: 'reflection.disabled',
        entityType: 'reflection_activity',
        entityId: current.id,
        eventId: current.eventId,
        actorUserId: principal.userId,
        oldValue: { date: isoDate(current.eventDate.date), title: current.title },
        ...clientOf(res),
      });
    });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- admin: questions

  router.post(
    '/events/:eventId/reflections/:activityId/questions',
    guard,
    validated(reflectionQuestionFieldsSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const activity = await loadActivity(
        String(req.params.eventId),
        String(req.params.activityId),
      );
      const input = req.body as z.infer<typeof reflectionQuestionFieldsSchema>;
      const last = await prisma().reflectionQuestion.aggregate({
        where: { activityId: activity.id, retiredAt: null },
        _max: { order: true },
      });
      const created = await prisma().$transaction(async (tx) => {
        const row = await tx.reflectionQuestion.create({
          data: {
            activityId: activity.id,
            eventId: activity.eventId,
            order: (last._max.order ?? 0) + 1,
            prompt: input.prompt,
            type: input.type,
            required: input.required,
            concern: input.concern,
          },
          include: QUESTION_INCLUDE,
        });
        await audit(tx, {
          action: 'reflection.question_created',
          entityType: 'reflection_question',
          entityId: row.id,
          eventId: activity.eventId,
          actorUserId: principal.userId,
          newValue: { activityId: activity.id, prompt: row.prompt, concern: row.concern },
          ...clientOf(res),
        });
        return row;
      });
      res.status(201).json({ question: questionViewOf(created) });
    },
  );

  router.patch(
    '/events/:eventId/reflections/:activityId/questions/:questionId',
    guard,
    validated(reflectionQuestionPatchSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const activity = await loadActivity(
        String(req.params.eventId),
        String(req.params.activityId),
      );
      const current = activity.questions.find((q) => q.id === String(req.params.questionId));
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      const patch = req.body as z.infer<typeof reflectionQuestionPatchSchema>;
      const next = {
        prompt: patch.prompt ?? current.prompt,
        type: patch.type ?? current.type,
        required: patch.required ?? current.required,
        concern: patch.concern ?? current.concern,
      };
      // Wording or type changes after answers: a new version keeps the old answers honest.
      const meaningChanged = next.prompt !== current.prompt || next.type !== current.type;
      const versioned = meaningChanged && current._count.answers > 0;
      const at = clock();
      const row = await prisma().$transaction(async (tx) => {
        let saved: QuestionRow;
        if (versioned) {
          await tx.reflectionQuestion.update({
            where: { id: current.id },
            data: { retiredAt: at },
          });
          saved = await tx.reflectionQuestion.create({
            data: {
              activityId: activity.id,
              eventId: activity.eventId,
              questionKey: current.questionKey,
              version: current.version + 1,
              order: current.order,
              ...next,
            },
            include: QUESTION_INCLUDE,
          });
        } else {
          saved = await tx.reflectionQuestion.update({
            where: { id: current.id },
            data: next,
            include: QUESTION_INCLUDE,
          });
        }
        await audit(tx, {
          action: versioned ? 'reflection.question_versioned' : 'reflection.question_updated',
          entityType: 'reflection_question',
          entityId: saved.id,
          eventId: activity.eventId,
          actorUserId: principal.userId,
          oldValue: {
            prompt: current.prompt,
            type: current.type,
            required: current.required,
            concern: current.concern,
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
    '/events/:eventId/reflections/:activityId/questions/:questionId',
    guard,
    async (req, res) => {
      const principal = requireAdmin(res);
      const activity = await loadActivity(
        String(req.params.eventId),
        String(req.params.activityId),
      );
      const current = activity.questions.find((q) => q.id === String(req.params.questionId));
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      const keep = current._count.answers > 0;
      await prisma().$transaction(async (tx) => {
        if (keep)
          await tx.reflectionQuestion.update({
            where: { id: current.id },
            data: { retiredAt: clock() },
          });
        else await tx.reflectionQuestion.delete({ where: { id: current.id } });
        await audit(tx, {
          action: keep ? 'reflection.question_retired' : 'reflection.question_deleted',
          entityType: 'reflection_question',
          entityId: current.id,
          eventId: activity.eventId,
          actorUserId: principal.userId,
          oldValue: { prompt: current.prompt, answers: current._count.answers },
          ...clientOf(res),
        });
      });
      res.status(204).end();
    },
  );

  router.put(
    '/events/:eventId/reflections/:activityId/questions/order',
    guard,
    validated(reflectionQuestionOrderSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const activity = await loadActivity(
        String(req.params.eventId),
        String(req.params.activityId),
      );
      const { questionIds } = req.body as z.infer<typeof reflectionQuestionOrderSchema>;
      const ids = activity.questions.map((q) => q.id);
      if (questionIds.length !== ids.length || !ids.every((id) => questionIds.includes(id))) {
        throw new HttpError(
          422,
          'validation_failed',
          'questionIds: list every active question exactly once.',
        );
      }
      await prisma().$transaction(async (tx) => {
        for (const [index, id] of questionIds.entries()) {
          await tx.reflectionQuestion.update({ where: { id }, data: { order: index + 1 } });
        }
        await audit(tx, {
          action: 'reflection.questions_reordered',
          entityType: 'reflection_activity',
          entityId: activity.id,
          eventId: activity.eventId,
          actorUserId: principal.userId,
          newValue: { questionIds },
          ...clientOf(res),
        });
      });
      const fresh = await loadActivity(activity.eventId, activity.id);
      res.json({ activity: activityViewOf(fresh, await registeredCount(activity.eventId)) });
    },
  );

  // ---------------------------------------------------------------- admin: responses

  router.get('/events/:eventId/reflections/concerns', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    res.json({ concerns: await concernsOf(event.id) });
  });

  router.get('/events/:eventId/reflections/:activityId/responses', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const activity = await loadActivity(String(req.params.eventId), String(req.params.activityId));
    const [registered, responses, allQuestions] = await Promise.all([
      prisma().delegate.findMany({
        where: { eventId: activity.eventId, registrationStatus: { in: [...eligible()] } },
        select: DELEGATE_SELECT,
        orderBy: [{ name: 'asc' }],
      }),
      prisma().reflectionResponse.findMany({
        where: { activityId: activity.id },
        select: {
          submittedAt: true,
          delegate: { select: DELEGATE_SELECT },
          answers: { select: { questionId: true, value: true } },
        },
        orderBy: { submittedAt: 'desc' },
      }),
      prisma().reflectionQuestion.findMany({
        where: { activityId: activity.id },
        select: { id: true, questionKey: true },
      }),
    ]);
    // Answers given to an earlier version of a question show under its current version.
    const keyOf = new Map(allQuestions.map((q) => [q.id, q.questionKey]));
    const currentByKey = new Map(activity.questions.map((q) => [q.questionKey, q.id]));
    const responded = new Set(responses.map((r) => r.delegate.id));
    const result: ReflectionResponses = {
      activity: activityViewOf(activity, registered.length),
      rows: responses.map((r) => ({
        delegate: r.delegate,
        submittedAt: r.submittedAt.toISOString(),
        answers: Object.fromEntries(
          r.answers.map((a) => [
            currentByKey.get(keyOf.get(a.questionId) ?? '') ?? a.questionId,
            a.value,
          ]),
        ),
      })),
      notSubmitted: registered.filter((d) => !responded.has(d.id)),
    };
    await audit(prisma(), {
      action: 'reflection.responses_viewed',
      entityType: 'reflection_activity',
      entityId: activity.id,
      eventId: activity.eventId,
      actorUserId: principal.userId,
      newValue: { responses: responses.length },
      ...clientOf(res),
    });
    res.json(result);
  });

  // ---------------------------------------------------------------- delegate

  async function myRegistration(res: Response, eventId: string) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'Reflections are answered by delegates.');
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
    return delegate;
  }

  async function myReflections(delegateId: string, eventId: string): Promise<MyReflection[]> {
    const at = clock();
    const activities = await prisma().reflectionActivity.findMany({
      where: { eventId, status: { not: 'draft' } },
      include: {
        ...ACTIVITY_INCLUDE,
        responses: {
          where: { delegateId },
          select: { submittedAt: true, answers: { select: { questionId: true, value: true } } },
        },
      },
      orderBy: { eventDate: { date: 'asc' } },
    });
    return activities
      .map((a) => ({ a, state: reflectionWindowState(a, at) }))
      .filter((x) => x.state !== 'hidden')
      .map(({ a, state }) => {
        const response = a.responses[0] ?? null;
        return {
          id: a.id,
          date: isoDate(a.eventDate.date),
          title: a.title,
          status: state as MyReflection['status'],
          opensAt: iso(a.opensAt),
          closesAt: iso(a.closesAt),
          questions:
            state === 'upcoming'
              ? []
              : a.questions.map((q) => {
                  const { responseCount: _n, ...view } = questionViewOf(q);
                  return view;
                }),
          submission: response
            ? {
                submittedAt: response.submittedAt.toISOString(),
                answers: Object.fromEntries(response.answers.map((x) => [x.questionId, x.value])),
              }
            : null,
          canSubmit: state === 'open' && !response,
        };
      });
  }

  router.get('/me/events/:eventId/reflections', middleware.requireAuth, async (req, res) => {
    const delegate = await myRegistration(res, String(req.params.eventId));
    res.json({ reflections: await myReflections(delegate.id, delegate.eventId) });
  });

  router.post(
    '/me/events/:eventId/reflections/:activityId',
    middleware.requireAuth,
    validated(reflectionSubmitSchema),
    async (req, res) => {
      const delegate = await myRegistration(res, String(req.params.eventId));
      const activityId = String(req.params.activityId);
      if (!UUID.test(activityId)) throw new HttpError(404, 'not_found', 'Reflection not found.');
      const activity = await prisma().reflectionActivity.findFirst({
        where: { id: activityId, eventId: delegate.eventId },
        include: {
          ...ACTIVITY_INCLUDE,
          responses: { where: { delegateId: delegate.id }, select: { id: true } },
        },
      });
      if (!activity || activity.status === 'draft') {
        throw new HttpError(404, 'not_found', 'Reflection not found.');
      }
      const at = clock();
      if (reflectionWindowState(activity, at) !== 'open') {
        throw new HttpError(409, 'reflection_not_open', 'This reflection is not open right now.');
      }
      if (activity.responses.length) {
        throw new HttpError(
          409,
          'already_submitted',
          'You have already submitted this reflection.',
        );
      }
      const { answers } = req.body as z.infer<typeof reflectionSubmitSchema>;
      const byId = new Map(activity.questions.map((q) => [q.id, q]));
      const problems: Record<string, string> = {};
      const kept: Array<{ questionId: string; value: string }> = [];
      for (const [questionId, raw] of Object.entries(answers)) {
        const value = raw.trim();
        if (!byId.has(questionId)) {
          problems[questionId] = 'This question is not part of the reflection.';
          continue;
        }
        if (value) kept.push({ questionId, value });
      }
      for (const q of activity.questions) {
        if (q.required && !kept.some((k) => k.questionId === q.id) && !problems[q.id]) {
          problems[q.id] = 'This question needs an answer before you submit.';
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
      await prisma().$transaction(async (tx) => {
        const response = await tx.reflectionResponse.create({
          data: {
            activityId: activity.id,
            eventId: delegate.eventId,
            delegateId: delegate.id,
            submittedAt: at,
            answers: { create: kept },
          },
        });
        await audit(tx, {
          action: 'reflection.submitted',
          entityType: 'reflection_response',
          entityId: response.id,
          eventId: delegate.eventId,
          actorUserId: principalOf(res).userId,
          newValue: {
            activityId: activity.id,
            date: isoDate(activity.eventDate.date),
            delegateId: delegate.id,
            answered: kept.length,
            questions: activity.questions.length,
          },
          ...clientOf(res),
        });
      });
      res.status(201).json({ reflections: await myReflections(delegate.id, delegate.eventId) });
    },
  );

  return router;
}
