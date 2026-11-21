import { z } from 'zod';

import {
  checklistTemplateSchema,
  transferPlanModes,
  transferPlanPositions,
} from './transfer-plans.js';

/**
 * Event creation and configuration (backlog E1, brief of 2026-10-30): a structured event profile,
 * dates picked one by one (consecutive or not), optional sessions that must sit on a selected
 * date, and three assessment stages that are enabled and scheduled independently per event.
 * Nothing here assumes ITTEC's shape; ITTEC 2026 is one configured event.
 */

export const eventTypes = [
  'conference',
  'workshop',
  'seminar',
  'summit',
  'training',
  'webinar',
  'other',
] as const;
export type EventType = (typeof eventTypes)[number];

/**
 * The word the platform uses for an event of each type (decision 2026-11-19): a training's
 * delegates are asked a "pre-training assessment", not a pre-conference one. "Event" stands in
 * for a type with no better word.
 */
export const eventTypeNouns: Record<EventType, string> = {
  conference: 'conference',
  workshop: 'workshop',
  seminar: 'seminar',
  summit: 'summit',
  training: 'training',
  webinar: 'webinar',
  other: 'event',
};
export const eventNounOf = (eventType: EventType | null | undefined): string =>
  eventTypeNouns[eventType ?? 'conference'] ?? 'event';

export const eventFormats = ['physical', 'virtual', 'hybrid'] as const;
export type EventFormat = (typeof eventFormats)[number];

export const eventStatuses = ['draft', 'active', 'archived'] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const sessionTypes = [
  'keynote',
  'plenary',
  'panel',
  'workshop',
  'breakout',
  'transfer_planning',
  'networking',
  'other',
] as const;
export type SessionType = (typeof sessionTypes)[number];

export const assessmentStages = [
  'pre_conference',
  'during_conference',
  'end_of_conference',
  'follow_up',
] as const;
export type AssessmentStage = (typeof assessmentStages)[number];

export const assessmentStageStatuses = ['draft', 'scheduled', 'open', 'closed'] as const;
export type AssessmentStageStatus = (typeof assessmentStageStatuses)[number];

export const assessmentTargets = ['all_delegates', 'group'] as const;
export type AssessmentTarget = (typeof assessmentTargets)[number];

/** Event formats that take place somewhere, so a venue is required (brief section 3). */
export function formatNeedsVenue(format: EventFormat): boolean {
  return format === 'physical' || format === 'hybrid';
}

// ------------------------------------------------------------------ primitives

/** A calendar date as YYYY-MM-DD that really exists (no 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD')
  .refine((value) => {
    const d = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date');

/** Wall-clock time of day in the event's time zone, 24-hour. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the form HH:MM (24-hour)');

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Unique event code, generated from the name: lowercase letters, digits and hyphens. */
export const eventCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,62})$/,
    'Lowercase letters, digits and hyphens, 2 to 63 characters',
  );

/** Optional text: blank means "not set" and is stored as null. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );
const optionalUrl = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z
      .url({ protocol: /^https?$/ })
      .max(500)
      .nullable()
      .optional(),
  );

/** "ITTEC 2026: Impact & Practice" -> "ittec-2026-impact-practice"; empty names fall back to "event". */
export function eventCodeFromName(name: string): string {
  const code = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .replace(/-+$/g, '');
  return code.length >= 2 ? code : 'event';
}

export function sortIsoDates(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}

// ------------------------------------------------------------------ profile and dates

export const eventProfileFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Give the event a name').max(200),
  description: z.string().trim().min(1, 'Describe the event').max(5_000),
  eventType: z.enum(eventTypes),
  organiser: z.string().trim().min(1, 'Name the organiser').max(200),
  format: z.enum(eventFormats),
  timezone: z.string().trim().min(1).refine(isValidTimeZone, 'Unknown time zone'),
  theme: optionalText(200),
  location: optionalText(300),
  website: optionalUrl(),
  imageUrl: optionalUrl(),
  additionalInfo: optionalText(5_000),
});
export type EventProfileFields = z.infer<typeof eventProfileFieldsSchema>;

/** Rules that span fields; the API applies them to the merged profile on create, patch and publish. */
export function eventProfileIssues(profile: {
  format: EventFormat;
  location?: string | null;
}): string[] {
  const issues: string[] = [];
  if (formatNeedsVenue(profile.format) && !profile.location?.trim()) {
    issues.push('A venue or location is required for an in-person or hybrid event.');
  }
  return issues;
}

const noDuplicateDates = (value: { dates: string[] }, ctx: z.RefinementCtx) => {
  if (new Set(value.dates).size !== value.dates.length) {
    ctx.addIssue({ code: 'custom', path: ['dates'], message: 'Each date can be selected once' });
  }
};

export const eventDatesSchema = z
  .object({ dates: z.array(isoDateSchema).min(1, 'Select at least one date').max(60) })
  .superRefine(noDuplicateDates);
export type EventDates = z.infer<typeof eventDatesSchema>;

export const eventCreateSchema = eventProfileFieldsSchema
  .extend({ dates: z.array(isoDateSchema).min(1, 'Select at least one date').max(60) })
  .superRefine(noDuplicateDates);
export type EventCreate = z.infer<typeof eventCreateSchema>;

/**
 * Whether delegates see Transfer Planning (2026-11-08). Hidden means no "Transfer plans" tab, no
 * next step, no reminders and no "where your actions stand" step in the follow-ups; "scheduled"
 * hides it until a date and time. Plans and their data stay either way and come back when shown.
 */
export const transferPlanVisibilities = ['shown', 'hidden', 'scheduled'] as const;
export type TransferPlanVisibility = (typeof transferPlanVisibilities)[number];
export const transferPlanVisibilityLabels: Record<TransferPlanVisibility, string> = {
  shown: 'Shown to delegates',
  hidden: 'Hidden from delegates',
  scheduled: 'Hidden until a date and time',
};
export function transferPlanVisible(
  event: {
    transferPlanVisibility: TransferPlanVisibility;
    transferPlanShownFrom: string | Date | null;
  },
  at: Date,
): boolean {
  if (event.transferPlanVisibility === 'shown') return true;
  if (event.transferPlanVisibility === 'hidden') return false;
  return event.transferPlanShownFrom !== null && new Date(event.transferPlanShownFrom) <= at;
}

export const eventPatchSchema = eventProfileFieldsSchema
  .partial()
  .extend({
    /**
     * Whether test delegates count in this event's reports, dashboards and summaries (decision of
     * 2026-11-05). Off by default so a rehearsal never leaks into the figures; never affects
     * whether a test delegate may sign in.
     */
    countTestDelegates: z.boolean().optional(),
    transferPlanVisibility: z.enum(transferPlanVisibilities).optional(),
    /** The instant Transfer Planning becomes visible when scheduled (ISO 8601 with offset). */
    transferPlanShownFrom: z.iso.datetime({ offset: true }).nullable().optional(),
    /** The plan mode, its place in the journey and the checklist's wording (2026-11-20). */
    transferPlanMode: z.enum(transferPlanModes).optional(),
    transferPlanPosition: z.enum(transferPlanPositions).optional(),
    transferPlanTemplate: checklistTemplateSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.transferPlanVisibility === 'scheduled' && !value.transferPlanShownFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['transferPlanShownFrom'],
        message: 'Say from when delegates see Transfer Planning.',
      });
    }
  });
export type EventPatch = z.infer<typeof eventPatchSchema>;

export const eventStatusSchema = z.object({ status: z.enum(eventStatuses) });
export type EventStatusChange = z.infer<typeof eventStatusSchema>;

// ------------------------------------------------------------------ sessions

export const sessionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give the session a title').max(200),
  date: isoDateSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  sessionType: z.enum(sessionTypes),
  description: optionalText(2_000),
  venue: optionalText(200),
  speaker: optionalText(200),
  capacity: z.number().int().min(1).max(100_000).nullable().optional(),
  /** Session-specific feedback form, configured separately and linked to this session. */
  feedbackEnabled: z.boolean().default(false),
});

export function sessionTimeIssue(startTime: string, endTime: string): string | null {
  return endTime > startTime ? null : 'The end time must be later than the start time.';
}

export const sessionCreateSchema = sessionFieldsSchema.superRefine((value, ctx) => {
  const issue = sessionTimeIssue(value.startTime, value.endTime);
  if (issue) ctx.addIssue({ code: 'custom', path: ['endTime'], message: issue });
});
export type SessionCreate = z.infer<typeof sessionCreateSchema>;

export const sessionPatchSchema = sessionFieldsSchema.partial();
export type SessionPatch = z.infer<typeof sessionPatchSchema>;

// ------------------------------------------------------------------ assessment stages

export const assessmentStageConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** Instants (ISO 8601 with offset); the UI enters them in the event's time zone. */
    opensAt: z.iso.datetime({ offset: true }).nullable().optional(),
    closesAt: z.iso.datetime({ offset: true }).nullable().optional(),
    target: z.enum(assessmentTargets).default('all_delegates'),
    targetGroup: optionalText(200),
    status: z.enum(assessmentStageStatuses).default('draft'),
    /** The organisers' own name and purpose line (2026-11-20); absent keeps what is stored. */
    title: optionalText(120),
    description: optionalText(600),
  })
  .superRefine((value, ctx) => {
    if (value.opensAt && value.closesAt && value.closesAt <= value.opensAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'The deadline must be later than the opening time.',
      });
    }
    if (value.target === 'group' && !value.targetGroup) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetGroup'],
        message: 'Name the participant group.',
      });
    }
    if (!value.enabled && value.status !== 'draft') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'A disabled stage stays in draft.',
      });
    }
    if (value.status === 'scheduled' && !value.opensAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['opensAt'],
        message: 'A scheduled stage needs an opening time.',
      });
    }
  });
export type AssessmentStageConfigInput = z.infer<typeof assessmentStageConfigSchema>;

// ------------------------------------------------------------------ responses

export const eventDateViewSchema = z.object({ id: z.uuid(), date: isoDateSchema });
export type EventDateView = z.infer<typeof eventDateViewSchema>;

/**
 * A batch (decision 2026-11-19): a group of the event's delegates who come on one of its days.
 * A delegate in a batch has one check-in code, one attendance day and one reflection day; a
 * delegate in no batch takes part on every day, as before. Questions, assessments, emails and
 * reports stay the event's, and reports can be filtered by batch.
 */
export const eventBatchViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  eventDateId: z.uuid(),
  date: isoDateSchema,
  order: z.number().int(),
  /** Registrations in the batch, every status counted. */
  delegates: z.number().int(),
});
export type EventBatchView = z.infer<typeof eventBatchViewSchema>;

export const eventBatchCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name the batch').max(80),
  eventDateId: z.uuid(),
});
export type EventBatchCreate = z.infer<typeof eventBatchCreateSchema>;
export const eventBatchPatchSchema = eventBatchCreateSchema.partial();
export type EventBatchPatch = z.infer<typeof eventBatchPatchSchema>;
export const eventBatchesResponseSchema = z.object({ batches: z.array(eventBatchViewSchema) });
export type EventBatchesResponse = z.infer<typeof eventBatchesResponseSchema>;

export const eventSessionViewSchema = z.object({
  id: z.uuid(),
  eventDateId: z.uuid(),
  date: isoDateSchema,
  title: z.string(),
  sessionType: z.enum(sessionTypes),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  description: z.string().nullable(),
  venue: z.string().nullable(),
  speaker: z.string().nullable(),
  capacity: z.number().int().nullable(),
  feedbackEnabled: z.boolean(),
});
export type EventSessionView = z.infer<typeof eventSessionViewSchema>;

/**
 * The confirmation a delegate sees once an assessment is fully submitted (decision 2026-11-19):
 * the organisers' own title, message and closing line (null keeps the platform's wording), and
 * how it looks. Stored as JSON on the stage configuration; defaults reproduce the fixed popup.
 */
export const confirmationTones = ['green', 'accent', 'ink'] as const;
export type ConfirmationTone = (typeof confirmationTones)[number];
export const confirmationToneLabels: Record<ConfirmationTone, string> = {
  green: 'Green',
  accent: 'Accent',
  ink: 'Ink',
};
export const confirmationAlignments = ['center', 'left'] as const;
export type ConfirmationAlignment = (typeof confirmationAlignments)[number];
export const confirmationAlignmentLabels: Record<ConfirmationAlignment, string> = {
  center: 'Centred',
  left: 'Left',
};
/** Trimmed text that is null when blank or absent, so a stored record always has the key. */
const confirmationText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
export const assessmentConfirmationSchema = z.object({
  /** The submit button's words (2026-11-22); null keeps "Submit answers" / "Submit section". */
  submitLabel: confirmationText(40).optional(),
  title: confirmationText(120),
  message: confirmationText(600),
  detail: confirmationText(600),
  tone: z.enum(confirmationTones).default('green'),
  align: z.enum(confirmationAlignments).default('center'),
  showIcon: z.boolean().default(true),
  highlight: z.boolean().default(false),
});
export type AssessmentConfirmation = z.infer<typeof assessmentConfirmationSchema>;
export type AssessmentConfirmationInput = z.input<typeof assessmentConfirmationSchema>;
export const DEFAULT_CONFIRMATION: AssessmentConfirmation = {
  title: null,
  message: null,
  detail: null,
  tone: 'green',
  align: 'center',
  showIcon: true,
  highlight: false,
};
/** The stored settings, or null when none or unreadable (the popup then uses the defaults). */
export function parseConfirmation(value: unknown): AssessmentConfirmation | null {
  if (value === null || value === undefined) return null;
  const parsed = assessmentConfirmationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const assessmentStageViewSchema = z.object({
  stage: z.enum(assessmentStages),
  /** Which round of the stage: always 1 except the follow-up waves (E12-1). */
  wave: z.number().int(),
  /** What this wave is called where a stage has several ("30-day follow-up"); else empty. */
  waveLabel: z.string(),
  /** Days after the event's last day this wave is due; null for the single-round stages. */
  dueAfterDays: z.number().int().nullable(),
  /** Chase a non-responder after this many days, this many times (E12-14). */
  reminderAfterDays: z.number().int().nullable(),
  reminderLimit: z.number().int(),
  enabled: z.boolean(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  target: z.enum(assessmentTargets),
  targetGroup: z.string().nullable(),
  status: z.enum(assessmentStageStatuses),
  /** Active (non-retired) questions; an enabled stage needs at least one to publish or open. */
  questionCount: z.number().int(),
  /** The submission confirmation's words and look (2026-11-19); null means the defaults. */
  confirmation: assessmentConfirmationSchema.nullable().optional(),
  /** The organisers' own name and purpose line (2026-11-20); null means the platform's. */
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  updatedAt: z.string(),
});
export type AssessmentStageView = z.infer<typeof assessmentStageViewSchema>;

/**
 * What an assessment is called (2026-11-20): the organisers' own title where set, else the
 * wave's name ("30-day follow-up"), else the platform's title for the event's kind.
 */
export function stageTitleOf(
  stage: {
    stage: AssessmentStage;
    waveLabel?: string | null;
    title?: string | null;
    wave?: number;
  },
  eventType: EventType | null | undefined,
): string {
  return (
    stage.title?.trim() ||
    stage.waveLabel ||
    roundLabelOf(stageLabelsFor(eventType)[stage.stage], stage)
  );
}

/**
 * An added wave of an assessment (2026-11-21), until the organisers name it: "Pre-conference
 * assessment (wave 2)". The first wave, and the follow-ups (named by their interval), keep the
 * plain name.
 */
export function roundLabelOf(
  name: string,
  stage: { stage: AssessmentStage; wave?: number },
): string {
  return stage.stage !== 'follow_up' && (stage.wave ?? 1) > 1
    ? `${name} (wave ${stage.wave})`
    : name;
}

/** How many waves one assessment may have (2026-11-21); the follow-ups have their own rule. */
export const MAX_ASSESSMENT_ROUNDS = 10;

export const stageWindowStates = ['hidden', 'upcoming', 'open', 'closed'] as const;
export type StageWindowState = (typeof stageWindowStates)[number];

/**
 * What delegates see for a stage at `at`. A draft or disabled stage is hidden and a closed
 * stage is closed whatever its dates. A scheduled or open stage follows its window: upcoming
 * before "available from", closed after the deadline, open in between (a scheduled stage opens
 * by itself at its opening time; nobody has to flip it). The admin card and the delegate view
 * both use this, so the two sides agree.
 */
export function stageWindowState(
  stage: {
    enabled?: boolean;
    status: AssessmentStageStatus;
    opensAt: string | Date | null;
    closesAt: string | Date | null;
  },
  at: Date,
): StageWindowState {
  if (stage.enabled === false || stage.status === 'draft') return 'hidden';
  if (stage.status === 'closed') return 'closed';
  const opens = stage.opensAt ? new Date(stage.opensAt) : null;
  const closes = stage.closesAt ? new Date(stage.closesAt) : null;
  if (opens && at < opens) return 'upcoming';
  if (closes && at > closes) return 'closed';
  return 'open';
}

export const eventDetailSchema = z.object({
  id: z.uuid(),
  /** The unique event code, generated from the name at creation (stored as the slug). */
  code: eventCodeSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  eventType: z.enum(eventTypes),
  organiser: z.string(),
  format: z.enum(eventFormats),
  timezone: z.string(),
  theme: z.string().nullable(),
  location: z.string().nullable(),
  website: z.string().nullable(),
  imageUrl: z.string().nullable(),
  additionalInfo: z.string().nullable(),
  status: z.enum(eventStatuses),
  /** Whether test delegates count in reports and figures; see eventPatchSchema. */
  countTestDelegates: z.boolean(),
  /** Whether delegates see Transfer Planning (2026-11-08); see transferPlanVisible. */
  transferPlanVisibility: z.enum(transferPlanVisibilities),
  transferPlanShownFrom: z.string().nullable(),
  /** The plan mode, its place in the journey and the checklist's wording (2026-11-20). */
  transferPlanMode: z.enum(transferPlanModes).optional(),
  transferPlanPosition: z.enum(transferPlanPositions).optional(),
  transferPlanTemplate: checklistTemplateSchema.nullable().optional(),
  /** Derived: the earliest and latest selected dates (brief section 4, pending confirmation). */
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  dates: z.array(eventDateViewSchema),
  /** The batches in order (2026-11-19); empty for an event everyone attends on every day. */
  batches: z.array(eventBatchViewSchema).optional(),
  sessions: z.array(eventSessionViewSchema),
  assessmentStages: z.array(assessmentStageViewSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

/** What still blocks publication; empty means the event can be published. */
export const assessmentStageNames: Record<AssessmentStage, string> = {
  pre_conference: 'pre-conference',
  during_conference: 'during-conference',
  end_of_conference: 'end-of-conference',
  follow_up: 'follow-up',
};

/** The lower-case stage names for an event of this type: "pre-training", "end-of-webinar". */
export function stageNamesFor(
  eventType: EventType | null | undefined,
): Record<AssessmentStage, string> {
  const noun = eventNounOf(eventType);
  return {
    pre_conference: `pre-${noun}`,
    during_conference: `during-${noun}`,
    end_of_conference: `end-of-${noun}`,
    follow_up: 'follow-up',
  };
}

/** The stage titles for an event of this type: "Pre-training assessment", "Post-webinar follow-up". */
export function stageLabelsFor(
  eventType: EventType | null | undefined,
): Record<AssessmentStage, string> {
  const noun = eventNounOf(eventType);
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  return {
    pre_conference: `${cap(`pre-${noun}`)} assessment`,
    during_conference: `${cap(`during-${noun}`)} assessment`,
    end_of_conference: `${cap(`end-of-${noun}`)} evaluation`,
    follow_up: `${cap(`post-${noun}`)} follow-up`,
  };
}

export function eventPublishIssues(
  event: Pick<EventDetail, 'format' | 'location' | 'dates'> & {
    assessmentStages?: Array<Pick<AssessmentStageView, 'stage' | 'enabled' | 'questionCount'>>;
  },
): string[] {
  const issues: string[] = [];
  if (event.dates.length === 0) issues.push('Select at least one event date.');
  issues.push(...eventProfileIssues(event));
  for (const stage of event.assessmentStages ?? []) {
    if (stage.enabled && stage.questionCount === 0) {
      issues.push(
        `The ${assessmentStageNames[stage.stage]} assessment is enabled but has no questions yet.`,
      );
    }
  }
  return issues;
}
