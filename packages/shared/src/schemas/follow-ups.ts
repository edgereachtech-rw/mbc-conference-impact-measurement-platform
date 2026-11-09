import { z } from 'zod';

/**
 * The Transfer Plan post-conference follow-ups (backlog E12-1, E12-4 to E12-7, S11).
 *
 * They are not a further assessment: each follow-up asks the delegate where every action of
 * their Transfer Plan stands and what they have applied. They run in waves, each covering a
 * stretch of days after the conference: by default the 30-day follow-up covers days 1 to 30,
 * the 60-day one days 31 to 60, the 90-day one days 61 to 90, and the longer-term one day 91
 * onwards (decision 2026-11-09). A wave is a row of the `follow_up` stage with its own window,
 * questions, invitations and answers, so the question engine, drafts, reports and journey serve
 * it unchanged.
 *
 * The windows are a default, not a rule: the organisers set when each follow-up starts and
 * ends on its card, per event. The delegate's own Transfer Plan reminders point at whichever
 * follow-up is current when they fire (`currentFollowUpWave`).
 */

export const followUpWaves = [
  { wave: 1, dueAfterDays: 30, label: '30-day follow-up' },
  { wave: 2, dueAfterDays: 60, label: '60-day follow-up' },
  { wave: 3, dueAfterDays: 90, label: '90-day follow-up' },
  /**
   * E12-7 is P2: the form and the selection model are built now, the scheduling and sending are
   * configured after go-live, and M.Bryan has still to supply its questions. It is created only
   * when an admin asks for it. Its window has no end by default.
   */
  { wave: 4, dueAfterDays: 180, label: 'Longer-term follow-up' },
] as const;

export type FollowUpWave = (typeof followUpWaves)[number];

/** The three waves created by default; the longer-term one is added deliberately. */
export const DEFAULT_FOLLOW_UP_WAVES = [1, 2, 3] as const;

/**
 * The longer-term wave (requirement 11.5, E12-7). It is not part of the default schedule: an
 * admin adds it when an event needs results that take longer than 90 days to emerge.
 */
export const LONGER_TERM_WAVE = 4;

export const followUpWaveOf = (wave: number): FollowUpWave | undefined =>
  followUpWaves.find((w) => w.wave === wave);

/**
 * What a wave is called, or an empty string when the stage has no wave name and should keep its
 * plain one ("Post-conference follow-up").
 *
 * Only an interval names a wave. A follow-up stage with no `dueAfterDays` is the single round an
 * event has always had, not the 30-day wave of a schedule: inferring a name from the wave number
 * alone labelled every such stage "30-day follow-up", which is what an event created before the
 * schedule existed would wrongly have shown (fixed 2026-11-03).
 */
export function waveLabel(stage: string, wave: number, dueAfterDays: number | null): string {
  if (stage !== 'follow_up' || dueAfterDays === null) return '';
  const known = followUpWaves.find((w) => w.dueAfterDays === dueAfterDays);
  return known ? known.label : `${dueAfterDays}-day follow-up`;
}

/** Midnight at the start of a calendar day (YYYY-MM-DD) in a time zone, as an instant. */
function localMidnight(day: string, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  // The offset of the zone at that moment, so 00:00 means 00:00 where the event was.
  const name =
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(base))
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  const offsetMinutes = match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : 0;
  return new Date(base - offsetMinutes * 60_000);
}

const plusDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The default window of a wave, from the event's last day (YYYY-MM-DD) in the event's zone: it
 * opens at the start of the day after the previous wave is due (the day after the event for the
 * first) and closes at the end of its own due day. The longer-term wave stays open. Returned as
 * instants, because that is how the platform stores every time.
 */
export function defaultWaveWindow(
  endsOn: string,
  wave: number,
  timezone: string,
): { opensAt: Date; closesAt: Date | null } {
  const definition = followUpWaveOf(wave);
  if (!definition) throw new Error(`Unknown follow-up wave ${wave}`);
  const previous = followUpWaves.filter((w) => w.wave < wave).at(-1)?.dueAfterDays ?? 0;
  const opensAt = localMidnight(plusDays(endsOn, previous + 1), timezone);
  const closesAt =
    wave === LONGER_TERM_WAVE
      ? null
      : localMidnight(plusDays(endsOn, definition.dueAfterDays + 1), timezone);
  return { opensAt, closesAt };
}

/** The shape `currentFollowUpWave` reads; a stage row or its view both fit. */
export interface FollowUpWindowLike {
  enabled: boolean;
  status: string;
  opensAt: Date | string | null;
  closesAt: Date | string | null;
  /** Active questions; a wave without any is never current (it cannot be answered). */
  questions: number;
}

const instant = (v: Date | string | null): number | null =>
  v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v);

/**
 * The follow-up a delegate should be answering at a given moment: the enabled, scheduled or
 * open wave with questions whose window contains `at`. The earliest such wave wins when windows
 * overlap. Null between windows, before the first and after the last.
 */
export function currentFollowUpWave<T extends FollowUpWindowLike & { wave: number }>(
  waves: readonly T[],
  at: Date,
): T | null {
  const t = at.getTime();
  const open = waves
    .filter((w) => w.enabled && (w.status === 'scheduled' || w.status === 'open'))
    .filter((w) => w.questions > 0)
    .filter((w) => {
      const from = instant(w.opensAt);
      const to = instant(w.closesAt);
      return (from === null || from <= t) && (to === null || t < to);
    })
    .sort((a, b) => a.wave - b.wave);
  return open[0] ?? null;
}

export const followUpScheduleRequestSchema = z.object({
  /** Which waves to create. Those that already exist are left exactly as they are. */
  waves: z
    .array(z.number().int().min(1).max(4))
    .min(1)
    .max(4)
    .default([...DEFAULT_FOLLOW_UP_WAVES]),
});
export type FollowUpScheduleRequest = z.infer<typeof followUpScheduleRequestSchema>;

export const followUpWaveViewSchema = z.object({
  id: z.uuid(),
  wave: z.number().int(),
  label: z.string(),
  dueAfterDays: z.number().int().nullable(),
  enabled: z.boolean(),
  status: z.string(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  questions: z.number().int(),
  /** Delegates invited, and how many have submitted (E12-13 response rate). */
  invited: z.number().int(),
  submitted: z.number().int(),
  reminderAfterDays: z.number().int().nullable(),
  reminderLimit: z.number().int(),
  /** When the invitation goes out automatically; null when the organisers send it by hand. */
  inviteAt: z.string().nullable(),
  /** When the scheduled or first manual invitation was sent; null until then. */
  invitesSentAt: z.string().nullable(),
});
export type FollowUpWaveView = z.infer<typeof followUpWaveViewSchema>;

/** The organisers schedule (or clear) the automatic sending of a wave's invitation. */
export const followUpInviteScheduleSchema = z.object({
  inviteAt: z.iso.datetime().nullable(),
});
export type FollowUpInviteSchedule = z.infer<typeof followUpInviteScheduleSchema>;

export const followUpScheduleSchema = z.object({
  waves: z.array(followUpWaveViewSchema),
  /** Delegates eligible to be invited, the denominator of every response rate here. */
  eligible: z.number().int(),
});
export type FollowUpSchedule = z.infer<typeof followUpScheduleSchema>;

// ------------------------------------------------------------------ the organisers' overview

/** Where one delegate stands on one wave. */
export const followUpResponseStates = ['none', 'started', 'submitted'] as const;
export type FollowUpResponseState = (typeof followUpResponseStates)[number];
export const followUpResponseStateLabels: Record<FollowUpResponseState, string> = {
  none: 'Not answered',
  started: 'Started',
  submitted: 'Submitted',
};

export const followUpOverviewRowSchema = z.object({
  delegateId: z.uuid(),
  name: z.string(),
  organisation: z.string().nullable(),
  /** By wave number. A wave the delegate has not touched is absent. */
  responses: z.record(
    z.string(),
    z.object({
      state: z.enum(followUpResponseStates),
      submittedAt: z.string().nullable(),
      updatedAt: z.string(),
      /** Planned actions whose status this wave recorded (2026-11-08 progress records). */
      statuses: z.number().int(),
    }),
  ),
});
export type FollowUpOverviewRow = z.infer<typeof followUpOverviewRowSchema>;

/**
 * Every delegate's follow-up responses in one place (decision 2026-11-09): one row per counted
 * delegate, one column per wave, with the schedule beside it.
 */
export const followUpOverviewSchema = z.object({
  waves: z.array(followUpWaveViewSchema),
  rows: z.array(followUpOverviewRowSchema),
  /** Delegates eligible to be invited: how many a first invitation would reach. */
  eligible: z.number().int(),
});
export type FollowUpOverview = z.infer<typeof followUpOverviewSchema>;
