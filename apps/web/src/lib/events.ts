import type {
  AssessmentStage,
  AssessmentStageStatus,
  AssessmentTarget,
  EventDetail,
  EventFormat,
  EventSessionView,
  EventStatus,
  EventType,
  SessionType,
} from '@mbc/shared';

export type {
  AssessmentStageConfigInput,
  AssessmentStageView,
  EventCreate,
  EventDetail,
  EventPatch,
  EventProfileFields,
  EventSessionView,
  SessionCreate,
} from '@mbc/shared';

export const eventTypeLabels: Record<EventType, string> = {
  conference: 'Conference',
  workshop: 'Workshop',
  seminar: 'Seminar',
  summit: 'Summit',
  training: 'Training',
  other: 'Other',
};

export const eventFormatLabels: Record<EventFormat, string> = {
  physical: 'In person',
  virtual: 'Online',
  hybrid: 'Hybrid',
};

export const eventStatusLabels: Record<EventStatus, string> = {
  draft: 'Draft',
  active: 'Published',
  archived: 'Archived',
};

export const sessionTypeLabels: Record<SessionType, string> = {
  keynote: 'Keynote',
  plenary: 'Plenary',
  panel: 'Panel',
  workshop: 'Workshop',
  breakout: 'Breakout',
  transfer_planning: 'Transfer Planning',
  networking: 'Networking',
  other: 'Other',
};

export const stageLabels: Record<AssessmentStage, string> = {
  pre_conference: 'Pre-conference assessment',
  during_conference: 'During-conference assessment',
  end_of_conference: 'End-of-conference evaluation',
  follow_up: 'Follow-up assessment',
};

export const stageWhen: Record<AssessmentStage, string> = {
  pre_conference: 'Before the event',
  during_conference: 'During the event',
  end_of_conference: 'At the close of the event',
  follow_up: 'After the event',
};

export const stagePurpose: Record<AssessmentStage, string> = {
  pre_conference:
    'Establish participants’ baseline knowledge, confidence, expectations and learning needs before they attend.',
  during_conference:
    'Measure learning, engagement and experience while the event is taking place. Session-specific feedback is linked to each session separately.',
  end_of_conference:
    'Evaluate the experience, repeat the knowledge and confidence questions for paired results, and record learning gained, readiness to apply and how far expectations were met.',
  follow_up:
    'Find out whether participants retained and applied what they learned after attending.',
};

export const stageAreas: Record<AssessmentStage, string[]> = {
  pre_conference: [
    'Existing knowledge and understanding',
    'Current confidence level',
    'Expectations and learning objectives',
    'Relevant professional experience',
    'Existing challenges related to the subject',
  ],
  during_conference: [
    'Knowledge gained',
    'Changes in confidence',
    'Session relevance and usefulness',
    'Participant engagement',
    'Session feedback and satisfaction',
  ],
  end_of_conference: [
    'Conference experience',
    'Knowledge gained',
    'Changes in confidence',
    'Learning gained and unresolved needs',
    'Readiness to apply',
    'Expectations met',
  ],
  follow_up: [
    'Knowledge retention',
    'Application of learning at work',
    'Changes in professional practice',
    'Outcomes achieved',
    'Challenges encountered',
    'Organisational benefits and impact',
  ],
};

export const stageStatusLabels: Record<AssessmentStageStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
};

export const targetLabels: Record<AssessmentTarget, string> = {
  all_delegates: 'All delegates',
  group: 'A defined participant group',
};

/** "Tuesday 10 November 2026" for a YYYY-MM-DD date. */
export function formatDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
  return `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })} ${part({ year: 'numeric' })}`;
}

/** "10 Nov 2026" for a YYYY-MM-DD date. */
export function formatDateShort(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The schedule: every selected date in order, each with its sessions in time order (brief 5). */
export function scheduleOf(
  event: Pick<EventDetail, 'dates' | 'sessions'>,
): Array<{ date: string; eventDateId: string; sessions: EventSessionView[] }> {
  return event.dates.map((d) => ({
    date: d.date,
    eventDateId: d.id,
    sessions: event.sessions
      .filter((s) => s.date === d.date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title)),
  }));
}

/** Time zones the picker offers; the full IANA list where the runtime has it. */
export function timeZoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return all.length ? all : ['Africa/Lagos', 'Europe/London', 'UTC'];
}

const PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function partsIn(timeZone: string, date: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', { ...PARTS, timeZone }).formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

/** Offset of the zone at that instant, in milliseconds east of UTC. */
function offsetMs(timeZone: string, date: Date): number {
  const p = partsIn(timeZone, date);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - date.getTime();
}

/**
 * Wall-clock "YYYY-MM-DDTHH:mm" in the event's time zone to an ISO instant (brief 8.9: windows are
 * valid in the event's zone). Null when the input is not a complete local date-time.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let instant = naive;
  for (let i = 0; i < 2; i += 1) instant = naive - offsetMs(timeZone, new Date(instant));
  const d = new Date(instant);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The reverse: an ISO instant as "YYYY-MM-DDTHH:mm" wall-clock in the zone, for datetime inputs. */
export function isoToZonedLocal(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const p = partsIn(timeZone, new Date(iso));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month!)}-${two(p.day!)}T${two(p.hour! % 24)}:${two(p.minute!)}`;
}

/** "10 Nov 2026, 09:00 WAT" for an instant, in the event's zone. */
export function formatInstant(iso: string | null, timeZone: string): string {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  });
}
