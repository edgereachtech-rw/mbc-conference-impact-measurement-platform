import { z } from 'zod';

/**
 * Individual Transfer Plan (task of 2026-10-31): one continuous plan per delegate per event,
 * begun in the first Transfer Planning session, continued in any later one, submitted at the
 * designated final session and kept alive after the event for progress and changes. Several
 * planned actions, one of them the first priority; progress recorded per action; reminder
 * preferences; the original submission kept as a snapshot. Separate from attendance, session
 * feedback and the assessments. Nothing here assumes a number of days or sessions.
 */

export const transferPlanStatuses = ['draft', 'submitted'] as const;
export type TransferPlanStatus = (typeof transferPlanStatuses)[number];

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

/** What the delegate must add with a status (backlog E12-9, Appendix B); null when nothing. */
export const progressDetailPrompt: Record<ActionProgressStatus, string | null> = {
  not_started: null,
  started: null,
  in_progress: null,
  applied: 'Give an example and say when you applied it.',
  applied_consistently: 'Give an example and say over which period you applied it.',
  completed: 'Say what was completed and when.',
  changed: 'Explain briefly what changed and why.',
  no_longer_applicable: 'Explain briefly why it no longer applies.',
};
export const progressNeedsDetail = (status: ActionProgressStatus) =>
  progressDetailPrompt[status] !== null;

export const reminderFrequencies = ['none', 'weekly', 'fortnightly', 'monthly'] as const;
export type ReminderFrequency = (typeof reminderFrequencies)[number];
export const reminderFrequencyLabels: Record<ReminderFrequency, string> = {
  none: 'No reminders',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
};

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

export const planActionFieldsSchema = z.object({
  id: z.uuid().optional(),
  isPriority: z.boolean().default(false),
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
});
export type PlanActionFields = z.infer<typeof planActionFieldsSchema>;

export const transferPlanSaveSchema = z.object({
  /** The version the client last saw; a save against an older version is refused. */
  version: z.number().int().min(1),
  actions: z.array(planActionFieldsSchema).max(50),
  reminder: z
    .object({
      frequency: z.enum(reminderFrequencies).default('none'),
      startOn: optionalDay,
    })
    .default({ frequency: 'none', startOn: null }),
});
export type TransferPlanSave = z.infer<typeof transferPlanSaveSchema>;

export const transferPlanSubmitSchema = z.object({ version: z.number().int().min(1) });

export const actionProgressSchema = z
  .object({
    status: z.enum(actionProgressStatuses),
    note: text(2_000),
    evidence: text(2_000),
    results: text(2_000),
    challenges: text(2_000),
    newTargetOn: optionalDay,
  })
  .superRefine((value, ctx) => {
    if (progressNeedsDetail(value.status) && value.note.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: progressDetailPrompt[value.status] ?? 'Add a short note.',
      });
    }
  });
export type ActionProgressInput = z.infer<typeof actionProgressSchema>;

/** The 14 plan fields of backlog Appendix A5 (Q-TP-1 to 13 per action; Q-TP-14 is the reminder). */
export const planActionFieldLabels: Record<
  Exclude<keyof PlanActionFields, 'id' | 'isPriority'>,
  { label: string; prompt: string }
> = {
  priorityLearning: {
    label: 'Priority learning',
    prompt: 'What knowledge, skill, tool or practice from the conference will you apply?',
  },
  action: { label: 'Action', prompt: 'What specifically will you do differently?' },
  opportunity: {
    label: 'Workplace opportunity',
    prompt: 'Where or on which initiative will you apply it?',
  },
  firstStep: { label: 'First step', prompt: 'What is the first action you will take?' },
  startOn: { label: 'Start date', prompt: 'When will you begin?' },
  targetOn: { label: 'Target date', prompt: 'When do you expect to complete the action?' },
  stakeholders: {
    label: 'Stakeholders',
    prompt: 'Who needs to be involved, informed or consulted?',
  },
  support: { label: 'Support', prompt: 'What support, resources or approval do you need?' },
  barriers: { label: 'Potential barriers', prompt: 'What might prevent or delay your action?' },
  evidence: {
    label: 'Evidence of application',
    prompt: 'What will show that you have applied your learning?',
  },
  expectedResult: {
    label: 'Expected result',
    prompt: 'What improvement do you expect your action to contribute to?',
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

export const measureStatuses = ['identified', 'not_yet_known', 'not_applicable'] as const;
export type MeasureStatus = (typeof measureStatuses)[number];
export const measureStatusLabels: Record<MeasureStatus, string> = {
  identified: 'Measure identified',
  not_yet_known: 'Not yet known',
  not_applicable: 'Not applicable',
};

export const measureKinds = ['quantitative', 'qualitative'] as const;
export type MeasureKind = (typeof measureKinds)[number];
export const measureKindLabels: Record<MeasureKind, string> = {
  quantitative: 'Quantitative: a number with a unit',
  qualitative: 'Qualitative: described in words',
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

export const evidenceSupports = ['self_reported', 'supported'] as const;
export type EvidenceSupport = (typeof evidenceSupports)[number];
export const evidenceSupportLabels: Record<EvidenceSupport, string> = {
  self_reported: 'Self-reported',
  supported: 'Supported by another source',
};
export const evidenceSupportHints: Record<EvidenceSupport, string> = {
  self_reported: 'Your own account of what you did or what you believe happened.',
  supported:
    'Backed by a work product, an organisational measure, a manager’s or stakeholder’s confirmation, a case example or another source.',
};

export const evidenceTypes = [
  'example',
  'work_product',
  'confirmation',
  'organisational_measure',
  'case_example',
  'other',
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];
export const evidenceTypeLabels: Record<EvidenceType, string> = {
  example: 'Example of what I did differently',
  work_product: 'Completed work product or process',
  confirmation: 'Manager’s or stakeholder’s confirmation',
  organisational_measure: 'Relevant organisational measure',
  case_example: 'Case example',
  other: 'Other',
};

/** Shown as suggestions only; the measure itself is free text (backlog E14-1). */
export const measureExamples = [
  'Application rate',
  'Turnaround time',
  'Error rate',
  'Productivity',
  'Cost or resource use',
  'Quality',
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
  none: 'No measure recorded',
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

const measureFieldsBase = z.object({
  id: z.uuid().optional(),
  status: z.enum(measureStatuses).default('identified'),
  kind: z.enum(measureKinds).default('quantitative'),
  name: text(500),
  importance: text(2_000),
  unit: text(50),
  direction: z.enum(improvementDirections).default('unspecified'),
  baselineValue: text(200),
  baselineOn: optionalDay,
  targetValue: text(200),
  targetOn: optionalDay,
  actualValue: text(200),
  actualOn: optionalDay,
  source: text(1_000),
  influences: text(2_000),
  support: z.enum(evidenceSupports).default('self_reported'),
});
export const measureFieldsSchema = measureFieldsBase.superRefine((m, ctx) => {
  if (m.kind !== 'quantitative') return;
  for (const field of ['baselineValue', 'targetValue', 'actualValue'] as const) {
    if (m[field] !== '' && !isNumericValue(m[field])) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message:
          'Enter a number such as 12 or 3.5 and put the unit in its own field, or make the measure qualitative.',
      });
    }
  }
});
export type MeasureFields = z.infer<typeof measureFieldsSchema>;

export const measuresSaveSchema = z.object({
  version: z.number().int().min(1),
  measures: z.array(measureFieldsSchema).max(20),
});
export type MeasuresSave = z.infer<typeof measuresSaveSchema>;

const evidenceFieldsBase = z.object({
  id: z.uuid().optional(),
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
  Exclude<keyof MeasureFields, 'id' | 'status' | 'kind' | 'direction' | 'support'>,
  { label: string; prompt: string }
> = {
  name: {
    label: 'Measure',
    prompt: 'What business or workplace measure do you want to track?',
  },
  importance: { label: 'Why it matters', prompt: 'Why does this measure matter?' },
  unit: { label: 'Unit', prompt: 'For example %, days, hours, errors per 100 or naira.' },
  baselineValue: { label: 'Baseline', prompt: 'What is the starting value, if known?' },
  baselineOn: { label: 'Baseline date', prompt: 'When was the baseline value recorded?' },
  targetValue: {
    label: 'Target',
    prompt: 'What value do you want to achieve, if a target is set?',
  },
  targetOn: { label: 'Target date', prompt: 'By when do you expect to achieve the target?' },
  actualValue: { label: 'Actual result', prompt: 'What result have you achieved, when available?' },
  actualOn: { label: 'Actual result date', prompt: 'When was the actual result recorded?' },
  source: { label: 'Information source', prompt: 'Where did the information come from?' },
  influences: {
    label: 'Other influencing factors',
    prompt: 'What other factors may have influenced the result?',
  },
};

// ------------------------------------------------------------------ views

export const progressViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(actionProgressStatuses),
  note: z.string().nullable(),
  evidence: z.string().nullable(),
  results: z.string().nullable(),
  challenges: z.string().nullable(),
  newTargetOn: z.string().nullable(),
  recordedAt: z.string(),
});
export type ProgressView = z.infer<typeof progressViewSchema>;

/** An earlier actual result of a measure, kept when the delegate records a newer one. */
export const measureReadingViewSchema = z.object({
  id: z.uuid(),
  value: z.string(),
  readingOn: z.string().nullable(),
  source: z.string(),
  support: z.enum(evidenceSupports),
  recordedAt: z.string(),
});
export type MeasureReadingView = z.infer<typeof measureReadingViewSchema>;

export const measureViewSchema = measureFieldsBase
  .omit({ id: true, baselineOn: true, targetOn: true, actualOn: true })
  .extend({
    id: z.uuid(),
    order: z.number().int(),
    baselineOn: z.string().nullable(),
    targetOn: z.string().nullable(),
    actualOn: z.string().nullable(),
    /** Earlier actual results, newest first. */
    readings: z.array(measureReadingViewSchema),
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

export const planActionViewSchema = planActionFieldsSchema
  .omit({ id: true, startOn: true, targetOn: true, reviewOn: true })
  .extend({
    id: z.uuid(),
    order: z.number().int(),
    startOn: z.string().nullable(),
    targetOn: z.string().nullable(),
    reviewOn: z.string().nullable(),
    progressStatus: z.enum(actionProgressStatuses),
    progress: z.array(progressViewSchema),
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

export const transferPlanViewSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  status: z.enum(transferPlanStatuses),
  version: z.number().int(),
  submittedAt: z.string().nullable(),
  updatedAt: z.string(),
  reminder: z.object({
    frequency: z.enum(reminderFrequencies),
    startOn: z.string().nullable(),
    nextReminderAt: z.string().nullable(),
  }),
  actions: z.array(planActionViewSchema),
});
export type TransferPlanView = z.infer<typeof transferPlanViewSchema>;

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
  status: z.enum(transferPlanStatuses),
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
    action: z.string(),
    isPriority: z.boolean(),
    progressStatus: z.enum(actionProgressStatuses),
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
export function nextReminderAfter(
  frequency: ReminderFrequency,
  from: Date,
  startOn: string | null | undefined,
): Date | null {
  if (frequency === 'none') return null;
  const start = startOn ? new Date(`${startOn}T08:00:00.000Z`) : null;
  if (start && start > from) return start;
  const next = new Date(from);
  if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === 'fortnightly') next.setUTCDate(next.getUTCDate() + 14);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * Summarises an action's measures. An identified measure with a value outranks one without;
 * "not yet known" outranks "not applicable" when neither is identified. Never counts a planned
 * action or a self-reported result as business impact.
 */
export function summariseMeasures(
  measures: ReadonlyArray<{ status: MeasureStatus; baselineValue: string; actualValue: string }>,
): MeasureSummary {
  if (measures.length === 0) return 'none';
  const identified = measures.filter((m) => m.status === 'identified');
  if (identified.some((m) => m.actualValue.trim() !== '')) return 'with_result';
  if (identified.some((m) => m.baselineValue.trim() !== '')) return 'baseline_only';
  if (identified.length > 0) return 'identified';
  if (measures.some((m) => m.status === 'not_yet_known')) return 'not_yet_known';
  return 'not_applicable';
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
  status: MeasureStatus;
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
  if (m.status !== 'identified') return none('No measure identified.');
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
