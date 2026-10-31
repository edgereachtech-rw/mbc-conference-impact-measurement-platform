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
});
export type TransferPlanListItem = z.infer<typeof transferPlanListItemSchema>;

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

/** A plan has content worth submitting when at least one action says what will be done. */
export function planHasContent(actions: ReadonlyArray<{ action: string }>): boolean {
  return actions.some((a) => a.action.trim().length > 0);
}
