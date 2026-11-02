import { z } from 'zod';

/**
 * The follow-up programme (backlog E12-1, E12-4 to E12-7, S11).
 *
 * The follow-up assessment runs in waves: 30, 60 and 90 days after the conference, and a
 * longer-term one at about 180 days. Each wave is a row of the same stage with its own dates,
 * questions and invitations, so the question engine, drafts, reports and journey all serve it
 * unchanged — a wave is not a second kind of form.
 *
 * Dates are a default, not a rule: M.Bryan moves any wave (E12-1 says editable). The wave is
 * named by how many days after the event it is due, so a schedule of 30/60/90 reads as such
 * wherever it appears.
 */

export const followUpWaves = [
  { wave: 1, dueAfterDays: 30, label: '30-day follow-up' },
  { wave: 2, dueAfterDays: 60, label: '60-day follow-up' },
  { wave: 3, dueAfterDays: 90, label: '90-day follow-up' },
  /**
   * E12-7 is P2: the form and the selection model are built now, the scheduling and sending are
   * configured after go-live, and M.Bryan has still to supply its questions. It is created only
   * when an admin asks for it.
   */
  { wave: 4, dueAfterDays: 180, label: 'Longer-term follow-up' },
] as const;

export type FollowUpWave = (typeof followUpWaves)[number];

/** The three waves created by default; the longer-term one is added deliberately. */
export const DEFAULT_FOLLOW_UP_WAVES = [1, 2, 3] as const;

export const followUpWaveOf = (wave: number): FollowUpWave | undefined =>
  followUpWaves.find((w) => w.wave === wave);

/**
 * What a wave of any stage is called. Only the follow-up stage has more than one, so the other
 * stages keep their plain name and never read "wave 1 of ...".
 */
export function waveLabel(stage: string, wave: number, dueAfterDays: number | null): string {
  if (stage !== 'follow_up') return '';
  if (dueAfterDays !== null) {
    const known = followUpWaves.find((w) => w.dueAfterDays === dueAfterDays);
    if (known) return known.label;
    return `${dueAfterDays}-day follow-up`;
  }
  return followUpWaveOf(wave)?.label ?? `Follow-up ${wave}`;
}

/**
 * The default opening moment of a wave: `dueAfterDays` after the event's last day, at the hour
 * given, read in the event's time zone. Returned as an instant, because that is how the platform
 * stores every time.
 */
export function defaultWaveOpensAt(
  endsOn: string,
  dueAfterDays: number,
  timezone: string,
  hour = 9,
): Date {
  const [y, m, d] = endsOn.split('-').map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + dueAfterDays * 86_400_000;
  const local = new Date(base);
  // The offset of the event's zone at that moment, so 09:00 means 09:00 where the event was.
  const name =
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(local)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  const offsetMinutes = match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : 0;
  return new Date(base + hour * 3_600_000 - offsetMinutes * 60_000);
}

/** How long a wave stays open by default, in days, before its deadline. */
export const FOLLOW_UP_OPEN_DAYS = 21;

/** Chase a delegate who has not submitted, by default once a week, twice. */
export const FOLLOW_UP_REMINDER_AFTER_DAYS = 7;
export const FOLLOW_UP_REMINDER_LIMIT = 2;

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
});
export type FollowUpWaveView = z.infer<typeof followUpWaveViewSchema>;

export const followUpScheduleSchema = z.object({
  waves: z.array(followUpWaveViewSchema),
  /** Delegates eligible to be invited, the denominator of every response rate here. */
  eligible: z.number().int(),
});
export type FollowUpSchedule = z.infer<typeof followUpScheduleSchema>;
