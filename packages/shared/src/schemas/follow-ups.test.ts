import { describe, expect, it } from 'vitest';

import {
  currentFollowUpWave,
  defaultWaveWindow,
  followUpWaveOf,
  followUpWaves,
  waveLabel,
  DEFAULT_FOLLOW_UP_WAVES,
  LONGER_TERM_WAVE,
} from './follow-ups.js';

/**
 * The Transfer Plan follow-ups (backlog E12-1; windows of 2026-11-09). What matters here is that
 * the default windows cover days 1-30, 31-60, 61-90 and 91 onwards after the last day of the
 * conference, read in the event's own time zone; that a wave is named by its interval, not its
 * row number; and that the reminder engine picks the wave whose window contains the moment.
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
    // Without an interval there is no wave name: the stage keeps its plain one. An event that
    // predates the schedule has one follow-up round, and it is not the 30-day wave.
    expect(waveLabel('follow_up', 1, null)).toBe('');
    expect(waveLabel('follow_up', 2, null)).toBe('');
    expect(waveLabel('pre_conference', 1, null)).toBe('');
  });

  it('windows cover days 1-30, 31-60, 61-90 and 91 onwards, at local midnight', () => {
    // ITTEC ends 13 November 2026; Lagos is UTC+1 all year, so 00:00 there is 23:00 UTC.
    const first = defaultWaveWindow('2026-11-13', 1, 'Africa/Lagos');
    expect(first.opensAt.toISOString()).toBe('2026-11-13T23:00:00.000Z'); // 14 Nov, day 1
    expect(first.closesAt?.toISOString()).toBe('2026-12-13T23:00:00.000Z'); // end of 13 Dec, day 30
    const second = defaultWaveWindow('2026-11-13', 2, 'Africa/Lagos');
    expect(second.opensAt.toISOString()).toBe('2026-12-13T23:00:00.000Z'); // day 31 starts
    expect(second.closesAt?.toISOString()).toBe('2027-01-12T23:00:00.000Z'); // day 60 ends
    const third = defaultWaveWindow('2026-11-13', 3, 'Africa/Lagos');
    expect(third.opensAt.toISOString()).toBe('2027-01-12T23:00:00.000Z');
    expect(third.closesAt?.toISOString()).toBe('2027-02-11T23:00:00.000Z');
    // The longer-term one starts on day 91 and stays open.
    const longer = defaultWaveWindow('2026-11-13', LONGER_TERM_WAVE, 'Africa/Lagos');
    expect(longer.opensAt.toISOString()).toBe('2027-02-11T23:00:00.000Z');
    expect(longer.closesAt).toBeNull();
  });

  it('reads midnight in the event zone, not in UTC, wherever the event is', () => {
    expect(defaultWaveWindow('2026-11-13', 1, 'Europe/London').opensAt.toISOString()).toBe(
      '2026-11-14T00:00:00.000Z',
    );
    // UTC-5 in November: 00:00 local is 05:00 UTC.
    expect(defaultWaveWindow('2026-11-13', 1, 'America/New_York').opensAt.toISOString()).toBe(
      '2026-11-14T05:00:00.000Z',
    );
  });

  it('crosses a month and a year end correctly', () => {
    expect(defaultWaveWindow('2026-12-20', 1, 'Africa/Lagos').closesAt?.toISOString()).toBe(
      '2027-01-19T23:00:00.000Z',
    );
  });

  it('picks the follow-up whose window contains the moment, enabled and with questions', () => {
    const wave = (n: number, opensAt: string, closesAt: string | null, extra = {}) => ({
      wave: n,
      enabled: true,
      status: 'scheduled',
      opensAt,
      closesAt,
      questions: 3,
      ...extra,
    });
    const waves = [
      wave(1, '2026-11-13T23:00:00.000Z', '2026-12-13T23:00:00.000Z'),
      wave(2, '2026-12-13T23:00:00.000Z', '2027-01-12T23:00:00.000Z'),
      wave(3, '2027-01-12T23:00:00.000Z', '2027-02-11T23:00:00.000Z', { status: 'draft' }),
      wave(4, '2027-02-11T23:00:00.000Z', null, { questions: 0 }),
    ];
    // Day 10 after the event: the 30-day follow-up.
    expect(currentFollowUpWave(waves, new Date('2026-11-23T09:00:00.000Z'))?.wave).toBe(1);
    // The first moment of day 31: the 60-day one, never both.
    expect(currentFollowUpWave(waves, new Date('2026-12-13T23:00:00.000Z'))?.wave).toBe(2);
    // A draft wave is not current, nor one without questions, nor a moment before the first.
    expect(currentFollowUpWave(waves, new Date('2027-01-20T09:00:00.000Z'))).toBeNull();
    expect(currentFollowUpWave(waves, new Date('2027-03-01T09:00:00.000Z'))).toBeNull();
    expect(currentFollowUpWave(waves, new Date('2026-11-13T12:00:00.000Z'))).toBeNull();
    // An open-ended window holds once it has questions.
    expect(
      currentFollowUpWave(
        [wave(4, '2027-02-11T23:00:00.000Z', null)],
        new Date('2028-01-01T00:00:00.000Z'),
      )?.wave,
    ).toBe(4);
  });
});
