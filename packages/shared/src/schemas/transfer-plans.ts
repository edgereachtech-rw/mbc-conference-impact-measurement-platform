import { z } from 'zod';

/**
 * Individual Transfer Plan (task of 2026-10-31): one continuous plan per delegate per event,
 * begun in the first Transfer Planning session, continued in any later one, submitted at the
 * designated final session and kept alive after the event for progress and changes. Several
 * planned actions, one of them the first priority; progress recorded per action; reminder
 * preferences; the original submission kept as a snapshot. Separate from attendance, session
 * feedback and the assessments. Nothing here assumes a number of days or sessions.
 */

export const transferPlanStatuses = ['draft', 'submitted', 'completed'] as const;
export const transferPlanStatusLabels: Record<TransferPlanStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  completed: 'Completed',
};
export type TransferPlanStatus = (typeof transferPlanStatuses)[number];

/**
 * What a completed plan has shown so far (2026-11-06). Completion itself proves application,
 * not impact: the delegate says whether a measurable improvement has appeared, and later checks
 * ask whether it continued. The platform never promotes a plan on its own.
 */
export const planOutcomes = [
  'pending',
  'applied',
  'impact_demonstrated',
  'sustained_impact',
] as const;
export type PlanOutcome = (typeof planOutcomes)[number];
export const planOutcomeLabels: Record<PlanOutcome, string> = {
  pending: 'Not yet completed',
  applied: 'Applied, no measurable improvement yet',
  impact_demonstrated: 'Impact demonstrated',
  sustained_impact: 'Sustained impact',
};
export const planOutcomeDescriptions: Record<PlanOutcome, string> = {
  pending: 'The plan is still open.',
  applied:
    'The actions were carried out, with evidence, but no measurable improvement in performance or results has been seen yet.',
  impact_demonstrated:
    'Evidence shows a relevant improvement in performance or results from the actions.',
  sustained_impact: 'A later check found the improvement has continued over time.',
};

/** Answers to an impact check after completion. */
export const impactCheckAnswers = ['not_yet', 'improved', 'sustained', 'faded'] as const;
export type ImpactCheckAnswer = (typeof impactCheckAnswers)[number];
export const impactCheckAnswerLabels: Record<ImpactCheckAnswer, string> = {
  not_yet: 'No measurable improvement yet',
  improved: 'Yes, there is a measurable improvement now',
  sustained: 'Yes, the improvement has continued',
  faded: 'No, the improvement has not continued',
};
/** Days after completion (and after each answer that keeps the question open) before a check falls due. */
export const IMPACT_CHECK_DAYS = 90;
/** How many checks a plan gets at most; after that the outcome stands as last reported. */
export const IMPACT_CHECK_ROUNDS = 3;
/** Which answers a check accepts, by the plan's outcome at the time. */
export const impactCheckAnswersFor = (outcome: PlanOutcome): readonly ImpactCheckAnswer[] =>
  outcome === 'applied'
    ? (['not_yet', 'improved'] as const)
    : outcome === 'impact_demonstrated'
      ? (['sustained', 'faded'] as const)
      : [];

export const actionProgressStatuses = [
  'not_started',
  'started',
  'in_progress',
  'applied',
  'applied_consistently',
  'completed',
  'changed',
  'no_longer_applicable',
] as const;
export type ActionProgressStatus = (typeof actionProgressStatuses)[number];
export const actionProgressLabels: Record<ActionProgressStatus, string> = {
  not_started: 'Not yet started',
  started: 'Started',
  in_progress: 'In progress',
  applied: 'Applied',
  applied_consistently: 'Applied consistently',
  completed: 'Completed',
  changed: 'Changed',
  no_longer_applicable: 'No longer applicable',
};
/** Statuses that count as application of learning (backlog E12-11). */
export const appliedStatuses: readonly ActionProgressStatus[] = ['applied', 'applied_consistently'];

/**
 * What each status means and an example of it, in the words of the product owner's rules
 * (2026-11-08). Shown beside the choice in every follow-up. "Started", "In progress" and
 * "Completed" do not mean the learning was applied: application is "Applied" or "Applied
 * consistently", reported in its own right.
 */
export const actionProgressDefinitions: Record<
  ActionProgressStatus,
  { definition: string; example: string }
> = {
  not_started: {
    definition: 'You have not begun the planned action.',
    example: 'You plan to meet your line manager but have not scheduled or held the meeting.',
  },
  started: {
    definition:
      'You have taken an initial step, but the action is not yet advanced enough to be in progress.',
    example: 'You have contacted your line manager to arrange a meeting.',
  },
  in_progress: {
    definition:
      'You are actively working on the action, but it has not yet reached the planned point of completion or application.',
    example: 'You are developing an application-tracking process with the relevant stakeholders.',
  },
  applied: {
    definition: 'You have used the learning or practice at least once in a real work situation.',
    example: 'You used the new tracking process for one training programme.',
  },
  applied_consistently: {
    definition: 'You have used the learning or practice repeatedly over the period you describe.',
    example: 'You have used the tracking process across several training programmes.',
  },
  completed: {
    definition: 'The planned action has been finished according to your stated goal.',
    example: 'Your planned task was to introduce a tracking process, and it has been introduced.',
  },
  changed: {
    definition:
      'The original action has been revised because your circumstances, priorities or approach changed.',
    example: 'You changed the planned initiative after an organisational review.',
  },
  no_longer_applicable: {
    definition: 'The original action is no longer relevant or possible in your circumstances.',
    example: 'You moved to a role where the planned action cannot be carried out.',
  },
};

/** What a status asks the delegate to add (backlog E12-9; rules of 2026-11-08); null when nothing. */
export const progressDetailPrompt: Record<ActionProgressStatus, string | null> = {
  not_started: null,
  started: null,
  in_progress: null,
  applied: 'Give an example, and say when that application occurred.',
  applied_consistently: 'Give an example, and say when an application occurred.',
  completed: 'Say what was completed, and when.',
  changed: 'Explain briefly what changed and why.',
  no_longer_applicable: 'Explain briefly why it no longer applies.',
};
export const progressNeedsDetail = (status: ActionProgressStatus) =>
  progressDetailPrompt[status] !== null;
/** The label of the explanation a status asks for; null when it asks for none. */
export const progressNoteLabel: Record<ActionProgressStatus, string | null> = {
  not_started: null,
  started: null,
  in_progress: null,
  applied: 'An example of applying it',
  applied_consistently: 'An example of applying it',
  completed: 'What was completed',
  changed: 'What changed, and why',
  no_longer_applicable: 'Why it no longer applies',
};
/** The label of the date a status asks for; null when it asks for none. */
export const progressDateLabel: Record<ActionProgressStatus, string | null> = {
  not_started: null,
  started: null,
  in_progress: null,
  applied: 'When did this application occur?',
  applied_consistently: 'When did an application occur?',
  completed: 'When was it completed?',
  changed: null,
  no_longer_applicable: null,
};
export const progressNeedsDate = (status: ActionProgressStatus) =>
  progressDateLabel[status] !== null;

export const reminderFrequencies = [
  'none',
  'daily',
  'every_other_day',
  'twice_weekly',
  'weekly',
  'fortnightly',
  'monthly',
] as const;
export type ReminderFrequency = (typeof reminderFrequencies)[number];
export const reminderFrequencyLabels: Record<ReminderFrequency, string> = {
  none: 'No reminders',
  daily: 'Every day',
  every_other_day: 'Every other day',
  twice_weekly: 'Twice a week, on days I choose',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
};

/** ISO weekdays, for the twice-weekly choice. */
export const weekdays = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

/** A delegate's own pre-event answer shown back beside the plan, read-only. */
export const referenceAnswerSchema = z.object({
  questionKey: z.uuid(),
  prompt: z.string(),
  answer: z.string().nullable(),
});
export type ReferenceAnswer = z.infer<typeof referenceAnswerSchema>;

const isoDay = z.iso.date();
const text = (max: number) => z.string().trim().max(max).default('');
const optionalDay = isoDay.nullable().optional();

/** The fields of a planned action, before the date rule (views derive from this shape). */
/** The action's answer to the business-measure question (spec 2026-11-08, section A). */
export const measureStatuses = ['identified', 'not_yet_known', 'not_applicable'] as const;
export type MeasureStatus = (typeof measureStatuses)[number];
export const measureStatusLabels: Record<MeasureStatus, string> = {
  identified: 'Yes, I can identify a measure',
  not_yet_known: 'Not yet known',
  not_applicable: 'Not applicable',
};

export const planActionFieldsBase = z.object({
  id: z.uuid().optional(),
  isPriority: z.boolean().default(false),
  /** A short name for the action, shown in the plan, the dashboards and the reports. */
  title: z.string().trim().max(120).default(''),
  priorityLearning: text(2_000),
  action: text(2_000),
  opportunity: text(2_000),
  firstStep: text(2_000),
  startOn: optionalDay,
  targetOn: optionalDay,
  stakeholders: text(2_000),
  support: text(2_000),
  barriers: text(2_000),
  evidence: text(2_000),
  expectedResult: text(2_000),
  measure: text(2_000),
  baseline: text(2_000),
  reviewOn: optionalDay,
  /**
   * The answer to "Can you identify a business measure for this action?", asked with the
   * action's other questions (2026-11-08) and saved with the plan; null until answered. The
   * measures themselves are added separately, and only when the answer is "yes".
   */
  measureStatus: z.enum(measureStatuses).nullable().default(null),
});
export const planActionFieldsSchema = planActionFieldsBase.superRefine((a, ctx) => {
  // When both dates are given, the target comes no earlier than the start.
  if (a.startOn && a.targetOn && a.targetOn < a.startOn) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetOn'],
      message: 'The target date cannot be earlier than the start date.',
    });
  }
});
export type PlanActionFields = z.infer<typeof planActionFieldsSchema>;

/** The fields every planned action needs before the plan can be submitted (spec 2026-11-08). */
export const actionRequiredFields = ['title', 'priorityLearning', 'action'] as const;
export type ActionRequiredField = (typeof actionRequiredFields)[number];

/**
 * What still stands between a plan and submission: for each action, the required fields left
 * blank. Drafts save with anything missing; submission waits for every action to carry a title,
 * its priority learning and the specific workplace action.
 */
export function actionSubmissionGaps(
  actions: ReadonlyArray<{ id?: string; title: string; priorityLearning: string; action: string }>,
): Array<{ index: number; id: string | null; missing: ActionRequiredField[] }> {
  return actions
    .map((a, index) => ({
      index,
      id: a.id ?? null,
      missing: actionRequiredFields.filter((f) => a[f].trim() === ''),
    }))
    .filter((g) => g.missing.length > 0);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * How and when a delegate wants to be reminded about one plan (backlog E10-1 to E10-5, built
 * 2026-11-06): a frequency, the window it runs in (start and end dates, both optional), the
 * time of day in the event's timezone, and for "twice a week" the two weekdays.
 */
export const reminderPreferenceSchema = z
  .object({
    frequency: z.enum(reminderFrequencies).default('none'),
    startOn: optionalDay,
    endOn: optionalDay,
    time: z.string().regex(HHMM, 'Use a time like 09:00.').default('09:00'),
    /** ISO weekdays, 1 = Monday to 7 = Sunday; exactly two for twice_weekly, else ignored. */
    days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  })
  .superRefine((r, ctx) => {
    if (r.frequency === 'none') return;
    if (r.frequency === 'twice_weekly' && new Set(r.days).size !== 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Choose two different days of the week.',
      });
    }
    if (r.startOn && r.endOn && r.endOn < r.startOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['endOn'],
        message: 'The end date cannot be before the start date.',
      });
    }
  });
export type ReminderPreference = z.infer<typeof reminderPreferenceSchema>;
export const NO_REMINDERS: ReminderPreference = {
  frequency: 'none',
  startOn: null,
  endOn: null,
  time: '09:00',
  days: [],
};

export const transferPlanSaveSchema = z.object({
  /** The version the client last saw; a save against an older version is refused. */
  version: z.number().int().min(1),
  /** What the delegate calls this plan; empty means "Plan n"; left out, it is unchanged. */
  title: z.string().trim().max(120).optional(),
  actions: z.array(planActionFieldsSchema).max(50),
  reminder: reminderPreferenceSchema.default(NO_REMINDERS),
});
export type TransferPlanSave = z.infer<typeof transferPlanSaveSchema>;

/** A further plan for the same event (2026-11-06): a delegate may keep several. */
export const transferPlanCreateSchema = z.object({
  title: z.string().trim().max(120).default(''),
});

export const transferPlanSubmitSchema = z.object({ version: z.number().int().min(1) });
/**
 * Marks a submitted plan completed: every written action applied, with evidence. The delegate
 * says whether a measurable improvement has been seen; "seen" needs a recorded result.
 */
export const transferPlanCompleteSchema = z.object({
  version: z.number().int().min(1),
  improvement: z.enum(['seen', 'not_yet']),
  /** What changed, or what has not changed yet, in the delegate's words. */
  note: z.string().trim().max(2000).default(''),
});
export type TransferPlanComplete = z.infer<typeof transferPlanCompleteSchema>;

/** The delegate's answer to one impact check; a claimed improvement needs evidence. */
export const impactCheckAnswerSchema = z
  .object({
    answer: z.enum(impactCheckAnswers),
    note: z.string().trim().max(2000).default(''),
    evidence: z.string().trim().max(2000).default(''),
  })
  .superRefine((a, ctx) => {
    if ((a.answer === 'improved' || a.answer === 'sustained') && !a.evidence) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Say what evidence shows the improvement.',
      });
    }
  });
export type ImpactCheckAnswerInput = z.infer<typeof impactCheckAnswerSchema>;

/**
 * Where one planned action stands, as told in a follow-up (2026-11-08): the status, the
 * explanation or example the status asks for, and the date of the application or completion
 * when it asks for one.
 */
export const followUpProgressItemSchema = z
  .object({
    actionId: z.uuid(),
    status: z.enum(actionProgressStatuses),
    note: text(2_000),
    occurredOn: optionalDay,
  })
  .superRefine((value, ctx) => {
    if (progressNeedsDetail(value.status) && value.note.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: progressDetailPrompt[value.status] ?? 'Add a short note.',
      });
    }
    if (progressNeedsDate(value.status) && !value.occurredOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['occurredOn'],
        message: progressDateLabel[value.status] ?? 'Give the date.',
      });
    }
  });
export const followUpProgressSchema = z.object({
  /** The plan the statuses belong to; the delegate's latest plan when left out. */
  planId: z.uuid().optional(),
  actions: z.array(followUpProgressItemSchema).min(1).max(50),
});
export type FollowUpProgressInput = z.infer<typeof followUpProgressSchema>;

/** The 14 plan fields of backlog Appendix A5 (Q-TP-1 to 13 per action; Q-TP-14 is the reminder). */
export const planActionFieldLabels: Record<
  Exclude<keyof PlanActionFields, 'id' | 'isPriority'>,
  { label: string; prompt: string }
> = {
  title: { label: 'Action title', prompt: 'A brief name for the planned action.' },
  priorityLearning: {
    label: 'Priority learning',
    prompt: 'The knowledge, skill, tool, practice or idea you want to apply.',
  },
  action: {
    label: 'What specifically will you do differently?',
    prompt: 'The actual workplace action you intend to take.',
  },
  opportunity: {
    label: 'Where or in which workplace opportunity will you apply this?',
    prompt: 'The department, process, project or situation.',
  },
  firstStep: {
    label: 'What is the first step you will take?',
    prompt: 'The first practical activity.',
  },
  startOn: { label: 'When do you plan to start?', prompt: 'Your intended start date.' },
  targetOn: {
    label: 'When do you expect to achieve this?',
    prompt: 'Your intended completion or target date.',
  },
  stakeholders: {
    label: 'Who needs to be involved or consulted?',
    prompt: 'The stakeholders for this action.',
  },
  support: {
    label: 'What support, resources or approval will you need?',
    prompt: 'The assistance this action depends on.',
  },
  barriers: {
    label: 'What challenges or barriers might prevent you from doing this?',
    prompt: 'The obstacles you can see.',
  },
  evidence: {
    label: 'Evidence of application',
    prompt: 'What will show that you have applied your learning?',
  },
  expectedResult: {
    label: 'What result do you expect from this action?',
    prompt: 'The workplace outcome you expect.',
  },
  measure: {
    label: 'Measure',
    prompt: 'What will you track? "Not yet known" and "Not applicable" are fine.',
  },
  baseline: {
    label: 'Baseline',
    prompt: 'What is its current starting point? "Not yet known" and "Not applicable" are fine.',
  },
  reviewOn: { label: 'Review date', prompt: 'When will you review your progress?' },
  measureStatus: {
    label: 'Can you identify a business measure for this action?',
    prompt:
      'A result or change that can show whether your action is making a difference: a number such as time saved or errors reduced, or something qualitative such as better teamwork or customer experience. “Not yet known” and “Not applicable” are answers too.',
  },
};
/** Accepted in place of a measure or baseline (backlog E9-5). */
export const measurePlaceholders = ['Not yet known', 'Not applicable'] as const;

/** The pre-event questions shown back, in order; the first is the expectation the evaluation asks about. */
export const referenceQuestionsSaveSchema = z.object({
  questionKeys: z.array(z.uuid()).max(20),
});

// ------------------------------------------------------------------ measures and evidence

/**
 * Business and workplace measures and evidence of application (backlog E14, S12), attached to
 * a planned action of the existing plan. Nothing here is mandatory: an action may be qualitative
 * or have no sensible number, a measure may be "not yet known" or "not applicable", and every
 * record can be saved incomplete and finished later. A result or an evidence record is either
 * self-reported or supported by another source; neither wording means independently verified.
 */

/**
 * The delegate's answer, per planned action, to "can you identify a business measure?" (spec
 * 2026-11-08, section 5). "identified" needs at least one measure record; the other two stand
 * on their own and are never counted as missing or as zero.
 */

export const measureKinds = ['quantitative', 'qualitative'] as const;
export type MeasureKind = (typeof measureKinds)[number];
export const measureKindLabels: Record<MeasureKind, string> = {
  quantitative: 'Quantitative: a result expressed numerically',
  qualitative: 'Qualitative: a result described through observations, feedback or examples',
};

/** Which way the measure improves. A lower error rate or a shorter turnaround time is better. */
export const improvementDirections = ['higher', 'lower', 'target', 'unspecified'] as const;
export type ImprovementDirection = (typeof improvementDirections)[number];
export const improvementDirectionLabels: Record<ImprovementDirection, string> = {
  higher: 'Higher is better',
  lower: 'Lower is better',
  target: 'Closer to the target is better',
  unspecified: 'Not stated',
};

/** Whether the starting value is known (section B). */
export const baselineStates = ['known', 'not_yet_known'] as const;
export type BaselineState = (typeof baselineStates)[number];
export const baselineStateLabels: Record<BaselineState, string> = {
  known: 'Yes, I know the current value',
  not_yet_known: 'Not yet known',
};

/** Whether a target is set (section B). */
export const targetStates = ['set', 'not_yet_known', 'not_applicable'] as const;
export type TargetState = (typeof targetStates)[number];
export const targetStateLabels: Record<TargetState, string> = {
  set: 'Yes, I have a target',
  not_yet_known: 'Not yet known',
  not_applicable: 'Not applicable',
};

/** Where an actual result came from (section D). */
export const resultSources = [
  'personal_observation',
  'workplace_records',
  'organisational_data',
  'customer_feedback',
  'manager_feedback',
  'colleague_feedback',
  'other',
] as const;
export type ResultSource = (typeof resultSources)[number];
export const resultSourceLabels: Record<ResultSource, string> = {
  personal_observation: 'Personal observation',
  workplace_records: 'Workplace records or reports',
  organisational_data: 'Organisational performance data',
  customer_feedback: 'Customer or client feedback',
  manager_feedback: 'Manager or supervisor feedback',
  colleague_feedback: 'Colleague or team feedback',
  other: 'Other',
};

export const evidenceSupports = ['self_reported', 'supported'] as const;
export type EvidenceSupport = (typeof evidenceSupports)[number];
export const evidenceSupportLabels: Record<EvidenceSupport, string> = {
  self_reported: 'Self-reported',
  supported: 'Supported by another source',
};
/**
 * Hints for the delegate (E14-4). The reports keep the two labels apart and never call either
 * "independently verified"; that caveat is theirs to state, not the form's.
 */
export const evidenceSupportHints: Record<EvidenceSupport, string> = {
  self_reported: 'You are describing what you did or what happened, in your own words.',
  supported:
    'Someone or something else confirms it, for example your manager, a colleague, a customer, a report or a system figure. Say who or what in the description.',
};

/**
 * What a piece of evidence is: the five kinds the brief names (E14-3), in its order, and nothing
 * else (decision 2026-11-08). The earlier "process", "customer feedback" and "other" entries were
 * folded in by migration 20261108211500_evidence_types_brief.
 */
export const evidenceTypes = [
  'example',
  'work_product',
  'confirmation',
  'organisational_measure',
  'case_example',
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];
export const evidenceTypeLabels: Record<EvidenceType, string> = {
  example: 'An example of what I did differently',
  work_product: 'A completed work product or process',
  confirmation: 'A manager’s or stakeholder’s confirmation',
  organisational_measure: 'A relevant organisational measure',
  case_example: 'A case example',
};

/** Shown as suggestions only; the measure itself is free text (backlog E14-1). */
export const measureExamples = [
  'Average response time',
  'Number of production errors',
  'Team feedback on collaboration',
  'Time required to prepare reports',
  'Application rate',
  'Error rate',
] as const;

/** What an action's measures amount to, for the organisers (backlog E14, S13.3). */
export const measureSummaries = [
  'none',
  'not_yet_known',
  'not_applicable',
  'identified',
  'baseline_only',
  'with_result',
] as const;
export type MeasureSummary = (typeof measureSummaries)[number];
export const measureSummaryLabels: Record<MeasureSummary, string> = {
  none: 'No measure choice yet',
  not_yet_known: 'Measure not yet known',
  not_applicable: 'Measure not applicable',
  identified: 'Measure identified, no values yet',
  baseline_only: 'Baseline recorded, no result yet',
  with_result: 'Actual result recorded',
};

/** The notice every measure and evidence form carries (backlog E14-5). */
export const confidentialityNotice =
  'Do not enter confidential, personal or restricted organisational information: no company financial data, employee or customer records, or internal documents. Describe an example in your own words instead.';

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** A value a quantitative measure accepts: a plain number; the unit lives in its own field. */
export const isNumericValue = (value: string) => NUMERIC.test(value.trim());

const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/**
 * A measure's definition (sections A and B of the spec). The name, why it matters and how it is
 * measured are required; the unit when the measure is quantitative; a baseline or target value
 * when the delegate says it is known or set. Actual results are separate records.
 */
export const measureFieldsBase = z.object({
  id: z.uuid().optional(),
  kind: z.enum(measureKinds).default('quantitative'),
  name: required(500, 'Say what you would like to measure.'),
  importance: required(2_000, 'Say why this measure is important.'),
  method: required(2_000, 'Say how you will measure it.'),
  unit: text(50),
  direction: z.enum(improvementDirections).default('unspecified'),
  baselineState: z.enum(baselineStates).default('not_yet_known'),
  baselineValue: text(2_000),
  baselineOn: optionalDay,
  targetState: z.enum(targetStates).default('not_yet_known'),
  targetValue: text(2_000),
  targetOn: optionalDay,
});
export const measureFieldsSchema = measureFieldsBase.superRefine((m, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (m.kind === 'quantitative') {
    if (!m.unit) issue('unit', 'Give the unit, for example hours, % or number of errors.');
    for (const field of ['baselineValue', 'targetValue'] as const) {
      if (m[field] !== '' && !isNumericValue(m[field])) {
        issue(
          field,
          'Enter a number such as 12 or 3.5 and put the unit in its own field, or make the measure qualitative.',
        );
      }
    }
  }
  if (m.baselineState === 'known' && !m.baselineValue) {
    issue('baselineValue', 'Give the current value, or say it is not yet known.');
  }
  if (m.targetState === 'set' && !m.targetValue) {
    issue('targetValue', 'Give the target, or say it is not yet known or not applicable.');
  }
});
export type MeasureFields = z.infer<typeof measureFieldsSchema>;

export const measuresSaveSchema = z
  .object({
    version: z.number().int().min(1),
    /** The action's answer: a measure can be identified, or is not yet known or not applicable. */
    measureStatus: z.enum(measureStatuses),
    measures: z.array(measureFieldsSchema).max(20),
  })
  .superRefine((input, ctx) => {
    if (input.measureStatus === 'identified' && input.measures.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['measures'],
        message: 'Add at least one measure, or say the measure is not yet known or not applicable.',
      });
    }
  });
export type MeasuresSave = z.infer<typeof measuresSaveSchema>;

/**
 * One actual result of a measure (sections C and D). A value, its date and how it was obtained
 * are required; the source is named, and other influencing factors are described when there
 * are any. Results are kept as dated records; a new one never overwrites an earlier one.
 */
export const measureResultFieldsBase = z.object({
  id: z.uuid().optional(),
  value: required(2_000, 'Record the actual result.'),
  resultOn: isoDay,
  method: required(2_000, 'Say how this result was obtained.'),
  meaning: text(2_000),
  isFinal: z.boolean().default(false),
  sourceType: z.enum(resultSources),
  source: text(1_000),
  hasInfluences: z.boolean().default(false),
  influences: text(2_000),
  support: z.enum(evidenceSupports).default('self_reported'),
});
export const measureResultFieldsSchema = measureResultFieldsBase.superRefine((r, ctx) => {
  if (r.sourceType === 'other' && !r.source) {
    ctx.addIssue({ code: 'custom', path: ['source'], message: 'Please specify the source.' });
  }
  if (r.hasInfluences && !r.influences) {
    ctx.addIssue({
      code: 'custom',
      path: ['influences'],
      message: 'Describe the other factors that may have contributed to or affected this result.',
    });
  }
});
export type MeasureResultFields = z.infer<typeof measureResultFieldsSchema>;

export const measureResultsSaveSchema = z.object({
  version: z.number().int().min(1),
  results: z.array(measureResultFieldsSchema).max(50),
});
export type MeasureResultsSave = z.infer<typeof measureResultsSaveSchema>;

const evidenceFieldsBase = z.object({
  id: z.uuid().optional(),
  /** The measure this evidence supports; null when it is about the action as a whole. */
  measureId: z.uuid().nullable().default(null),
  type: z.enum(evidenceTypes).default('example'),
  description: z.string().trim().min(1, 'Describe the evidence in your own words.').max(4_000),
  evidenceOn: optionalDay,
  support: z.enum(evidenceSupports).default('self_reported'),
  supportedBy: text(500),
  /** A link or a document name the delegate chooses to give; no file is stored. */
  reference: text(1_000),
});
export const evidenceFieldsSchema = evidenceFieldsBase;
export type EvidenceFields = z.infer<typeof evidenceFieldsSchema>;

export const evidenceSaveSchema = z.object({
  version: z.number().int().min(1),
  evidence: z.array(evidenceFieldsSchema).max(20),
});
export type EvidenceSave = z.infer<typeof evidenceSaveSchema>;

export const measureFieldLabels: Record<
  Exclude<keyof MeasureFields, 'id' | 'kind' | 'direction' | 'baselineState' | 'targetState'>,
  { label: string; prompt: string }
> = {
  name: {
    label: 'What would you like to measure?',
    prompt: 'The result or change you will track, for example average response time.',
  },
  importance: {
    label: 'Why is this measure important?',
    prompt: 'How the measure relates to your planned action.',
  },
  method: {
    label: 'How will you measure it?',
    prompt: 'The method you will use to obtain the result.',
  },
  unit: {
    label: 'What unit will you use?',
    prompt: 'For example hours, %, RWF, number of errors or number of customers.',
  },
  baselineValue: {
    label: 'Baseline value',
    prompt: 'The starting point to compare later results against.',
  },
  baselineOn: { label: 'Baseline date', prompt: 'When the baseline value was measured.' },
  targetValue: { label: 'Target value', prompt: 'The result you hope to achieve.' },
  targetOn: { label: 'Target date', prompt: 'When you expect to achieve it.' },
};

export const resultFieldLabels: Record<
  'value' | 'resultOn' | 'method' | 'meaning' | 'source' | 'influences',
  { label: string; prompt: string }
> = {
  value: { label: 'Actual result', prompt: 'The value or observed outcome achieved.' },
  resultOn: { label: 'Date of result', prompt: 'When the result was measured or observed.' },
  method: {
    label: 'How was this result obtained?',
    prompt: 'For example, calculated from customer-support records.',
  },
  meaning: {
    label: 'What does this result tell you?',
    prompt: 'What it means for your planned action. Optional.',
  },
  source: { label: 'Please describe the source', prompt: 'Where this information came from.' },
  influences: {
    label: 'Describe the other influencing factors',
    prompt: 'Any other factors that may have contributed to or affected this result.',
  },
};

// ------------------------------------------------------------------ views

export const progressViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(actionProgressStatuses),
  /** The follow-up wave that recorded it, and its name; null and "" for older plan-page records. */
  wave: z.number().int().nullable(),
  waveLabel: z.string(),
  /** When the application or completion occurred, when the status asked for it. */
  occurredOn: z.string().nullable(),
  note: z.string().nullable(),
  evidence: z.string().nullable(),
  results: z.string().nullable(),
  challenges: z.string().nullable(),
  newTargetOn: z.string().nullable(),
  recordedAt: z.string(),
});
export type ProgressView = z.infer<typeof progressViewSchema>;

/** One dated actual result of a measure; earlier ones stay when a newer one is recorded. */
export const measureResultViewSchema = measureResultFieldsBase
  .omit({ id: true, resultOn: true })
  .extend({
    id: z.uuid(),
    resultOn: z.string().nullable(),
    /** The measure's name, kind and unit when the result was recorded. */
    measureName: z.string(),
    measureKind: z.enum(measureKinds),
    unit: z.string(),
    recordedAt: z.string(),
    updatedAt: z.string(),
  });
export type MeasureResultView = z.infer<typeof measureResultViewSchema>;

export const measureViewSchema = measureFieldsBase
  .omit({ id: true, baselineOn: true, targetOn: true })
  .extend({
    id: z.uuid(),
    order: z.number().int(),
    baselineOn: z.string().nullable(),
    targetOn: z.string().nullable(),
    /** The latest result (by its date, then when it was recorded); "" and null when none. */
    actualValue: z.string(),
    actualOn: z.string().nullable(),
    source: z.string(),
    influences: z.string(),
    support: z.enum(evidenceSupports),
    /** Every result recorded, newest first. */
    results: z.array(measureResultViewSchema),
    updatedAt: z.string(),
  });
export type MeasureView = z.infer<typeof measureViewSchema>;

export const evidenceViewSchema = evidenceFieldsBase.omit({ id: true, evidenceOn: true }).extend({
  id: z.uuid(),
  order: z.number().int(),
  evidenceOn: z.string().nullable(),
  updatedAt: z.string(),
});
export type EvidenceView = z.infer<typeof evidenceViewSchema>;

export const planActionViewSchema = planActionFieldsBase
  .omit({ id: true, startOn: true, targetOn: true, reviewOn: true })
  .extend({
    id: z.uuid(),
    order: z.number().int(),
    startOn: z.string().nullable(),
    targetOn: z.string().nullable(),
    reviewOn: z.string().nullable(),
    progressStatus: z.enum(actionProgressStatuses),
    progress: z.array(progressViewSchema),
    /** Whether a business measure is identified, not yet known or not applicable; null until chosen. */
    measureStatus: z.enum(measureStatuses).nullable(),
    /** Business and workplace measures of this action (backlog E14-1), in the delegate's order. */
    measures: z.array(measureViewSchema),
    /** Evidence of application (backlog E14-3), in the delegate's order; `evidence` above is the planning-time text. */
    evidenceRecords: z.array(evidenceViewSchema),
  });
export type PlanActionView = z.infer<typeof planActionViewSchema>;

export const transferPlanningSessionSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  order: z.number().int(),
  isFinal: z.boolean(),
});

export const reminderViewSchema = z.object({
  frequency: z.enum(reminderFrequencies),
  startOn: z.string().nullable(),
  endOn: z.string().nullable(),
  time: z.string(),
  days: z.array(z.number().int()),
  nextReminderAt: z.string().nullable(),
});
export type ReminderView = z.infer<typeof reminderViewSchema>;

export const impactCheckViewSchema = z.object({
  id: z.uuid(),
  round: z.number().int(),
  dueOn: z.string(),
  notifiedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  answer: z.enum(impactCheckAnswers).nullable(),
  note: z.string(),
  evidence: z.string(),
});
export type ImpactCheckView = z.infer<typeof impactCheckViewSchema>;

export const transferPlanViewSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  /** The n-th plan the delegate made for this event, from 1. */
  sequence: z.number().int(),
  /** The delegate's own name for the plan; empty means "Plan n". */
  title: z.string(),
  status: z.enum(transferPlanStatuses),
  version: z.number().int(),
  submittedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  /** What the completed plan has shown so far; "pending" until completion. */
  outcome: z.enum(planOutcomes),
  outcomeNote: z.string(),
  /** The impact checks after completion, in order; empty before completion. */
  impactChecks: z.array(impactCheckViewSchema),
  updatedAt: z.string(),
  reminder: reminderViewSchema,
  actions: z.array(planActionViewSchema),
});
export type TransferPlanView = z.infer<typeof transferPlanViewSchema>;

/** The name a plan is shown under: its title, else "Plan n". */
export const planTitleOf = (p: { sequence: number; title: string }) =>
  p.title.trim() || `Plan ${p.sequence}`;

/** One of the delegate's plans in the list, without its actions. */
export const transferPlanSummarySchema = z.object({
  id: z.uuid(),
  sequence: z.number().int(),
  title: z.string(),
  status: z.enum(transferPlanStatuses),
  actions: z.number().int(),
  priorityAction: z.string().nullable(),
  submittedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  outcome: z.enum(planOutcomes),
  /** An impact check is waiting for the delegate's answer. */
  checkDue: z.boolean(),
  updatedAt: z.string(),
  reminder: reminderViewSchema,
});
export type TransferPlanSummary = z.infer<typeof transferPlanSummarySchema>;

export const myTransferPlansSchema = z.object({
  plans: z.array(transferPlanSummarySchema),
});
export type MyTransferPlans = z.infer<typeof myTransferPlansSchema>;

export const myTransferPlanSchema = z.object({
  plan: transferPlanViewSchema,
  /** The event's Transfer Planning sessions in order; empty when none is scheduled. */
  sessions: z.array(transferPlanningSessionSchema),
  /** Submission is possible once the designated final session has started (or at any time when no session is scheduled). */
  canSubmit: z.boolean(),
  /** The delegate's pre-event answers to the event's reference questions, in the admin's order. */
  references: z.array(referenceAnswerSchema),
  /** Reminder attempts, newest first. */
  reminders: z.array(
    z.object({ scheduledFor: z.string(), sentAt: z.string().nullable(), status: z.string() }),
  ),
});
export type MyTransferPlan = z.infer<typeof myTransferPlanSchema>;

export const transferPlanListItemSchema = z.object({
  delegate: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    organisation: z.string().nullable(),
    attendanceFormat: z.enum(['physical', 'virtual']),
  }),
  /** One row per plan: a delegate with three plans has three rows (2026-11-06). */
  planId: z.uuid(),
  sequence: z.number().int(),
  title: z.string(),
  status: z.enum(transferPlanStatuses),
  completedAt: z.string().nullable(),
  outcome: z.enum(planOutcomes),
  actions: z.number().int(),
  priorityAction: z.string().nullable(),
  submittedAt: z.string().nullable(),
  updatedAt: z.string(),
  /** Progress of the actions, counted by latest status. */
  progress: z.record(z.enum(actionProgressStatuses), z.number().int()),
  reminderFrequency: z.enum(reminderFrequencies),
  /** The actions by what their measures say (see summariseMeasures). */
  measures: z.record(z.enum(measureSummaries), z.number().int()),
  /** Evidence records on the plan's actions, by how they are supported. */
  evidence: z.record(z.enum(evidenceSupports), z.number().int()),
});
export type TransferPlanListItem = z.infer<typeof transferPlanListItemSchema>;

/**
 * One planned action with its measures and evidence, for the organisers' measures report
 * (backlog E14-4, E16-6). Evidence text travels only when the admin asks for it; by default
 * the report carries the classification and counts and `evidenceRecords` is null.
 */
export const measureReportRowSchema = z.object({
  delegate: transferPlanListItemSchema.shape.delegate,
  planStatus: z.enum(transferPlanStatuses),
  action: z.object({
    id: z.uuid(),
    order: z.number().int(),
    title: z.string(),
    action: z.string(),
    isPriority: z.boolean(),
    progressStatus: z.enum(actionProgressStatuses),
    measureStatus: z.enum(measureStatuses).nullable(),
  }),
  summary: z.enum(measureSummaries),
  measures: z.array(measureViewSchema),
  evidence: z.record(z.enum(evidenceSupports), z.number().int()),
  evidenceRecords: z.array(evidenceViewSchema).nullable(),
});
export type MeasureReportRow = z.infer<typeof measureReportRowSchema>;

export const transferPlanAdminDetailSchema = z.object({
  delegate: transferPlanListItemSchema.shape.delegate,
  plan: transferPlanViewSchema,
  snapshot: transferPlanViewSchema.nullable(),
  references: myTransferPlanSchema.shape.references,
  history: z.array(
    z.object({
      at: z.string(),
      by: z.string().nullable(),
      action: z.string(),
      detail: z.unknown().nullable(),
    }),
  ),
  reminders: myTransferPlanSchema.shape.reminders,
});
export type TransferPlanAdminDetail = z.infer<typeof transferPlanAdminDetailSchema>;

// ------------------------------------------------------------------ helpers

/** The next reminder after `from`, by frequency; null when reminders are off. */
// ------------------------------------------------------------------ reminder scheduling

const DAY_MS = 86_400_000;

/** The calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function dateIn(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The zone's offset from UTC, in minutes, at an instant (positive east of Greenwich). */
function offsetMinutesAt(at: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** The instant of a calendar date at a wall-clock time (HH:mm) in a timezone. */
export function instantOf(date: string, time: string, timezone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle on the right offset either side of a daylight-saving change.
  let at = wall;
  for (let i = 0; i < 2; i++) at = wall - offsetMinutesAt(new Date(at), timezone) * 60_000;
  return new Date(at);
}

const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
      DAY_MS,
  );
/** ISO weekday of a date, 1 = Monday to 7 = Sunday. */
const isoWeekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
const daysInMonth = (date: string) =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();

/** Whether a reminder falls on `day`, counting from the window's first day. */
function reminderDueOn(pref: ReminderPreference, day: string, first: string): boolean {
  const diff = daysBetween(first, day);
  switch (pref.frequency) {
    case 'daily':
      return true;
    case 'every_other_day':
      return diff % 2 === 0;
    case 'twice_weekly':
      return pref.days.includes(isoWeekday(day));
    case 'weekly':
      return diff % 7 === 0;
    case 'fortnightly':
      return diff % 14 === 0;
    case 'monthly': {
      // The same day of the month as the first reminder, or the month's last day when it is shorter.
      const wanted = Math.min(Number(first.slice(8, 10)), daysInMonth(day));
      return Number(day.slice(8, 10)) === wanted;
    }
    default:
      return false;
  }
}

/**
 * When the next reminder goes out, strictly after `from`: the first day on or after the start
 * (today when none is set) that the frequency lands on, at the chosen time of day in the event's
 * timezone, and never after the end date. Null when reminders are off or the window has closed.
 * The start date anchors the cadence, so a weekly reminder keeps its weekday across sends.
 */
export function nextReminderAfter(
  pref: ReminderPreference,
  from: Date,
  timezone: string,
): Date | null {
  if (pref.frequency === 'none') return null;
  const time = pref.time || '09:00';
  const today = dateIn(from, timezone);
  const first = pref.startOn ?? today;
  const begin = first > today ? first : today;
  // Two months covers every frequency; monthly from the 31st lands within it.
  for (let i = 0; i <= 62; i++) {
    const day = addDays(begin, i);
    if (pref.endOn && day > pref.endOn) return null;
    if (!reminderDueOn(pref, day, first)) continue;
    const at = instantOf(day, time, timezone);
    if (at > from) return at;
  }
  return null;
}

/** The last seven days of a reminder window, when the email says so and offers an extension. */
export function inFinalReminderWeek(
  pref: Pick<ReminderPreference, 'endOn'>,
  at: Date,
  timezone: string,
): boolean {
  if (!pref.endOn) return false;
  return dateIn(at, timezone) >= addDays(pref.endOn, -6);
}

// ------------------------------------------------------------------ completion

export type CompletionGap = 'applied' | 'evidence';

/** Statuses that say the action was carried out on the job. */
export const completionStatuses: readonly ActionProgressStatus[] = [
  'applied',
  'applied_consistently',
  'completed',
];

/**
 * What a plan still lacks before it can be marked completed (2026-11-06): every written action
 * must have been carried out (applied, applied consistently or completed; one that no longer
 * applies is left out) and carry at least one evidence record. A result is deliberately not
 * required: completion shows application, and whether it made a measurable difference is the
 * delegate's separate report (see planHasResult and the plan outcome).
 */
export function planCompletionGaps(
  actions: ReadonlyArray<{
    id: string;
    action: string;
    progressStatus: ActionProgressStatus;
    evidenceRecords: ReadonlyArray<{ description: string }>;
  }>,
): Array<{ actionId: string; action: string; missing: CompletionGap[] }> {
  const gaps: Array<{ actionId: string; action: string; missing: CompletionGap[] }> = [];
  for (const a of actions) {
    if (!a.action.trim() || a.progressStatus === 'no_longer_applicable') continue;
    const missing: CompletionGap[] = [];
    if (!completionStatuses.includes(a.progressStatus)) missing.push('applied');
    if (!a.evidenceRecords.some((e) => e.description.trim() !== '')) missing.push('evidence');
    if (missing.length) gaps.push({ actionId: a.id, action: a.action, missing });
  }
  return gaps;
}

/** True when some action carries a recorded result: a measure's actual value, or results on a progress record. */
export function planHasResult(
  actions: ReadonlyArray<{
    measures: ReadonlyArray<{ actualValue: string }>;
    progress: ReadonlyArray<{ results: string | null }>;
  }>,
): boolean {
  return actions.some(
    (a) =>
      a.measures.some((m) => m.actualValue.trim() !== '') ||
      a.progress.some((p) => (p.results ?? '').trim() !== ''),
  );
}

/** A calendar date some days on from another (YYYY-MM-DD). */
export const addDaysTo = addDays;

/**
 * Summarises an action's measures from the delegate's choice and the measure records. "Not yet
 * known" and "not applicable" are answers in their own right, never missing values. Among
 * identified measures one with a result outranks one with a baseline only. Never counts a planned
 * action or a self-reported result as business impact.
 */
export function summariseMeasures(
  status: MeasureStatus | null,
  measures: ReadonlyArray<{ baselineValue: string; actualValue: string }>,
): MeasureSummary {
  if (status === null) return measures.length ? 'identified' : 'none';
  if (status !== 'identified') return status;
  if (measures.some((m) => m.actualValue.trim() !== '')) return 'with_result';
  if (measures.some((m) => m.baselineValue.trim() !== '')) return 'baseline_only';
  return 'identified';
}

/**
 * How far a measure's results have come, for the organisers' follow-up (spec 2026-11-08, 4D):
 * none yet, one result, or updated results; and whether the latest is supported by another source.
 */
export const resultStates = ['no_result', 'with_result', 'updated'] as const;
export type ResultState = (typeof resultStates)[number];
export const resultStateLabels: Record<ResultState, string> = {
  no_result: 'No actual result yet',
  with_result: 'Result recorded',
  updated: 'Results updated over time',
};
export function resultStateOf(m: { results: ReadonlyArray<unknown> }): ResultState {
  return m.results.length === 0 ? 'no_result' : m.results.length === 1 ? 'with_result' : 'updated';
}

export type MeasureOutcome = 'improved' | 'declined' | 'unchanged' | 'not_comparable';
export const measureOutcomeLabels: Record<MeasureOutcome, string> = {
  improved: 'Improved',
  declined: 'Declined',
  unchanged: 'No change',
  not_comparable: 'Not comparable',
};
export interface MeasureComparison {
  outcome: MeasureOutcome;
  /** actual minus baseline, in the measure's unit; null when either is not a number. */
  change: number | null;
  /** Whether the actual result reaches the target in the stated direction; null without one. */
  targetMet: boolean | null;
  /** Why the measure is not comparable; null otherwise. */
  reason: string | null;
}

/**
 * Reads baseline, target and actual result together, in the measure's unit and direction of
 * improvement and in date order. An increase is an improvement only when the delegate said
 * higher is better; "closer to the target" compares distances. A qualitative measure, a missing
 * number, an unstated direction or a result dated before its baseline is "not comparable".
 */
export function compareMeasure(m: {
  kind: MeasureKind;
  direction: ImprovementDirection;
  baselineValue: string;
  baselineOn: string | null;
  targetValue: string;
  actualValue: string;
  actualOn: string | null;
}): MeasureComparison {
  const none = (reason: string, change: number | null = null): MeasureComparison => ({
    outcome: 'not_comparable',
    change,
    targetMet: null,
    reason,
  });
  if (m.kind !== 'quantitative') return none('Qualitative measure: read the values as written.');
  if (!isNumericValue(m.baselineValue) || !isNumericValue(m.actualValue)) {
    return none('Needs a numeric baseline and a numeric actual result.');
  }
  const baseline = Number(m.baselineValue.trim());
  const actual = Number(m.actualValue.trim());
  const change = Math.round((actual - baseline) * 1e6) / 1e6;
  if (m.baselineOn && m.actualOn && m.actualOn < m.baselineOn) {
    return none('The actual result is dated before the baseline.', change);
  }
  const target = isNumericValue(m.targetValue) ? Number(m.targetValue.trim()) : null;
  if (m.direction === 'unspecified') return none('Direction of improvement not stated.', change);
  if (m.direction === 'target') {
    if (target === null) return none('"Closer to the target" needs a numeric target.', change);
    const before = Math.abs(baseline - target);
    const after = Math.abs(actual - target);
    return {
      outcome: after < before ? 'improved' : after > before ? 'declined' : 'unchanged',
      change,
      targetMet: actual === target,
      reason: null,
    };
  }
  const better = m.direction === 'higher' ? change > 0 : change < 0;
  const worse = m.direction === 'higher' ? change < 0 : change > 0;
  return {
    outcome: better ? 'improved' : worse ? 'declined' : 'unchanged',
    change,
    targetMet:
      target === null ? null : m.direction === 'higher' ? actual >= target : actual <= target,
    reason: null,
  };
}

/** A plan has content worth submitting when at least one action says what will be done. */
export function planHasContent(actions: ReadonlyArray<{ action: string }>): boolean {
  return actions.some((a) => a.action.trim().length > 0);
}
