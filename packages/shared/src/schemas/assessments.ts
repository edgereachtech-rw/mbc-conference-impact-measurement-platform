import { z } from 'zod';

import { assessmentStages, isoDateSchema, type AssessmentStage } from './events.js';

/**
 * Assessment questions and responses (E1-4, E5/E11/E12 groundwork). Every enabled stage carries
 * questions that delegates answer. Questions are versioned data: a question edited after it has
 * been answered becomes a new version (same key, version + 1) and the old version is retired, so
 * every stored answer keeps pointing at the exact wording it answered.
 *
 * The format is the platform's; the questions are each event's own data (decided 2026-10-30):
 * single choice with optional option scores and one correct answer (a knowledge question),
 * multiple choice with exclusive and "Other, please specify" options, open text, number, date.
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
  /** Points the option carries in averages; null or absent means not scored (e.g. "Not applicable"). */
  score: z.number().int().min(0).max(100).nullable().optional(),
  /** Single choice only: the correct answer of a knowledge question (one point). */
  correct: z.boolean().optional(),
  /** Multiple choice only: cannot be ticked together with any other option. */
  exclusive: z.boolean().optional(),
  /** Multiple choice only: "Other, please specify", which opens a text box. */
  other: z.boolean().optional(),
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
    const issue = (message: string, path: string[] = ['options']) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (choiceTypes.includes(q.type)) {
      const options = q.options ?? [];
      if (options.length < 2) issue('Give at least two options');
      if (new Set(options.map((o) => o.value)).size !== options.length) {
        issue('Option values must differ');
      }
      if (q.type === 'single_choice') {
        if (options.filter((o) => o.correct).length > 1) issue('Mark only one correct answer');
        if (options.some((o) => o.exclusive || o.other)) {
          issue('Exclusive and "Other" options belong to multiple choice');
        }
      } else {
        if (options.some((o) => o.correct))
          issue('A multiple-choice question has no correct answer');
        if (options.some((o) => o.score !== undefined && o.score !== null)) {
          issue('Scores belong to single-choice questions');
        }
        if (options.filter((o) => o.other).length > 1) issue('Allow at most one "Other" option');
      }
    } else if (q.options && q.options.length) {
      issue('Only choice questions take options');
    }
    if (q.type !== 'rating' && q.scale) issue('Only rating questions take a scale', ['scale']);
  });
export type QuestionFields = z.infer<typeof questionFieldsSchema>;

/**
 * How the single-choice questions of a section are marked (decided 2026-10-30: marking belongs
 * to the section, not to each question). "scored": a rating scale, each option carries a
 * weight averaged in reports (shown to admins as "Rating scale").
 * "knowledge": each question has one correct answer worth one point, with instant feedback.
 * Questions outside a section, or in an unmarked one, are plain choices.
 */
export const sectionMarkings = ['none', 'scored', 'knowledge'] as const;
export type SectionMarking = (typeof sectionMarkings)[number];

export const sectionMarkingLabels: Record<SectionMarking, string> = {
  none: 'Not marked',
  scored: 'Rating scale (averaged in reports)',
  knowledge: 'Knowledge questions (one correct answer, 1 point each)',
};

/** Options as the section's marking allows: scores only when scored, the correct answer only when knowledge. */
export function markedOptions(
  options: readonly QuestionOption[],
  marking: SectionMarking,
): QuestionOption[] {
  return options.map(({ score, correct, ...rest }) => ({
    ...rest,
    ...(marking === 'scored' && score !== undefined ? { score } : {}),
    ...(marking === 'knowledge' && correct ? { correct } : {}),
  }));
}

/** A titled group of questions within a stage (shown as one step to delegates). */
export const sectionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give the section a title').max(200),
  description: optionalText(1_000),
  marking: z.enum(sectionMarkings).default('none'),
});
export type SectionFields = z.infer<typeof sectionFieldsSchema>;
export const sectionPatchSchema = sectionFieldsSchema.partial();
export const sectionOrderSchema = z.object({ sectionIds: z.array(z.uuid()).min(1).max(100) });

export const assessmentSectionViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
  marking: z.enum(sectionMarkings),
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
  /** A single-choice question with a correct answer: scored, with instant feedback. */
  isKnowledge: z.boolean(),
  /** Answers stored against this version; editing then creates a new version. */
  responseCount: z.number().int(),
});
export type AssessmentQuestionView = z.infer<typeof assessmentQuestionViewSchema>;

/** What delegates see: never the correct answers before they have answered. */
export const delegateQuestionViewSchema = assessmentQuestionViewSchema.extend({
  options: z.array(questionOptionSchema.omit({ correct: true, score: true })).nullable(),
});
export type DelegateQuestionView = z.infer<typeof delegateQuestionViewSchema>;

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

/** Option sets admins can start from; every event edits its own copy. */
export const optionPresets: Array<{ id: string; label: string; options: QuestionOption[] }> = [
  {
    id: 'frequency',
    label: 'Always to Never, with Not applicable',
    options: [
      { value: 'always', label: 'Always', score: 5 },
      { value: 'often', label: 'Often', score: 4 },
      { value: 'sometimes', label: 'Sometimes', score: 3 },
      { value: 'rarely', label: 'Rarely', score: 2 },
      { value: 'never', label: 'Never', score: 1 },
      { value: 'na', label: 'Not applicable to my role', score: null },
    ],
  },
  {
    id: 'confidence',
    label: 'Confidence 1 to 5, with Not applicable',
    options: [
      { value: '1', label: '1 – Not at all confident', score: 1 },
      { value: '2', label: '2 – Slightly confident', score: 2 },
      { value: '3', label: '3 – Moderately confident', score: 3 },
      { value: '4', label: '4 – Very confident', score: 4 },
      { value: '5', label: '5 – Extremely confident', score: 5 },
      { value: 'na', label: 'Not applicable to my role', score: null },
    ],
  },
  {
    id: 'quality',
    label: 'Excellent to Poor',
    options: [
      { value: 'excellent', label: 'Excellent', score: 4 },
      { value: 'good', label: 'Good', score: 3 },
      { value: 'fair', label: 'Fair', score: 2 },
      { value: 'poor', label: 'Poor', score: 1 },
    ],
  },
  {
    id: 'quality_na',
    label: 'Excellent to Poor, with Not applicable',
    options: [
      { value: 'excellent', label: 'Excellent', score: 4 },
      { value: 'good', label: 'Good', score: 3 },
      { value: 'fair', label: 'Fair', score: 2 },
      { value: 'poor', label: 'Poor', score: 1 },
      { value: 'na', label: 'Not applicable', score: null },
    ],
  },
];

export function isKnowledgeQuestion(question: {
  type: QuestionType;
  options: readonly QuestionOption[] | null;
}): boolean {
  return question.type === 'single_choice' && (question.options ?? []).some((o) => o.correct);
}

// ------------------------------------------------------------------ answers

/** A multiple-choice answer: the ticked values and the "Other" text when that option is ticked. */
export interface MultipleChoiceAnswer {
  selected: string[];
  other: string | null;
}

/** Reads a stored multiple-choice value (object, or a plain array from older drafts). */
export function multipleChoiceAnswer(value: unknown): MultipleChoiceAnswer | null {
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === 'string') ? { selected: value, other: null } : null;
  }
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { selected?: unknown }).selected)
  ) {
    const v = value as { selected: unknown[]; other?: unknown };
    if (!v.selected.every((s) => typeof s === 'string')) return null;
    return {
      selected: v.selected as string[],
      other: typeof v.other === 'string' && v.other.trim() ? v.other.trim() : null,
    };
  }
  return null;
}

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
      const options = question.options ?? [];
      const answer = multipleChoiceAnswer(value);
      if (!answer || answer.selected.length === 0) return 'Choose at least one of the options.';
      const allowed = new Set(options.map((o) => o.value));
      if (
        !answer.selected.every((v) => allowed.has(v)) ||
        new Set(answer.selected).size !== answer.selected.length
      ) {
        return 'Choose at least one of the options.';
      }
      const exclusive = options.filter((o) => o.exclusive && answer.selected.includes(o.value));
      if (exclusive.length && answer.selected.length > 1) {
        return `“${exclusive[0]!.label}” cannot be combined with other options.`;
      }
      const other = options.find((o) => o.other && answer.selected.includes(o.value));
      if (other && !answer.other) return `Please specify “${other.label}”.`;
      if (answer.other && answer.other.length > 500) return 'Keep “Other” under 500 characters.';
      return null;
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
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && Array.isArray((value as { selected?: unknown }).selected)) {
    return (value as { selected: unknown[] }).selected.length === 0;
  }
  return false;
}

/** The score of a single-choice answer: the option's points, or null when not scored or not a scored question. */
export function answerScore(
  question: Pick<AssessmentQuestionView, 'type' | 'options'>,
  value: unknown,
): { score: number | null; correct: boolean | null } {
  if (question.type !== 'single_choice' || typeof value !== 'string') {
    return { score: null, correct: null };
  }
  const options = question.options ?? [];
  const chosen = options.find((o) => o.value === value);
  if (!chosen) return { score: null, correct: null };
  if (isKnowledgeQuestion(question)) {
    const correct = Boolean(chosen.correct);
    return { score: correct ? 1 : 0, correct };
  }
  return { score: chosen.score ?? null, correct: null };
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

export const knowledgeFeedbackSchema = z.object({
  correct: z.boolean(),
  correctValue: z.string(),
  correctLabel: z.string(),
});
export type KnowledgeFeedback = z.infer<typeof knowledgeFeedbackSchema>;

export const myAssessmentSchema = z.object({
  stage: z.enum(assessmentStages),
  status: z.enum(myAssessmentStatuses),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** Sections in order; questions whose sectionId is null form an untitled first group. */
  sections: z.array(assessmentSectionViewSchema),
  /** Questions in section order then question order; present when the stage is open or closed. */
  questions: z.array(delegateQuestionViewSchema),
  response: z
    .object({
      submittedAt: z.string().nullable(),
      updatedAt: z.string(),
      answers: z.record(z.uuid(), z.unknown()),
    })
    .nullable(),
  /** Right or wrong for every knowledge question the delegate has answered, by question id. */
  feedback: z.record(z.uuid(), knowledgeFeedbackSchema),
  /** The delegate may save or submit now: open, inside the window, not yet submitted. */
  canAnswer: z.boolean(),
});
export type MyAssessment = z.infer<typeof myAssessmentSchema>;

// ------------------------------------------------------------------ admin summary

export const stageSummarySchema = z.object({
  stage: z.enum(assessmentStages),
  /** Registrations the stage applies to (active registrations of the event). */
  invited: z.number().int(),
  started: z.number().int(),
  submitted: z.number().int(),
  /** submitted ÷ invited × 100, rounded to one decimal; null when nobody was invited. */
  responseRate: z.number().nullable(),
  knowledge: z
    .object({
      questions: z.number().int(),
      /** Delegates who answered every knowledge question of the stage in a submitted response. */
      respondents: z.number().int(),
      averageScore: z.number().nullable(),
      averagePercent: z.number().nullable(),
    })
    .nullable(),
  /** Scored single-choice questions: average of option scores, "Not applicable" and blanks excluded. */
  statements: z.array(
    z.object({
      questionId: z.uuid(),
      questionKey: z.uuid(),
      prompt: z.string(),
      responses: z.number().int(),
      average: z.number().nullable(),
    }),
  ),
});
export type StageSummary = z.infer<typeof stageSummarySchema>;

/** A delegate the stage applies to who has not submitted it (E5-9: the reminder list). */
export const stageNonCompleterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
  /** Has an account on the platform (signed up through an invitation). */
  signedUp: z.boolean(),
  /** Saved a draft of this stage without submitting it. */
  started: z.boolean(),
});
export type StageNonCompleter = z.infer<typeof stageNonCompleterSchema>;

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
