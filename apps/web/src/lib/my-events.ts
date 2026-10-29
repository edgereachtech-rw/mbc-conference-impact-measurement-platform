import type { MyEvent } from '@mbc/shared';

/** Labels for the delegate screens; event facts themselves always come from the API. */
export const formatLabel = { physical: 'In person', virtual: 'Online', hybrid: 'Hybrid' } as const;
export const capacityLabel = {
  individual: 'Individual',
  nominee: 'Nominated by an organisation',
  other: 'Other',
} as const;
export const attendanceFormatLabel = { physical: 'In person', virtual: 'Online' } as const;
/** Where an event without a venue line takes place; distinct from how the delegate takes part. */
export const formatWhereLabel = {
  physical: 'In-person event',
  virtual: 'Online event',
  hybrid: 'Hybrid event',
} as const;

/** "ITTEC 2026: International …" reads as "ITTEC 2026" in short spaces, like the email header. */
export function shortEventName(name: string): string {
  const [short] = name.split(':');
  return short?.trim() || name;
}

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

const FULL: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
};

/** "12-13 November 2026", "30 November to 2 December 2026", or a single day. */
export function formatEventDates(startsOn: string, endsOn: string): string {
  const start = toUtcDate(startsOn);
  const end = toUtcDate(endsOn);
  if (startsOn === endsOn) return start.toLocaleDateString('en-GB', FULL);
  if (startsOn.slice(0, 7) === endsOn.slice(0, 7)) {
    return `${start.getUTCDate()}-${end.toLocaleDateString('en-GB', FULL)}`;
  }
  const noYear: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: 'UTC' };
  return startsOn.slice(0, 4) === endsOn.slice(0, 4)
    ? `${start.toLocaleDateString('en-GB', noYear)} to ${end.toLocaleDateString('en-GB', FULL)}`
    : `${start.toLocaleDateString('en-GB', FULL)} to ${end.toLocaleDateString('en-GB', FULL)}`;
}

/** "12 November 2026" for one day. */
export function formatEventDay(iso: string): string {
  return toUtcDate(iso).toLocaleDateString('en-GB', FULL);
}

/** "29 October 2026" for a timestamp, in the reader's calendar. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Whole days from today to the first day; negative once it has started. */
export function daysUntil(startsOn: string, today: Date = new Date()): number {
  const todayIso = today.toISOString().slice(0, 10);
  return Math.round((toUtcDate(startsOn).getTime() - toUtcDate(todayIso).getTime()) / 86_400_000);
}

/** "ITTEC 2026 starts in 10 days." and its variants around and after the dates. */
export function countdownLine(
  event: Pick<MyEvent, 'name' | 'startsOn' | 'endsOn'>,
  today?: Date,
): string {
  const days = daysUntil(event.startsOn, today);
  const name = shortEventName(event.name);
  if (days > 1) return `${name} starts in ${days} days.`;
  if (days === 1) return `${name} starts tomorrow.`;
  if (days === 0) return `${name} starts today.`;
  return daysUntil(event.endsOn, today) >= 0 ? `${name} is under way.` : `${name} has ended.`;
}

export interface JourneyStep {
  step: string;
  title: string;
  note: string;
}

/** The stages of one event's journey, with that event's own dates. */
export function journeyFor(event: Pick<MyEvent, 'startsOn' | 'endsOn'>): JourneyStep[] {
  const days = daysUntil(event.endsOn, toUtcDate(event.startsOn)) + 1;
  const conferenceSteps: JourneyStep[] =
    days === 1
      ? [
          {
            step: 'Conference',
            title: 'Check-in, Transfer Plan and evaluation',
            note: formatEventDay(event.startsOn),
          },
        ]
      : days === 2
        ? [
            {
              step: 'Day 1',
              title: 'Check-in and Transfer Planning',
              note: formatEventDay(event.startsOn),
            },
            {
              step: 'Day 2',
              title: 'Transfer Plan and final evaluation',
              note: formatEventDay(event.endsOn),
            },
          ]
        : [
            {
              step: 'Conference',
              title: 'Daily check-ins, Transfer Plan and evaluation',
              note: formatEventDates(event.startsOn, event.endsOn),
            },
          ];
  return [
    { step: 'Before', title: 'Pre-conference check-in', note: 'Opens before the conference' },
    ...conferenceSteps,
    {
      step: 'After',
      title: 'Follow-ups at 30, 60, 90 and 180 days',
      note: 'Scheduled by the organisers',
    },
  ];
}
