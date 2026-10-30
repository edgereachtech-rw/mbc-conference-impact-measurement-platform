import {
  answerIssue,
  assessmentStages,
  isBlankAnswer,
  questionCreateSchema,
  questionFieldsSchema,
  questionOrderSchema,
  questionPatchSchema,
  responseSaveSchema,
  sectionFieldsSchema,
  sectionOrderSchema,
  sectionPatchSchema,
  stageOrder,
  type AssessmentQuestionView,
  type AssessmentSectionView,
  type AssessmentStage,
  type MyAssessment,
  type QuestionOption,
  type RatingScale,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

type QuestionRow = Prisma.AssessmentQuestionGetPayload<{
  include: { _count: { select: { answers: true } } };
}>;

export function questionViewOf(q: QuestionRow): AssessmentQuestionView {
  return {
    id: q.id,
    questionKey: q.questionKey,
    version: q.version,
    order: q.order,
    sectionId: q.sectionId,
    prompt: q.prompt,
    helpText: q.helpText,
    type: q.type,
    required: q.required,
    area: q.area,
    options: (q.options as QuestionOption[] | null) ?? null,
    scale: (q.scale as RatingScale | null) ?? null,
    responseCount: q._count.answers,
  };
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

const QUESTION_INCLUDE = {
  _count: { select: { answers: true } },
  section: { select: { id: true, order: true } },
} as const;

/** Untitled group first, then sections in order; within a group by question order. */
function sortQuestions<
  T extends { order: number; createdAt: Date; section: { order: number } | null },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.section?.order ?? -1) - (b.section?.order ?? -1) ||
      a.order - b.order ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

function sectionViewOf(s: {
  id: string;
  title: string;
  description: string | null;
  order: number;
}): AssessmentSectionView {
  return { id: s.id, title: s.title, description: s.description, order: s.order };
}

/**
 * Questions per assessment stage (admin) and the delegate's answers (E1-4 and the assessment
 * groundwork). Admin routes are M.Bryan-only and audited; delegate routes resolve the delegate's
 * own registration from the session and never accept a delegate id from the client.
 */
export function assessmentRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);

  function stageOf(value: string): AssessmentStage {
    if (!(assessmentStages as readonly string[]).includes(value)) {
      throw new HttpError(404, 'not_found', 'Unknown assessment stage.');
    }
    return value as AssessmentStage;
  }

  async function loadStage(eventId: string, stage: AssessmentStage, forWrite: boolean) {
    const config = await prisma().assessmentStageConfig.findUnique({
      where: { eventId_stage: { eventId, stage } },
      include: { event: { select: { id: true, status: true, timezone: true } } },
    });
    if (!config) throw new HttpError(404, 'not_found', 'Event not found.');
    if (forWrite && config.event.status === 'archived') {
      throw new HttpError(409, 'event_archived', 'An archived event cannot be changed.');
    }
    return config;
  }

  async function activeQuestions(stageConfigId: string) {
    const rows = await prisma().assessmentQuestion.findMany({
      where: { stageConfigId, retiredAt: null },
      include: QUESTION_INCLUDE,
    });
    return sortQuestions(rows).map(questionViewOf);
  }

  async function activeSections(stageConfigId: string): Promise<AssessmentSectionView[]> {
    const rows = await prisma().assessmentSection.findMany({
      where: { stageConfigId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(sectionViewOf);
  }

  /** The section id when it belongs to the stage; null for "no section"; 422 otherwise. */
  async function sectionFor(stageConfigId: string, sectionId: string | null | undefined) {
    if (!sectionId) return null;
    const section = await prisma().assessmentSection.findFirst({
      where: { id: sectionId, stageConfigId },
      select: { id: true },
    });
    if (!section) {
      throw new HttpError(422, 'validation_failed', 'sectionId: not a section of this stage.');
    }
    return section.id;
  }

  // ---------------------------------------------------------------- admin: questions

  router.get('/events/:eventId/assessments/:stage/questions', guard, async (req, res) => {
    if (!canConfigureEvents(principalOf(res)))
      throw new HttpError(403, 'forbidden', 'Admins only.');
    const stage = await loadStage(
      String(req.params.eventId),
      stageOf(String(req.params.stage)),
      false,
    );
    res.json({
      sections: await activeSections(stage.id),
      questions: await activeQuestions(stage.id),
    });
  });

  router.post(
    '/events/:eventId/assessments/:stage/questions',
    guard,
    validated(questionCreateSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const input = req.body as z.infer<typeof questionCreateSchema>;
      const sectionId = await sectionFor(stage.id, input.sectionId);
      const last = await prisma().assessmentQuestion.aggregate({
        where: { stageConfigId: stage.id, retiredAt: null },
        _max: { order: true },
      });
      const created = await prisma().$transaction(async (tx) => {
        const row = await tx.assessmentQuestion.create({
          data: {
            stageConfigId: stage.id,
            eventId: stage.eventId,
            sectionId,
            order: (last._max.order ?? 0) + 1,
            prompt: input.prompt,
            helpText: input.helpText ?? null,
            type: input.type,
            required: input.required,
            area: input.area ?? null,
            options: input.options ? (input.options as Prisma.InputJsonValue) : undefined,
            scale:
              input.type === 'rating'
                ? ((input.scale ?? { min: 1, max: 5 }) as Prisma.InputJsonValue)
                : undefined,
          },
          include: QUESTION_INCLUDE,
        });
        await audit(tx, {
          action: 'assessment.question_created',
          entityType: 'assessment_question',
          entityId: row.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          newValue: {
            stage: stage.stage,
            prompt: row.prompt,
            type: row.type,
            version: row.version,
          },
          ...clientOf(res),
        });
        return row;
      });
      res
        .status(201)
        .json({ question: questionViewOf(created), questions: await activeQuestions(stage.id) });
    },
  );

  router.patch(
    '/events/:eventId/assessments/:stage/questions/:questionId',
    guard,
    validated(questionPatchSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const current = await prisma().assessmentQuestion.findFirst({
        where: { id: String(req.params.questionId), stageConfigId: stage.id, retiredAt: null },
        include: QUESTION_INCLUDE,
      });
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      const patch = req.body as z.infer<typeof questionPatchSchema>;
      const sectionId =
        patch.sectionId === undefined
          ? current.sectionId
          : await sectionFor(stage.id, patch.sectionId);
      const merged = questionFieldsSchema.safeParse({
        prompt: patch.prompt ?? current.prompt,
        helpText: patch.helpText === undefined ? current.helpText : patch.helpText,
        type: patch.type ?? current.type,
        required: patch.required ?? current.required,
        area: patch.area === undefined ? current.area : patch.area,
        options:
          patch.options === undefined
            ? ((current.options as QuestionOption[] | null) ?? undefined)
            : (patch.options ?? undefined),
        scale:
          patch.scale === undefined
            ? ((current.scale as RatingScale | null) ?? undefined)
            : (patch.scale ?? undefined),
      });
      if (!merged.success) {
        const issue = merged.error.issues[0];
        throw new HttpError(
          422,
          'validation_failed',
          `${issue?.path.join('.')}: ${issue?.message}`,
        );
      }
      const data = {
        prompt: merged.data.prompt,
        helpText: merged.data.helpText ?? null,
        type: merged.data.type,
        required: merged.data.required,
        area: merged.data.area ?? null,
        options: merged.data.options
          ? (merged.data.options as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        scale:
          merged.data.type === 'rating'
            ? ((merged.data.scale ?? { min: 1, max: 5 }) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      };
      const answered = current._count.answers > 0;
      const saved = await prisma().$transaction(async (tx) => {
        let row;
        if (answered) {
          // Answers exist: keep the answered wording as it was and create the next version.
          await tx.assessmentQuestion.update({
            where: { id: current.id },
            data: { retiredAt: clock() },
          });
          row = await tx.assessmentQuestion.create({
            data: {
              stageConfigId: stage.id,
              eventId: stage.eventId,
              questionKey: current.questionKey,
              version: current.version + 1,
              order: current.order,
              sectionId,
              ...data,
            },
            include: QUESTION_INCLUDE,
          });
        } else {
          row = await tx.assessmentQuestion.update({
            where: { id: current.id },
            data: { ...data, sectionId },
            include: QUESTION_INCLUDE,
          });
        }
        await audit(tx, {
          action: answered ? 'assessment.question_versioned' : 'assessment.question_updated',
          entityType: 'assessment_question',
          entityId: row.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          oldValue: { id: current.id, version: current.version, prompt: current.prompt },
          newValue: { version: row.version, prompt: row.prompt, type: row.type },
          ...clientOf(res),
        });
        return row;
      });
      res.json({ question: questionViewOf(saved), questions: await activeQuestions(stage.id) });
    },
  );

  router.delete(
    '/events/:eventId/assessments/:stage/questions/:questionId',
    guard,
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const current = await prisma().assessmentQuestion.findFirst({
        where: { id: String(req.params.questionId), stageConfigId: stage.id, retiredAt: null },
        include: QUESTION_INCLUDE,
      });
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      await prisma().$transaction(async (tx) => {
        if (current._count.answers > 0) {
          await tx.assessmentQuestion.update({
            where: { id: current.id },
            data: { retiredAt: clock() },
          });
        } else {
          await tx.assessmentQuestion.delete({ where: { id: current.id } });
        }
        await audit(tx, {
          action:
            current._count.answers > 0
              ? 'assessment.question_retired'
              : 'assessment.question_deleted',
          entityType: 'assessment_question',
          entityId: current.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          oldValue: {
            prompt: current.prompt,
            version: current.version,
            answers: current._count.answers,
          },
          ...clientOf(res),
        });
      });
      res.json({ questions: await activeQuestions(stage.id) });
    },
  );

  router.put(
    '/events/:eventId/assessments/:stage/questions/order',
    guard,
    validated(questionOrderSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const { questionIds } = req.body as z.infer<typeof questionOrderSchema>;
      const active = await prisma().assessmentQuestion.findMany({
        where: { stageConfigId: stage.id, retiredAt: null },
        select: { id: true },
      });
      const ids = new Set(active.map((q) => q.id));
      if (questionIds.length !== ids.size || !questionIds.every((id) => ids.has(id))) {
        throw new HttpError(
          422,
          'validation_failed',
          'List every question of the stage exactly once.',
        );
      }
      await prisma().$transaction(async (tx) => {
        for (const [index, id] of questionIds.entries()) {
          await tx.assessmentQuestion.update({ where: { id }, data: { order: index + 1 } });
        }
        await audit(tx, {
          action: 'assessment.questions_reordered',
          entityType: 'assessment_stage_config',
          entityId: stage.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          newValue: { questionIds },
          ...clientOf(res),
        });
      });
      res.json({ questions: await activeQuestions(stage.id) });
    },
  );

  // ---------------------------------------------------------------- admin: sections

  router.post(
    '/events/:eventId/assessments/:stage/sections',
    guard,
    validated(sectionFieldsSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const input = req.body as z.infer<typeof sectionFieldsSchema>;
      const last = await prisma().assessmentSection.aggregate({
        where: { stageConfigId: stage.id },
        _max: { order: true },
      });
      const section = await prisma().$transaction(async (tx) => {
        const row = await tx.assessmentSection.create({
          data: {
            stageConfigId: stage.id,
            eventId: stage.eventId,
            title: input.title,
            description: input.description ?? null,
            order: (last._max.order ?? 0) + 1,
          },
        });
        await audit(tx, {
          action: 'assessment.section_created',
          entityType: 'assessment_section',
          entityId: row.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          newValue: { stage: stage.stage, title: row.title },
          ...clientOf(res),
        });
        return row;
      });
      res.status(201).json({
        section: sectionViewOf(section),
        sections: await activeSections(stage.id),
        questions: await activeQuestions(stage.id),
      });
    },
  );

  router.patch(
    '/events/:eventId/assessments/:stage/sections/:sectionId',
    guard,
    validated(sectionPatchSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const current = await prisma().assessmentSection.findFirst({
        where: { id: String(req.params.sectionId), stageConfigId: stage.id },
      });
      if (!current) throw new HttpError(404, 'not_found', 'Section not found.');
      const patch = req.body as z.infer<typeof sectionPatchSchema>;
      await prisma().$transaction(async (tx) => {
        await tx.assessmentSection.update({
          where: { id: current.id },
          data: {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
          },
        });
        await audit(tx, {
          action: 'assessment.section_updated',
          entityType: 'assessment_section',
          entityId: current.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          oldValue: { title: current.title },
          newValue: patch as Prisma.InputJsonValue,
          ...clientOf(res),
        });
      });
      res.json({
        sections: await activeSections(stage.id),
        questions: await activeQuestions(stage.id),
      });
    },
  );

  router.delete(
    '/events/:eventId/assessments/:stage/sections/:sectionId',
    guard,
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const current = await prisma().assessmentSection.findFirst({
        where: { id: String(req.params.sectionId), stageConfigId: stage.id },
        include: { _count: { select: { questions: true } } },
      });
      if (!current) throw new HttpError(404, 'not_found', 'Section not found.');
      await prisma().$transaction(async (tx) => {
        // Questions keep existing; they move to the untitled group (the foreign key is SET NULL).
        await tx.assessmentSection.delete({ where: { id: current.id } });
        await audit(tx, {
          action: 'assessment.section_deleted',
          entityType: 'assessment_section',
          entityId: current.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          oldValue: { title: current.title, questions: current._count.questions },
          ...clientOf(res),
        });
      });
      res.json({
        sections: await activeSections(stage.id),
        questions: await activeQuestions(stage.id),
      });
    },
  );

  router.put(
    '/events/:eventId/assessments/:stage/sections/order',
    guard,
    validated(sectionOrderSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const stage = await loadStage(
        String(req.params.eventId),
        stageOf(String(req.params.stage)),
        true,
      );
      const { sectionIds } = req.body as z.infer<typeof sectionOrderSchema>;
      const existing = await prisma().assessmentSection.findMany({
        where: { stageConfigId: stage.id },
        select: { id: true },
      });
      const ids = new Set(existing.map((x) => x.id));
      if (sectionIds.length !== ids.size || !sectionIds.every((id) => ids.has(id))) {
        throw new HttpError(
          422,
          'validation_failed',
          'List every section of the stage exactly once.',
        );
      }
      await prisma().$transaction(async (tx) => {
        for (const [index, id] of sectionIds.entries()) {
          await tx.assessmentSection.update({ where: { id }, data: { order: index + 1 } });
        }
        await audit(tx, {
          action: 'assessment.sections_reordered',
          entityType: 'assessment_stage_config',
          entityId: stage.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          newValue: { sectionIds },
          ...clientOf(res),
        });
      });
      res.json({
        sections: await activeSections(stage.id),
        questions: await activeQuestions(stage.id),
      });
    },
  );

  // ---------------------------------------------------------------- delegate: answering

  const eligibleStatuses = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  async function myRegistration(res: Response, eventId: string) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'Assessments are answered by delegates.');
    }
    if (!principal.identityId)
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    const delegate = await prisma().delegate.findFirst({
      where: {
        eventId,
        identityId: principal.identityId,
        registrationStatus: { in: [...eligibleStatuses()] },
        event: { status: 'active' },
      },
      select: { id: true, eventId: true },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    return delegate;
  }

  function windowState(
    stage: { status: string; opensAt: Date | null; closesAt: Date | null },
    at: Date,
  ): 'upcoming' | 'open' | 'closed' | 'hidden' {
    if (stage.status === 'draft') return 'hidden';
    if (stage.status === 'closed') return 'closed';
    if (stage.status === 'scheduled') return 'upcoming';
    if (stage.opensAt && at < stage.opensAt) return 'upcoming';
    if (stage.closesAt && at > stage.closesAt) return 'closed';
    return 'open';
  }

  async function myAssessments(delegateId: string, eventId: string): Promise<MyAssessment[]> {
    const at = clock();
    const stages = await prisma().assessmentStageConfig.findMany({
      where: { eventId, enabled: true },
      include: {
        questions: { where: { retiredAt: null }, include: QUESTION_INCLUDE },
        sections: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
        responses: { where: { delegateId }, include: { answers: true } },
      },
    });
    return stages
      .map((s) => ({ s, state: windowState(s, at) }))
      .filter((x) => x.state !== 'hidden')
      .sort((a, b) => stageOrder[a.s.stage] - stageOrder[b.s.stage])
      .map(({ s, state }) => {
        const response = s.responses[0] ?? null;
        const answers: Record<string, unknown> = {};
        for (const a of response?.answers ?? []) answers[a.questionId] = a.value;
        return {
          stage: s.stage,
          status: state as 'upcoming' | 'open' | 'closed',
          opensAt: s.opensAt ? s.opensAt.toISOString() : null,
          closesAt: s.closesAt ? s.closesAt.toISOString() : null,
          sections: state === 'upcoming' ? [] : s.sections.map(sectionViewOf),
          questions: state === 'upcoming' ? [] : sortQuestions(s.questions).map(questionViewOf),
          response: response
            ? {
                submittedAt: response.submittedAt ? response.submittedAt.toISOString() : null,
                updatedAt: response.updatedAt.toISOString(),
                answers,
              }
            : null,
          canAnswer: state === 'open' && !response?.submittedAt,
        };
      });
  }

  router.get('/me/events/:eventId/assessments', middleware.requireAuth, async (req, res) => {
    const delegate = await myRegistration(res, String(req.params.eventId));
    res.json({ assessments: await myAssessments(delegate.id, delegate.eventId) });
  });

  router.put(
    '/me/events/:eventId/assessments/:stage',
    middleware.requireAuth,
    validated(responseSaveSchema),
    async (req, res) => {
      const delegate = await myRegistration(res, String(req.params.eventId));
      const stage = stageOf(String(req.params.stage));
      const { answers, submit } = req.body as z.infer<typeof responseSaveSchema>;
      const config = await prisma().assessmentStageConfig.findUnique({
        where: { eventId_stage: { eventId: delegate.eventId, stage } },
        include: {
          questions: { where: { retiredAt: null }, include: QUESTION_INCLUDE },
          responses: {
            where: { delegateId: delegate.id },
            select: { id: true, submittedAt: true },
          },
        },
      });
      if (!config || !config.enabled || windowState(config, clock()) !== 'open') {
        throw new HttpError(409, 'assessment_not_open', 'This assessment is not open right now.');
      }
      const existing = config.responses[0] ?? null;
      if (existing?.submittedAt) {
        throw new HttpError(
          409,
          'already_submitted',
          'You have already submitted this assessment.',
        );
      }
      const byId = new Map(config.questions.map((q) => [q.id, questionViewOf(q)]));
      const problems: Record<string, string> = {};
      const kept: Array<{ questionId: string; value: Prisma.InputJsonValue }> = [];
      for (const [questionId, value] of Object.entries(answers)) {
        const question = byId.get(questionId);
        if (!question) {
          problems[questionId] = 'This question is no longer part of the assessment.';
          continue;
        }
        if (isBlankAnswer(value)) continue;
        const issue = answerIssue(question, value);
        if (issue) problems[questionId] = issue;
        else kept.push({ questionId, value: value as Prisma.InputJsonValue });
      }
      if (submit) {
        for (const question of byId.values()) {
          if (
            question.required &&
            !kept.some((k) => k.questionId === question.id) &&
            !problems[question.id]
          ) {
            problems[question.id] = 'This question needs an answer before you submit.';
          }
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
      const at = clock();
      const saved = await prisma().$transaction(async (tx) => {
        const response = existing
          ? await tx.assessmentResponse.update({
              where: { id: existing.id },
              data: { submittedAt: submit ? at : null },
            })
          : await tx.assessmentResponse.create({
              data: {
                stageConfigId: config.id,
                delegateId: delegate.id,
                submittedAt: submit ? at : null,
              },
            });
        await tx.assessmentAnswer.deleteMany({ where: { responseId: response.id } });
        if (kept.length) {
          await tx.assessmentAnswer.createMany({
            data: kept.map((k) => ({
              responseId: response.id,
              questionId: k.questionId,
              value: k.value,
            })),
          });
        }
        await audit(tx, {
          action: submit ? 'assessment.submitted' : 'assessment.saved',
          entityType: 'assessment_response',
          entityId: response.id,
          eventId: delegate.eventId,
          actorUserId: principalOf(res).userId,
          newValue: { stage, delegateId: delegate.id, answered: kept.length, questions: byId.size },
          ...clientOf(res),
        });
        return response;
      });
      void saved;
      res.json({ assessments: await myAssessments(delegate.id, delegate.eventId) });
    },
  );

  return router;
}
