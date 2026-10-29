import { describe, expect, it } from 'vitest';

import {
  countdownLine,
  daysUntil,
  formatEventDates,
  journeyFor,
  shortEventName,
} from './my-events';

const lagos = {
  name: 'ITTEC 2026: International Training Transfer Effectiveness Conference',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
};

describe('my-events helpers', () => {
  it('formats ranges and counts days', () => {
    expect(formatEventDates('2026-11-12', '2026-11-13')).toBe('12-13 November 2026');
    expect(formatEventDates('2026-11-12', '2026-11-12')).toBe('12 November 2026');
    expect(formatEventDates('2026-11-30', '2026-12-02')).toBe('30 November to 2 December 2026');
    expect(formatEventDates('2026-12-30', '2027-01-02')).toBe('30 December 2026 to 2 January 2027');
    expect(daysUntil('2026-11-12', new Date('2026-11-02T23:00:00Z'))).toBe(10);
    expect(daysUntil('2026-11-12', new Date('2026-11-13T08:00:00Z'))).toBe(-1);
    expect(shortEventName(lagos.name)).toBe('ITTEC 2026');
    expect(shortEventName('Summit')).toBe('Summit');
  });

  it('says how far away the event is', () => {
    expect(countdownLine(lagos, new Date('2026-11-02T10:00:00Z'))).toBe(
      'ITTEC 2026 starts in 10 days.',
    );
    expect(countdownLine(lagos, new Date('2026-11-11T10:00:00Z'))).toBe(
      'ITTEC 2026 starts tomorrow.',
    );
    expect(countdownLine(lagos, new Date('2026-11-12T06:00:00Z'))).toBe('ITTEC 2026 starts today.');
    expect(countdownLine(lagos, new Date('2026-11-13T06:00:00Z'))).toBe('ITTEC 2026 is under way.');
    expect(countdownLine(lagos, new Date('2026-11-20T06:00:00Z'))).toBe('ITTEC 2026 has ended.');
  });

  it('derives the journey from the event dates and includes the 180-day follow-up', () => {
    const steps = journeyFor(lagos);
    expect(steps.map((s) => s.step)).toEqual(['Before', 'Day 1', 'Day 2', 'After']);
    expect(steps[1]?.note).toBe('12 November 2026');
    expect(steps[2]?.note).toBe('13 November 2026');
    expect(steps[3]?.title).toMatch(/30, 60, 90 and 180 days/);
    expect(journeyFor({ startsOn: '2026-05-05', endsOn: '2026-05-05' })).toHaveLength(3);
    expect(journeyFor({ startsOn: '2026-05-05', endsOn: '2026-05-08' })[1]?.note).toBe(
      '5-8 May 2026',
    );
  });
});
