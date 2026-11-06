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
/** Marks a submitted plan finished; refused until every action has a result and evidence. */
export const transferPlanCompleteSchema = z.object({ version: z.number().int().min(1) });

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

export const reminderViewSchema = z.object({
  frequency: z.enum(reminderFrequencies),
  startOn: z.string().nullable(),
  endOn: z.string().nullable(),
  time: z.string(),
  days: z.array(z.number().int()),
  nextReminderAt: z.string().nullable(),
});
export type ReminderView = z.infer<typeof reminderViewSchema>;

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

export type CompletionGap = 'result' | 'evidence';

/**
 * What a plan still lacks before it can be marked completed (2026-11-06): every action with
 * text needs a result (a measure with an actual value, or a progress record with results) and
 * at least one evidence record. Empty when the plan is ready.
 */
export function planCompletionGaps(
  actions: ReadonlyArray<{
    id: string;
    action: string;
    measures: ReadonlyArray<{ status: MeasureStatus; actualValue: string }>;
    evidenceRecords: ReadonlyArray<{ description: string }>;
    progress: ReadonlyArray<{ results: string | null }>;
  }>,
): Array<{ actionId: string; action: string; missing: CompletionGap[] }> {
  const gaps: Array<{ actionId: string; action: string; missing: CompletionGap[] }> = [];
  for (const a of actions) {
    if (!a.action.trim()) continue;
    const missing: CompletionGap[] = [];
    const hasResult =
      a.measures.some((m) => m.status === 'identified' && m.actualValue.trim() !== '') ||
      a.progress.some((p) => (p.results ?? '').trim() !== '');
    if (!hasResult) missing.push('result');
    if (!a.evidenceRecords.some((e) => e.description.trim() !== '')) missing.push('evidence');
    if (missing.length) gaps.push({ actionId: a.id, action: a.action, missing });
  }
  return gaps;
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
