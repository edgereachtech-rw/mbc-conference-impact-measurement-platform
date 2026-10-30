import { z } from 'zod';

import { assessmentStages, isoDateSchema, type AssessmentStage } from './events.js';

/**
 * Assessment questions and responses (E1-4, E5/E11/E12 groundwork). Every enabled stage carries
 * questions that delegates answer. Questions are versioned data: a question edited after it has
 * been answered becomes a new version (same key, version + 1) and the old version is retired, so
 * every stored answer keeps pointing at the exact wording it answered.
 */

export const questionTypes = [
  'short_text',
  'long_text',
  'single_choice',
  'multiple_choice',
  'rating',
  'yes_no',
  'number',
  'date',
] as const;
export type QuestionType = (typeof questionTypes)[number];

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

export const questionOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const ratingScaleSchema = z
  .object({
    min: z.number().int().min(0).max(1).default(1),
    max: z.number().int().min(3).max(10).default(5),
    minLabel: optionalText(60),
    maxLabel: optionalText(60),
  })
  .refine((s) => s.max > s.min, 'The scale must end above where it starts');
export type RatingScale = z.infer<typeof ratingScaleSchema>;

export const choiceTypes: readonly QuestionType[] = ['single_choice', 'multiple_choice'];

export const questionFieldsSchema = z
  .object({
    prompt: z.string().trim().min(1, 'Write the question').max(500),
    helpText: optionalText(500),
    type: z.enum(questionTypes),
    required: z.boolean().default(true),
    /** Measurement area the question serves, e.g. "Current confidence level". */
    area: optionalText(100),
    options: z.array(questionOptionSchema).max(20).optional(),
    scale: ratingScaleSchema.optional(),
  })
  .superRefine((q, ctx) => {
    if (choiceTypes.includes(q.type)) {
      const options = q.options ?? [];
      if (options.length < 2) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Give at least two options' });
      }
      if (new Set(options.map((o) => o.value)).size !== options.length) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option values must differ' });
      }
    } else if (q.options && q.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Only choice questions take options',
      });
    }
    if (q.type !== 'rating' && q.scale) {
      ctx.addIssue({
        code: 'custom',
        path: ['scale'],
        message: 'Only rating questions take a scale',
      });
    }
  });
export type QuestionFields = z.infer<typeof questionFieldsSchema>;

/** A titled group of questions within a stage (shown as one step to delegates). */
export const sectionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give the section a title').max(200),
  description: optionalText(1_000),
});
export type SectionFields = z.infer<typeof sectionFieldsSchema>;
export const sectionPatchSchema = sectionFieldsSchema.partial();
export const sectionOrderSchema = z.object({ sectionIds: z.array(z.uuid()).min(1).max(100) });

export const assessmentSectionViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
});
export type AssessmentSectionView = z.infer<typeof assessmentSectionViewSchema>;

/** Section the question belongs to; null means the untitled first group. */
const sectionRef = z.uuid().nullable().optional();

export const questionCreateSchema = questionFieldsSchema.and(z.object({ sectionId: sectionRef }));
export const questionPatchSchema = z.object({
  sectionId: sectionRef,
  prompt: z.string().trim().min(1).max(500).optional(),
  helpText: optionalText(500),
  type: z.enum(questionTypes).optional(),
  required: z.boolean().optional(),
  area: optionalText(100),
  options: z.array(questionOptionSchema).max(20).nullable().optional(),
  scale: ratingScaleSchema.nullable().optional(),
});
export type QuestionPatch = z.infer<typeof questionPatchSchema>;

export const questionOrderSchema = z.object({ questionIds: z.array(z.uuid()).min(1).max(200) });

export const assessmentQuestionViewSchema = z.object({
  id: z.uuid(),
  /** Stable across versions; answers point at a version (`id`). */
  questionKey: z.uuid(),
  version: z.number().int(),
  order: z.number().int(),
  sectionId: z.uuid().nullable(),
  prompt: z.string(),
  helpText: z.string().nullable(),
  type: z.enum(questionTypes),
  required: z.boolean(),
  area: z.string().nullable(),
  options: z.array(questionOptionSchema).nullable(),
  scale: ratingScaleSchema.nullable(),
  /** Answers stored against this version; editing then creates a new version. */
  responseCount: z.number().int(),
});
export type AssessmentQuestionView = z.infer<typeof assessmentQuestionViewSchema>;

export const questionTypeLabels: Record<QuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Long answer',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  rating: 'Rating scale',
  yes_no: 'Yes or no',
  number: 'Number',
  date: 'Date',
};

// ------------------------------------------------------------------ answers

/** Checks one answer against its question; null when valid, otherwise the message to show. */
export function answerIssue(
  question: Pick<AssessmentQuestionView, 'type' | 'options' | 'scale'>,
  value: unknown,
): string | null {
  switch (question.type) {
    case 'short_text':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 500
        ? null
        : 'Enter a short answer (up to 500 characters).';
    case 'long_text':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 5_000
        ? null
        : 'Enter an answer (up to 5,000 characters).';
    case 'single_choice':
      return typeof value === 'string' && (question.options ?? []).some((o) => o.value === value)
        ? null
        : 'Choose one of the options.';
    case 'multiple_choice': {
      const allowed = new Set((question.options ?? []).map((o) => o.value));
      return Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => typeof v === 'string' && allowed.has(v)) &&
        new Set(value).size === value.length
        ? null
        : 'Choose at least one of the options.';
    }
    case 'rating': {
      const scale = question.scale ?? { min: 1, max: 5 };
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= scale.min &&
        value <= scale.max
        ? null
        : `Choose a rating from ${scale.min} to ${scale.max}.`;
    }
    case 'yes_no':
      return typeof value === 'boolean' ? null : 'Answer yes or no.';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Enter a number.';
    case 'date':
      return typeof value === 'string' && isoDateSchema.safeParse(value).success
        ? null
        : 'Enter a date.';
    default:
      return 'Unsupported question type.';
  }
}

/** True when the value counts as "not answered" (so required checks and validation skip it). */
export function isBlankAnswer(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

export const responseSaveSchema = z.object({
  /** Question version id to value; blank values clear the answer. */
  answers: z.record(z.uuid(), z.unknown()),
  /** Submit (final) or keep as a draft the delegate can come back to. */
  submit: z.boolean().default(false),
});
export type ResponseSave = z.infer<typeof responseSaveSchema>;

// ------------------------------------------------------------------ delegate view

export const myAssessmentStatuses = ['upcoming', 'open', 'closed'] as const;

export const myAssessmentSchema = z.object({
  stage: z.enum(assessmentStages),
  status: z.enum(myAssessmentStatuses),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** Sections in order; questions whose sectionId is null form an untitled first group. */
  sections: z.array(assessmentSectionViewSchema),
  /** Questions in section order then question order; present when the stage is open or closed. */
  questions: z.array(assessmentQuestionViewSchema),
  response: z
    .object({
      submittedAt: z.string().nullable(),
      updatedAt: z.string(),
      answers: z.record(z.uuid(), z.unknown()),
    })
    .nullable(),
  /** The delegate may save or submit now: open, inside the window, not yet submitted. */
  canAnswer: z.boolean(),
});
export type MyAssessment = z.infer<typeof myAssessmentSchema>;

/** Questions grouped for display: the untitled group first (when it has questions), then each section. */
export function groupQuestions<Q extends { sectionId: string | null }>(
  sections: readonly AssessmentSectionView[],
  questions: readonly Q[],
): Array<{ section: AssessmentSectionView | null; questions: Q[] }> {
  const general = questions.filter((q) => !q.sectionId);
  const groups = [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      section,
      questions: questions.filter((q) => q.sectionId === section.id),
    }));
  return general.length || groups.length === 0
    ? [{ section: null, questions: general }, ...groups]
    : groups;
}

export const stageOrder: Record<AssessmentStage, number> = {
  pre_conference: 0,
  during_conference: 1,
  follow_up: 2,
};
