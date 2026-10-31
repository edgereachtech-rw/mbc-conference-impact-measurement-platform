import { describe, expect, it } from 'vitest';

import { formatDateLong, isoToZonedLocal, scheduleOf, zonedLocalToIso } from './events';

describe('event helpers', () => {
  it('converts wall-clock times in the event zone to instants and back', () => {
    expect(zonedLocalToIso('2026-11-05T09:00', 'Africa/Lagos')).toBe('2026-11-05T08:00:00.000Z');
    expect(zonedLocalToIso('2026-07-01T09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedLocalToIso('2026-01-01T09:00', 'Europe/London')).toBe('2026-01-01T09:00:00.000Z');
    expect(zonedLocalToIso('2026-11-05T09:00', 'America/New_York')).toBe(
      '2026-11-05T14:00:00.000Z',
    );
    expect(zonedLocalToIso('nope', 'Africa/Lagos')).toBeNull();
    expect(isoToZonedLocal('2026-11-05T08:00:00.000Z', 'Africa/Lagos')).toBe('2026-11-05T09:00');
    expect(isoToZonedLocal('2026-11-05T23:30:00.000Z', 'Africa/Lagos')).toBe('2026-11-06T00:30');
    expect(isoToZonedLocal(null, 'Africa/Lagos')).toBe('');
  });

  it('builds the schedule from the selected dates, keeping empty dates', () => {
    const schedule = scheduleOf({
      dates: [
        { id: 'a', date: '2026-11-10' },
        { id: 'b', date: '2026-11-12' },
      ],
      sessions: [
        {
          id: 's2',
          eventDateId: 'b',
          date: '2026-11-12',
          title: 'Late',
          sessionType: 'panel',
          startTime: '14:00',
          endTime: '15:00',
          description: null,
          venue: null,
          speaker: null,
          capacity: null,
          feedbackEnabled: false,
          transferPlanningFinal: false,
        },
        {
          id: 's1',
          eventDateId: 'b',
          date: '2026-11-12',
          title: 'Early',
          sessionType: 'keynote',
          startTime: '09:00',
          endTime: '10:00',
          description: null,
          venue: null,
          speaker: null,
          capacity: null,
          feedbackEnabled: true,
          transferPlanningFinal: false,
        },
      ],
    });
    expect(schedule.map((d) => [d.date, d.sessions.map((s) => s.title)])).toEqual([
      ['2026-11-10', []],
      ['2026-11-12', ['Early', 'Late']],
    ]);
    expect(formatDateLong('2026-11-10')).toBe('Tuesday 10 November 2026');
  });
});
