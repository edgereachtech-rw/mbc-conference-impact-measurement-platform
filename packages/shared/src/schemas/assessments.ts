import { z } from 'zod';

import { actionProgressStatuses, transferPlanStatuses } from './transfer-plans.js';

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

/**
 * When a question is asked, judged on the delegate's own answer to its reference question
 * (requirement 10.5). This is what lets one stage ask the delegates who recorded an expectation
 * how far it was met, and ask everyone else to record one now, in each event's own words.
 */
export const questionVisibilities = [
  'always',
  'reference_answered',
  'reference_unanswered',
] as const;
export type QuestionVisibility = (typeof questionVisibilities)[number];
export const questionVisibilityLabels: Record<QuestionVisibility, string> = {
  always: 'Every delegate',
  reference_answered: 'Only delegates who answered the reference question',
  reference_unanswered: 'Only delegates who did not answer it',
};

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
    /** An earlier question of this event, by question key; see questionVisibilities. */
    referenceQuestionKey: z.uuid().nullable().optional(),
    /** Show the delegate their own answer to that question above this one. */
    showReferenceAnswer: z.boolean().default(false),
    visibleWhen: z.enum(questionVisibilities).default('always'),
    /** Offer "I prefer not to answer" beside the question. */
    allowDecline: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    const issue = (message: string, path: string[] = ['options']) =>
      ctx.addIssue({ code: 'custom', path, message });
    // Showing an answer, or asking only some delegates, both need to know which answer.
    if (!q.referenceQuestionKey && (q.showReferenceAnswer || q.visibleWhen !== 'always')) {
      issue('Choose the earlier question this one refers to', ['referenceQuestionKey']);
    }
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
 * The same fields as an author writes them, before Zod fills the defaults. Seeded event content
 * is typed against this so a question that refers to nothing can simply leave those fields out.
 */
export type QuestionFieldsInput = z.input<typeof questionFieldsSchema>;

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
  none: 'Text',
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

/** Who a section is shown to (backlog E11-2, E11-3): by the delegate's registered format. */
export const sectionAudiences = ['all', 'physical', 'virtual'] as const;
export type SectionAudience = (typeof sectionAudiences)[number];
export const sectionAudienceLabels: Record<SectionAudience, string> = {
  all: 'Every delegate',
  physical: 'In-person delegates only',
  virtual: 'Online delegates only',
};

/** A titled group of questions within a stage (shown as one step to delegates). */
export const sectionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give the section a title').max(200),
  description: optionalText(1_000),
  /**
   * Show the description as a highlighted introduction rather than a plain subtitle, for a
   * section that opens with something the delegate has to read before the questions make sense.
   */
  highlightDescription: z.boolean().default(false),
  marking: z.enum(sectionMarkings).default('none'),
  audience: z.enum(sectionAudiences).default('all'),
});
export type SectionFields = z.infer<typeof sectionFieldsSchema>;
export const sectionPatchSchema = sectionFieldsSchema.partial();
export const sectionOrderSchema = z.object({ sectionIds: z.array(z.uuid()).min(1).max(100) });

export const assessmentSectionViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  highlightDescription: z.boolean(),
  order: z.number().int(),
  marking: z.enum(sectionMarkings),
  audience: z.enum(sectionAudiences),
  /** The section of another stage this one repeats, for paired results; null otherwise. */
  sourceSectionId: z.uuid().nullable(),
  /** "Pre-conference assessment · Baseline knowledge assessment", for the builder. */
  sourceLabel: z.string().nullable(),
});

/** Repeat a section of another stage of the same event, questions included, locked for pairing. */
export const sectionMirrorSchema = z.object({
  sourceSectionId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
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
  referenceQuestionKey: z.uuid().nullable().optional(),
  showReferenceAnswer: z.boolean().optional(),
  visibleWhen: z.enum(questionVisibilities).optional(),
  allowDecline: z.boolean().optional(),
});
export type QuestionPatch = z.infer<typeof questionPatchSchema>;

export const questionOrderSchema = z.object({ questionIds: z.array(z.uuid()).min(1).max(200) });

// ------------------------------------------------------------------ built-in blocks

/**
 * The one block whose behaviour the platform still knows: readiness, which prefills the plan
 * status from the Transfer Plan (backlog E11-11, requirement 10.4E). An admin adds it to any
 * stage; its questions are ordinary, versioned questions with a `builtin` marker, locked in
 * wording because the prefill matches on that marker.
 *
 * The expectations block was removed on 2026-11-04. Its behaviour — show the delegate their own
 * pre-event answer, and ask a different question of delegates who have none — is now ordinary
 * question configuration (`referenceQuestionKey`, `showReferenceAnswer`, `visibleWhen`,
 * `allowDecline`), so every event writes requirement 10.5 in its own words.
 */
export const builtinBlockKinds = ['readiness'] as const;
export type BuiltinBlockKind = (typeof builtinBlockKinds)[number];
export const builtinBlockLabels: Record<BuiltinBlockKind, string> = {
  readiness: 'Readiness to apply, with the plan status filled in from the Transfer Plan',
};

export const BUILTIN = {
  readiness: 'readiness',
  planStatus: 'plan_status',
  readinessSupport: 'readiness_support',
} as const;

/** What a delegate may answer instead of writing one, where `allowDecline` is set. */
export const PREFER_NOT_TO_ANSWER = 'Prefer not to answer';

export const planStatusValues = ['yes', 'started', 'no'] as const;
export type PlanStatusValue = (typeof planStatusValues)[number];

export interface BuiltinQuestion extends QuestionFields {
  builtin: string;
}
/** A built-in question refers to nothing and is asked of everyone. */
const plainDisplay = {
  referenceQuestionKey: null,
  showReferenceAnswer: false,
  visibleWhen: 'always',
  allowDecline: false,
} satisfies Partial<QuestionFields>;
const choice = (
  builtin: string,
  prompt: string,
  options: Array<[string, string]>,
  helpText: string | null = null,
): BuiltinQuestion => ({
  builtin,
  prompt,
  helpText,
  type: 'single_choice',
  required: true,
  area: null,
  options: options.map(([value, label]) => ({ value, label })),
  ...plainDisplay,
});
const textQuestion = (
  builtin: string,
  prompt: string,
  helpText: string | null = null,
  required = false,
): BuiltinQuestion => ({
  builtin,
  prompt,
  helpText,
  type: 'long_text',
  required,
  area: null,
  ...plainDisplay,
});

export const builtinBlocks: Record<
  BuiltinBlockKind,
  { title: string; description: string; questions: BuiltinQuestion[] }
> = {
  readiness: {
    title: 'Readiness to apply',
    description: 'How ready you are to begin applying your priority learning.',
    questions: [
      choice(BUILTIN.readiness, 'How ready are you to begin applying your priority learning?', [
        ['ready_now', 'Ready to begin now'],
        ['ready_with_support', 'Ready, but support is needed'],
        ['not_yet_ready', 'Not yet ready'],
        ['not_applicable', 'Not applicable'],
      ]),
      choice(
        BUILTIN.planStatus,
        'Have you completed your Individual Transfer Plan?',
        [
          ['yes', 'Yes'],
          ['started', 'Started but not completed'],
          ['no', 'No'],
        ],
        'Filled in from your plan; change it if it is not right.',
      ),
      textQuestion(BUILTIN.readinessSupport, 'What support would help you begin?'),
    ],
  },
};
export const builtinBlockSchema = z.object({ kind: z.enum(builtinBlockKinds) });

/**
 * Whether a delegate is asked this question, given whether they answered its reference question
 * (requirement 10.5). A question nobody can see is never required and never answered, so the two
 * branches of an expectations pair can both be required without either blocking a submission.
 */
export function questionIsVisible(
  question: { referenceQuestionKey?: string | null; visibleWhen?: QuestionVisibility },
  referenceAnswered: boolean,
): boolean {
  const when = question.visibleWhen ?? 'always';
  if (when === 'always' || !question.referenceQuestionKey) return true;
  return when === 'reference_answered' ? referenceAnswered : !referenceAnswered;
}

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
  /** The question of another stage this one repeats (its key); wording and options are locked. */
  sourceQuestionKey: z.uuid().nullable(),
  /** A built-in block question; wording and options are locked. See builtinBlocks. */
  builtin: z.string().nullable(),
  /** An earlier question of this event whose answer this one shows or depends on (10.5). */
  referenceQuestionKey: z.uuid().nullable(),
  showReferenceAnswer: z.boolean(),
  visibleWhen: z.enum(questionVisibilities),
  allowDecline: z.boolean(),
  /** The earlier question's wording, for the builder; null when nothing is referenced. */
  referencePrompt: z.string().nullable().optional(),
});
export type AssessmentQuestionView = z.infer<typeof assessmentQuestionViewSchema>;

/** Mirrored and built-in questions keep their wording, type and options. */
export const isLockedQuestion = (q: { sourceQuestionKey: string | null; builtin: string | null }) =>
  Boolean(q.sourceQuestionKey || q.builtin);

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

/**
 * A delegate's mark on a marked section (2026-11-07): points scored over the points available
 * (one per knowledge question, the highest option score per scored question), as a percentage.
 */
export const sectionMarkSchema = z.object({
  scored: z.number(),
  max: z.number(),
  percent: z.number().int().min(0).max(100),
});
export type SectionMark = z.infer<typeof sectionMarkSchema>;

/**
 * The mark of one section from the delegate's stored answers: knowledge questions count one
 * point for a right answer; scored questions count their option's score against the highest
 * score on offer. Null when the section is unmarked or has nothing to score.
 */
export function sectionMarkOf(
  marking: SectionMarking,
  questions: ReadonlyArray<Pick<AssessmentQuestionView, 'id' | 'type' | 'options' | 'isKnowledge'>>,
  scoreOf: (questionId: string) => number | null | undefined,
): SectionMark | null {
  if (marking === 'none') return null;
  let scored = 0;
  let max = 0;
  for (const q of questions) {
    if (q.type !== 'single_choice') continue;
    const top =
      marking === 'knowledge'
        ? q.isKnowledge
          ? 1
          : 0
        : Math.max(0, ...(q.options ?? []).map((o) => o.score ?? 0));
    if (top <= 0) continue;
    max += top;
    scored += scoreOf(q.id) ?? 0;
  }
  if (max <= 0) return null;
  return { scored, max, percent: Math.round((scored / max) * 100) };
}

/** Key of the untitled first group (questions outside any section) in section submissions. */
export const GENERAL_SECTION = 'general';
/** The submission key of a question's section: its id, or the general group. */
export function sectionKeyOf(sectionId: string | null | undefined): string {
  return sectionId ?? GENERAL_SECTION;
}

export const responseSaveSchema = z.object({
  /** Question version id to value; blank values clear the answer. */
  answers: z.record(z.uuid(), z.unknown()),
  /** Submit every section at once (final) or keep a draft the delegate can come back to. */
  submit: z.boolean().default(false),
  /**
   * Submit one section (its id, or "general" for the questions outside any section): its
   * required questions must be answered and its answers lock. The stage counts as submitted
   * once every section with questions is.
   */
  submitSection: z.string().trim().min(1).max(40).optional(),
});
export type ResponseSave = z.infer<typeof responseSaveSchema>;

/**
 * One answer as text, for summaries, the admin view and the export: option labels rather than
 * codes, "Other" spelled out, Yes/No for yes_no, blank when unanswered.
 */
export function describeAnswer(
  question: { type: QuestionType; options: readonly QuestionOption[] | null },
  value: unknown,
): string {
  if (value === null || value === undefined || value === '') return '';
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

// ------------------------------------------------------------------ delegate view

export const myAssessmentStatuses = ['upcoming', 'open', 'closed'] as const;

export const knowledgeFeedbackSchema = z.object({
  correct: z.boolean(),
  correctValue: z.string(),
  correctLabel: z.string(),
});
export type KnowledgeFeedback = z.infer<typeof knowledgeFeedbackSchema>;

/**
 * The delegate's own plan, shown back inside a follow-up wave (E12-2, E12-3): they never re-enter
 * it. Read-only and compact — the actions and where each one stands, not the whole plan form.
 */
/** One status a follow-up wave recorded on a planned action (2026-11-08). */
export const followUpProgressViewSchema = z.object({
  wave: z.number().int(),
  waveLabel: z.string(),
  status: z.enum(actionProgressStatuses),
  note: z.string(),
  occurredOn: z.string().nullable(),
  recordedAt: z.string(),
});
export type FollowUpProgressView = z.infer<typeof followUpProgressViewSchema>;

export const assessmentPlanSummarySchema = z.object({
  id: z.uuid(),
  status: z.enum(transferPlanStatuses),
  actions: z.array(
    z.object({
      id: z.uuid(),
      order: z.number().int(),
      title: z.string(),
      action: z.string(),
      isPriority: z.boolean(),
      progressStatus: z.enum(actionProgressStatuses),
      targetDate: z.string().nullable(),
      /** What each follow-up wave recorded for this action so far, oldest first. */
      followUps: z.array(followUpProgressViewSchema),
    }),
  ),
});
export type AssessmentPlanSummary = z.infer<typeof assessmentPlanSummarySchema>;

export const myAssessmentSchema = z.object({
  stage: z.enum(assessmentStages),
  /** Which round of the stage: always 1 except for the follow-up waves (E12-1). */
  wave: z.number().int(),
  /** What this wave is called where a stage has several ("30-day follow-up"); else empty. */
  waveLabel: z.string(),
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
      /** Section keys already submitted (locked); see sectionKeyOf. */
      submittedSections: z.array(z.string()),
      /**
       * The delegate's mark on each submitted section that is marked (scored or knowledge), by
       * section key (2026-11-07): shown on submission, as a percentage. Unmarked sections, and
       * marked ones with nothing to score, have no entry.
       */
      sectionMarks: z.record(z.string(), sectionMarkSchema),
    })
    .nullable(),
  /** Right or wrong for every knowledge question the delegate has answered, by question id. */
  feedback: z.record(z.uuid(), knowledgeFeedbackSchema),
  /** The delegate may save or submit now: open, inside the window, not yet submitted. */
  canAnswer: z.boolean(),
  /** What the built-in blocks show back: the pre-event reference answers and the plan status. */
  context: z.object({
    /** The event's reference answers in order, shown beside the Transfer Plan. */
    references: z.array(
      z.object({ questionKey: z.uuid(), prompt: z.string(), answer: z.string().nullable() }),
    ),
    /**
     * The delegate's own earlier answers that this stage's questions show back, keyed by the
     * question key each one refers to (requirement 10.5).
     */
    referenceAnswers: z.record(
      z.string(),
      z.object({ prompt: z.string(), answer: z.string().nullable() }),
    ),
    planStatus: z.enum(planStatusValues).nullable(),
    /** The plan itself, for a follow-up wave; null for the other stages (E12-2). */
    plan: assessmentPlanSummarySchema.nullable(),
  }),
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
  /** Every single-choice question of submitted responses: how often each option was chosen. */
  distributions: z.array(
    z.object({
      questionId: z.uuid(),
      questionKey: z.uuid(),
      prompt: z.string(),
      sectionTitle: z.string().nullable(),
      builtin: z.string().nullable(),
      /** Which delegates were asked: a branch question's share is of its cohort (10.5). */
      visibleWhen: z.enum(questionVisibilities).default('always'),
      responses: z.number().int(),
      options: z.array(
        z.object({
          value: z.string(),
          label: z.string(),
          count: z.number().int(),
          /** Share of the answers given, rounded to one decimal; null without answers. */
          percent: z.number().nullable(),
        }),
      ),
    }),
  ),
});

/**
 * Paired results of a mirrored section (backlog E11-5, E11-7): only delegates who submitted
 * both stages and answered the question both times count, so the change is the same people's
 * change. Knowledge: delegates who answered every question both times, averages in percent,
 * change in percentage points. Statements: per statement, "Not applicable" and blanks
 * excluded; labelled self-reported in the screens.
 */
export const pairedResultsSchema = z.object({
  stage: z.enum(assessmentStages),
  sections: z.array(
    z.object({
      sectionId: z.uuid(),
      title: z.string(),
      sourceStage: z.enum(assessmentStages),
      sourceTitle: z.string(),
      marking: z.enum(sectionMarkings),
      knowledge: z
        .object({
          questions: z.number().int(),
          paired: z.number().int(),
          averageBeforePercent: z.number().nullable(),
          averageAfterPercent: z.number().nullable(),
          changePoints: z.number().nullable(),
        })
        .nullable(),
      statements: z.array(
        z.object({
          questionId: z.uuid(),
          prompt: z.string(),
          paired: z.number().int(),
          averageBefore: z.number().nullable(),
          averageAfter: z.number().nullable(),
          change: z.number().nullable(),
        }),
      ),
    }),
  ),
});
export type PairedResults = z.infer<typeof pairedResultsSchema>;
export type StageSummary = z.infer<typeof stageSummarySchema>;

/** One delegate's response to a stage as the admin list shows it. */
export const stageResponseListItemSchema = z.object({
  delegateId: z.uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
  submittedAt: z.string().nullable(),
  updatedAt: z.string(),
  /** Sections (with questions) submitted so far, out of the stage's total. */
  sectionsSubmitted: z.number().int(),
  sectionsTotal: z.number().int(),
  answered: z.number().int(),
});
export type StageResponseListItem = z.infer<typeof stageResponseListItemSchema>;

/** One delegate's full response: every section with its title, every question with its answer. */
export const stageResponseDetailSchema = z.object({
  delegate: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    organisation: z.string().nullable(),
  }),
  submittedAt: z.string().nullable(),
  updatedAt: z.string(),
  sections: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      marking: z.enum(sectionMarkings),
      submittedAt: z.string().nullable(),
      questions: z.array(
        z.object({
          id: z.uuid(),
          prompt: z.string(),
          type: z.enum(questionTypes),
          required: z.boolean(),
          isKnowledge: z.boolean(),
          /** The answer as text; blank when unanswered. */
          answer: z.string(),
          correct: z.boolean().nullable(),
          score: z.number().nullable(),
        }),
      ),
    }),
  ),
});
export type StageResponseDetail = z.infer<typeof stageResponseDetailSchema>;

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
  end_of_conference: 2,
  follow_up: 3,
};
