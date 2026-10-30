import { z } from 'zod';

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
  'other',
] as const;
export type EventType = (typeof eventTypes)[number];

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

export const assessmentStages = ['pre_conference', 'during_conference', 'follow_up'] as const;
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

export const eventPatchSchema = eventProfileFieldsSchema.partial();
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

export const assessmentStageViewSchema = z.object({
  stage: z.enum(assessmentStages),
  enabled: z.boolean(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  target: z.enum(assessmentTargets),
  targetGroup: z.string().nullable(),
  status: z.enum(assessmentStageStatuses),
  /** Active (non-retired) questions; an enabled stage needs at least one to publish or open. */
  questionCount: z.number().int(),
  updatedAt: z.string(),
});
export type AssessmentStageView = z.infer<typeof assessmentStageViewSchema>;

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
  /** Derived: the earliest and latest selected dates (brief section 4, pending confirmation). */
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  dates: z.array(eventDateViewSchema),
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
  follow_up: 'follow-up',
};

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
