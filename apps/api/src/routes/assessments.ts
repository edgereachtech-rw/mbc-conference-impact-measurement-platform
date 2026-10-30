import {
  answerIssue,
  answerScore,
  assessmentStages,
  isBlankAnswer,
  isKnowledgeQuestion,
  markedOptions,
  multipleChoiceAnswer,
  questionCreateSchema,
  questionFieldsSchema,
  questionOrderSchema,
  questionPatchSchema,
  responseSaveSchema,
  sectionFieldsSchema,
  sectionOrderSchema,
  sectionPatchSchema,
  stageOrder,
  stageWindowState,
  type AssessmentQuestionView,
  type AssessmentSectionView,
  type AssessmentStage,
  type DelegateQuestionView,
  type KnowledgeFeedback,
  type MyAssessment,
  type QuestionOption,
  type RatingScale,
  type SectionMarking,
  type StageNonCompleter,
  type StageSummary,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { csvCell } from '../imports/service.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const QUESTION_INCLUDE = {
  _count: { select: { answers: true } },
  section: { select: { id: true, order: true, marking: true } },
} as const;

type QuestionRow = Prisma.AssessmentQuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/** Scores and the correct answer are served only as the question's section marking allows. */
export function questionViewOf(q: QuestionRow): AssessmentQuestionView {
  const marking: SectionMarking = q.section?.marking ?? 'none';
  const stored = (q.options as QuestionOption[] | null) ?? null;
  const options = stored ? markedOptions(stored, marking) : null;
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
    options,
    scale: (q.scale as RatingScale | null) ?? null,
    isKnowledge: isKnowledgeQuestion({ type: q.type, options }),
    responseCount: q._count.answers,
  };
}

/** Delegates never receive which option is correct, nor option scores. */
export function delegateViewOf(view: AssessmentQuestionView): DelegateQuestionView {
  return {
    ...view,
    options: view.options
      ? view.options.map(({ correct: _correct, score: _score, ...rest }) => rest)
      : null,
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
  marking: SectionMarking;
}): AssessmentSectionView {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    order: s.order,
    marking: s.marking,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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
  const eligibleStatuses = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  function stageOf(value: string): AssessmentStage {
    if (!(assessmentStages as readonly string[]).includes(value)) {
      throw new HttpError(404, 'not_found', 'Unknown assessment stage.');
    }
    return value as AssessmentStage;
  }

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
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

  const stageFromReq = (req: Request, forWrite: boolean) =>
    loadStage(String(req.params.eventId), stageOf(String(req.params.stage)), forWrite);

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

  const lists = async (stageConfigId: string) => ({
    sections: await activeSections(stageConfigId),
    questions: await activeQuestions(stageConfigId),
  });

  /**
   * Answers point at the exact question version answered. For reporting, every version of a
   * question (same question_key within the stage) counts as that question, so an edit after the
   * first answers does not drop them. Returns, per active question, the ids to look for, the
   * active one first.
   */
  async function versionIdsOf(stageConfigId: string, questions: readonly AssessmentQuestionView[]) {
    const rows = await prisma().assessmentQuestion.findMany({
      where: { stageConfigId },
      select: { id: true, questionKey: true },
    });
    const keyOf = new Map(rows.map((r) => [r.id, r.questionKey]));
    const byKey = new Map<string, string[]>();
    for (const r of rows) byKey.set(r.questionKey, [...(byKey.get(r.questionKey) ?? []), r.id]);
    return new Map(
      questions.map((q) => {
        const key = keyOf.get(q.id);
        const others = (key ? (byKey.get(key) ?? []) : []).filter((id) => id !== q.id);
        return [q.id, [q.id, ...others]];
      }),
    );
  }

  /** The answer to a question in one response, whichever version of it was answered. */
  function answerTo<A extends { questionId: string }>(
    byId: ReadonlyMap<string, A>,
    ids: readonly string[] | undefined,
    questionId: string,
  ): A | undefined {
    for (const id of ids ?? [questionId]) {
      const a = byId.get(id);
      if (a) return a;
    }
    return undefined;
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

  async function nextOrder(stageConfigId: string) {
    const last = await prisma().assessmentQuestion.aggregate({
      where: { stageConfigId, retiredAt: null },
      _max: { order: true },
    });
    return (last._max.order ?? 0) + 1;
  }

  // ---------------------------------------------------------------- admin: questions

  router.get('/events/:eventId/assessments/:stage/questions', guard, async (req, res) => {
    requireAdmin(res);
    const stage = await stageFromReq(req, false);
    res.json(await lists(stage.id));
  });

  router.post(
    '/events/:eventId/assessments/:stage/questions',
    guard,
    validated(questionCreateSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
      const input = req.body as z.infer<typeof questionCreateSchema>;
      const sectionId = await sectionFor(stage.id, input.sectionId);
      const order = await nextOrder(stage.id);
      const created = await prisma().$transaction(async (tx) => {
        const row = await tx.assessmentQuestion.create({
          data: {
            stageConfigId: stage.id,
            eventId: stage.eventId,
            sectionId,
            order,
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
            knowledge: isKnowledgeQuestion({
              type: row.type,
              options: (row.options as QuestionOption[] | null) ?? null,
            }),
          },
          ...clientOf(res),
        });
        return row;
      });
      res.status(201).json({ question: questionViewOf(created), ...(await lists(stage.id)) });
    },
  );

  router.patch(
    '/events/:eventId/assessments/:stage/questions/:questionId',
    guard,
    validated(questionPatchSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
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
      res.json({ question: questionViewOf(saved), ...(await lists(stage.id)) });
    },
  );

  router.delete(
    '/events/:eventId/assessments/:stage/questions/:questionId',
    guard,
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
      const current = await prisma().assessmentQuestion.findFirst({
        where: { id: String(req.params.questionId), stageConfigId: stage.id, retiredAt: null },
        include: QUESTION_INCLUDE,
      });
      if (!current) throw new HttpError(404, 'not_found', 'Question not found.');
      const keep = current._count.answers > 0;
      await prisma().$transaction(async (tx) => {
        if (keep) {
          await tx.assessmentQuestion.update({
            where: { id: current.id },
            data: { retiredAt: clock() },
          });
        } else {
          await tx.assessmentQuestion.delete({ where: { id: current.id } });
        }
        await audit(tx, {
          action: keep ? 'assessment.question_retired' : 'assessment.question_deleted',
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
      res.json(await lists(stage.id));
    },
  );

  router.put(
    '/events/:eventId/assessments/:stage/questions/order',
    guard,
    validated(questionOrderSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
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
      res.json(await lists(stage.id));
    },
  );

  // ---------------------------------------------------------------- admin: sections

  router.post(
    '/events/:eventId/assessments/:stage/sections',
    guard,
    validated(sectionFieldsSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
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
            marking: input.marking,
            order: (last._max.order ?? 0) + 1,
          },
        });
        await audit(tx, {
          action: 'assessment.section_created',
          entityType: 'assessment_section',
          entityId: row.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          newValue: { stage: stage.stage, title: row.title, marking: row.marking },
          ...clientOf(res),
        });
        return row;
      });
      res.status(201).json({ section: sectionViewOf(section), ...(await lists(stage.id)) });
    },
  );

  router.patch(
    '/events/:eventId/assessments/:stage/sections/:sectionId',
    guard,
    validated(sectionPatchSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
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
            ...(patch.marking !== undefined ? { marking: patch.marking } : {}),
          },
        });
        await audit(tx, {
          action: 'assessment.section_updated',
          entityType: 'assessment_section',
          entityId: current.id,
          eventId: stage.eventId,
          actorUserId: principal.userId,
          oldValue: { title: current.title, marking: current.marking },
          newValue: patch as Prisma.InputJsonValue,
          ...clientOf(res),
        });
      });
      res.json(await lists(stage.id));
    },
  );

  router.delete(
    '/events/:eventId/assessments/:stage/sections/:sectionId',
    guard,
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
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
      res.json(await lists(stage.id));
    },
  );

  router.put(
    '/events/:eventId/assessments/:stage/sections/order',
    guard,
    validated(sectionOrderSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const stage = await stageFromReq(req, true);
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
      res.json(await lists(stage.id));
    },
  );

  // ---------------------------------------------------------------- admin: summary and export

  router.get('/events/:eventId/assessments/:stage/summary', guard, async (req, res) => {
    requireAdmin(res);
    const stage = await stageFromReq(req, false);
    const [invited, responses, questions] = await Promise.all([
      prisma().delegate.count({
        where: { eventId: stage.eventId, registrationStatus: { in: [...eligibleStatuses()] } },
      }),
      prisma().assessmentResponse.findMany({
        where: { stageConfigId: stage.id },
        select: {
          id: true,
          submittedAt: true,
          answers: { select: { questionId: true, score: true, correct: true } },
        },
      }),
      activeQuestions(stage.id),
    ]);
    const submitted = responses.filter((r) => r.submittedAt);
    const versions = await versionIdsOf(stage.id, questions);
    const knowledgeIds = questions.filter((q) => q.isKnowledge).map((q) => q.id);
    let knowledge: StageSummary['knowledge'] = null;
    if (knowledgeIds.length) {
      const scores: number[] = [];
      for (const r of submitted) {
        const byQuestion = new Map(r.answers.map((a) => [a.questionId, a]));
        const found = knowledgeIds.map((id) => answerTo(byQuestion, versions.get(id), id));
        if (found.every(Boolean)) {
          scores.push(found.reduce((n, a) => n + (a?.correct ? 1 : 0), 0));
        }
      }
      const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      knowledge = {
        questions: knowledgeIds.length,
        respondents: scores.length,
        averageScore: average === null ? null : round1(average),
        averagePercent: average === null ? null : round1((average / knowledgeIds.length) * 100),
      };
    }
    const statements: StageSummary['statements'] = questions
      .filter(
        (q) =>
          q.type === 'single_choice' &&
          !q.isKnowledge &&
          (q.options ?? []).some((o) => o.score !== null && o.score !== undefined),
      )
      .map((q) => {
        const values = submitted
          .map((r) =>
            answerTo(new Map(r.answers.map((a) => [a.questionId, a])), versions.get(q.id), q.id),
          )
          .map((a) => a?.score)
          .filter((s): s is number => typeof s === 'number');
        return {
          questionId: q.id,
          questionKey: q.questionKey,
          prompt: q.prompt,
          responses: values.length,
          average: values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null,
        };
      });
    const summary: StageSummary = {
      stage: stage.stage,
      invited,
      started: responses.length,
      submitted: submitted.length,
      responseRate: invited ? round1((submitted.length / invited) * 100) : null,
      knowledge,
      statements,
    };
    res.json({ summary });
  });

  // Delegates the stage applies to who have not submitted it, for reminders (E5-9).
  router.get('/events/:eventId/assessments/:stage/non-completers', guard, async (req, res) => {
    requireAdmin(res);
    const stage = await stageFromReq(req, false);
    const rows = await prisma().delegate.findMany({
      where: {
        eventId: stage.eventId,
        registrationStatus: { in: [...eligibleStatuses()] },
        assessmentResponses: { none: { stageConfigId: stage.id, submittedAt: { not: null } } },
      },
      select: {
        id: true,
        name: true,
        email: true,
        organisation: true,
        userAccountId: true,
        assessmentResponses: { where: { stageConfigId: stage.id }, select: { id: true } },
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    const delegates: StageNonCompleter[] = rows.map((d) => ({
      id: d.id,
      name: d.name,
      email: d.email,
      organisation: d.organisation,
      signedUp: d.userAccountId !== null,
      started: d.assessmentResponses.length > 0,
    }));
    res.json({ delegates });
  });

  /** One answer as text for the export: option labels rather than codes, "Other" spelled out. */
  function answerText(question: AssessmentQuestionView, value: unknown): string {
    if (value === null || value === undefined) return '';
    const labelOf = (code: string) =>
      (question.options ?? []).find((o) => o.value === code)?.label ?? code;
    switch (question.type) {
      case 'single_choice':
        return typeof value === 'string' ? labelOf(value) : String(value);
      case 'multiple_choice': {
        const answer = multipleChoiceAnswer(value);
        if (!answer) return String(value);
        return answer.selected
          .map((code) => {
            const option = (question.options ?? []).find((o) => o.value === code);
            if (option?.other && answer.other) return `${option.label}: ${answer.other}`;
            return option?.label ?? code;
          })
          .join('; ');
      }
      case 'yes_no':
        return value === true ? 'Yes' : value === false ? 'No' : String(value);
      default:
        return typeof value === 'string' ? value : String(value);
    }
  }

  // Submitted responses of a stage as CSV, one row per delegate and one column per question
  // (E5-10: the summary of expectations and baseline results M.Bryan receives before the
  // conference). Knowledge questions add a "correct" column and a total. The download is
  // audited without any of its contents.
  router.get('/events/:eventId/assessments/:stage/responses.csv', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const stage = await stageFromReq(req, false);
    const [questions, responses] = await Promise.all([
      activeQuestions(stage.id),
      prisma().assessmentResponse.findMany({
        where: { stageConfigId: stage.id, submittedAt: { not: null } },
        orderBy: { submittedAt: 'asc' },
        select: {
          submittedAt: true,
          delegate: {
            select: {
              name: true,
              email: true,
              organisation: true,
              jobTitle: true,
              country: true,
              attendanceFormat: true,
              capacity: true,
            },
          },
          answers: { select: { questionId: true, value: true, correct: true } },
        },
      }),
    ]);
    const versions = await versionIdsOf(stage.id, questions);
    const knowledge = questions.filter((q) => q.isKnowledge);
    const header = [
      'Name',
      'Email',
      'Organisation',
      'Job title',
      'Country',
      'Attendance format',
      'Capacity',
      'Submitted at (UTC)',
      ...questions.map((q) => q.prompt),
      ...knowledge.map((q) => `${q.prompt} (correct?)`),
      ...(knowledge.length ? [`Knowledge score (of ${knowledge.length})`] : []),
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const r of responses) {
      const byId = new Map(r.answers.map((a) => [a.questionId, a]));
      const answerOf = (q: AssessmentQuestionView) => answerTo(byId, versions.get(q.id), q.id);
      const d = r.delegate;
      const cells = [
        d.name,
        d.email,
        d.organisation ?? '',
        d.jobTitle ?? '',
        d.country ?? '',
        d.attendanceFormat,
        d.capacity,
        r.submittedAt?.toISOString() ?? '',
        ...questions.map((q) => answerText(q, answerOf(q)?.value)),
        ...knowledge.map((q) => {
          const a = answerOf(q);
          return a ? (a.correct ? 'Yes' : 'No') : '';
        }),
        ...(knowledge.length
          ? [String(knowledge.reduce((n, q) => n + (answerOf(q)?.correct ? 1 : 0), 0))]
          : []),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
    await audit(prisma(), {
      action: 'assessment.exported',
      entityType: 'assessment_stage_config',
      entityId: stage.id,
      eventId: stage.eventId,
      actorUserId: principal.userId,
      newValue: { stage: stage.stage, rows: responses.length, questions: questions.length },
      ...clientOf(res),
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${stage.stage}-responses-${clock().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
  });

  // ---------------------------------------------------------------- delegate: answering

  async function myRegistration(res: Response, eventId: string) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'Assessments are answered by delegates.');
    }
    if (!principal.identityId) {
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    }
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

  // Shared with the admin stage card, so both sides report the same state (a scheduled stage
  // opens by itself at its opening time).
  const windowState = stageWindowState;

  function feedbackFor(
    question: AssessmentQuestionView,
    answer: { correct: boolean | null },
  ): KnowledgeFeedback | null {
    if (!question.isKnowledge || answer.correct === null) return null;
    const right = (question.options ?? []).find((o) => o.correct);
    if (!right) return null;
    return { correct: answer.correct, correctValue: right.value, correctLabel: right.label };
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
        const views = sortQuestions(s.questions).map(questionViewOf);
        const byId = new Map(views.map((q) => [q.id, q]));
        const answers: Record<string, unknown> = {};
        const feedback: Record<string, KnowledgeFeedback> = {};
        for (const a of response?.answers ?? []) {
          answers[a.questionId] = a.value;
          const question = byId.get(a.questionId);
          const fb = question ? feedbackFor(question, a) : null;
          if (fb) feedback[a.questionId] = fb;
        }
        return {
          stage: s.stage,
          status: state as 'upcoming' | 'open' | 'closed',
          opensAt: s.opensAt ? s.opensAt.toISOString() : null,
          closesAt: s.closesAt ? s.closesAt.toISOString() : null,
          sections: state === 'upcoming' ? [] : s.sections.map(sectionViewOf),
          questions: state === 'upcoming' ? [] : views.map(delegateViewOf),
          response: response
            ? {
                submittedAt: response.submittedAt ? response.submittedAt.toISOString() : null,
                updatedAt: response.updatedAt.toISOString(),
                answers,
              }
            : null,
          feedback,
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
            select: {
              id: true,
              submittedAt: true,
              answers: { select: { questionId: true, value: true, correct: true } },
            },
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
      const stored = new Map((existing?.answers ?? []).map((a) => [a.questionId, a]));
      const problems: Record<string, string> = {};
      const kept: Array<{
        questionId: string;
        value: Prisma.InputJsonValue;
        correct: boolean | null;
        score: number | null;
      }> = [];
      // Knowledge answers show their result at once, so they are kept once given (never re-tried).
      for (const [questionId, previous] of stored) {
        const question = byId.get(questionId);
        if (question?.isKnowledge && previous.correct !== null) {
          const incoming = answers[questionId];
          if (!isBlankAnswer(incoming) && incoming !== previous.value) {
            problems[questionId] = 'You have already answered this question; it cannot be changed.';
          }
          const scored = answerScore(question, previous.value);
          kept.push({ questionId, value: previous.value as Prisma.InputJsonValue, ...scored });
        }
      }
      for (const [questionId, value] of Object.entries(answers)) {
        if (kept.some((k) => k.questionId === questionId) || problems[questionId]) continue;
        const question = byId.get(questionId);
        if (!question) {
          problems[questionId] = 'This question is no longer part of the assessment.';
          continue;
        }
        if (isBlankAnswer(value)) continue;
        const issue = answerIssue(question, value);
        if (issue) problems[questionId] = issue;
        else
          kept.push({
            questionId,
            value: value as Prisma.InputJsonValue,
            ...answerScore(question, value),
          });
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
      await prisma().$transaction(async (tx) => {
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
              correct: k.correct,
              score: k.score,
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
      });
      res.json({ assessments: await myAssessments(delegate.id, delegate.eventId) });
    },
  );

  return router;
}
