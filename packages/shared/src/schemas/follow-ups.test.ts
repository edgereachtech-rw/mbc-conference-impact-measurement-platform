import { describe, expect, it } from 'vitest';

import {
  defaultWaveOpensAt,
  followUpWaveOf,
  followUpWaves,
  waveLabel,
  DEFAULT_FOLLOW_UP_WAVES,
} from './follow-ups.js';

/**
 * The follow-up waves (backlog E12-1). What matters here is that the default dates land where
 * M.Bryan expects them — 30, 60 and 90 days after the last day of the conference, at 09:00 in
 * the event's own time zone — and that a wave is named by its interval, not its row number.
 */
describe('follow-up waves', () => {
  it('defines the three default waves and the longer-term one', () => {
    expect(followUpWaves.map((w) => w.dueAfterDays)).toEqual([30, 60, 90, 180]);
    // The 180-day wave is P2 and has no questions yet, so it is not created by default.
    expect([...DEFAULT_FOLLOW_UP_WAVES]).toEqual([1, 2, 3]);
    expect(followUpWaveOf(2)?.label).toBe('60-day follow-up');
    expect(followUpWaveOf(9)).toBeUndefined();
  });

  it('names a wave by its interval, and names nothing for the single-round stages', () => {
    expect(waveLabel('follow_up', 1, 30)).toBe('30-day follow-up');
    expect(waveLabel('follow_up', 3, 90)).toBe('90-day follow-up');
    // An interval M.Bryan chose themselves still reads as what it is.
    expect(waveLabel('follow_up', 5, 45)).toBe('45-day follow-up');
    // Without an interval it falls back to the wave's own definition.
    expect(waveLabel('follow_up', 2, null)).toBe('60-day follow-up');
    expect(waveLabel('pre_conference', 1, null)).toBe('');
  });

  it('opens 30 days after the last day at 09:00 in the event zone', () => {
    // ITTEC ends 13 November 2026; Lagos is UTC+1 all year, so 09:00 there is 08:00 UTC.
    const opens = defaultWaveOpensAt('2026-11-13', 30, 'Africa/Lagos');
    expect(opens.toISOString()).toBe('2026-12-13T08:00:00.000Z');
    expect(defaultWaveOpensAt('2026-11-13', 60, 'Africa/Lagos').toISOString()).toBe(
      '2027-01-12T08:00:00.000Z',
    );
    expect(defaultWaveOpensAt('2026-11-13', 90, 'Africa/Lagos').toISOString()).toBe(
      '2027-02-11T08:00:00.000Z',
    );
  });

  it('reads 09:00 in the event zone, not in UTC, wherever the event is', () => {
    // UTC+0 in winter: 09:00 local is 09:00 UTC.
    expect(defaultWaveOpensAt('2026-11-13', 30, 'Europe/London').toISOString()).toBe(
      '2026-12-13T09:00:00.000Z',
    );
    // UTC-5 in December: 09:00 local is 14:00 UTC.
    expect(defaultWaveOpensAt('2026-11-13', 30, 'America/New_York').toISOString()).toBe(
      '2026-12-13T14:00:00.000Z',
    );
  });

  it('crosses a month and a year end correctly', () => {
    expect(defaultWaveOpensAt('2026-12-20', 30, 'Africa/Lagos').toISOString()).toBe(
      '2027-01-19T08:00:00.000Z',
    );
  });
});
