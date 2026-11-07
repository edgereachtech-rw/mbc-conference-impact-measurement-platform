import { describe, expect, it } from 'vitest';

import {
  inFinalReminderWeek,
  instantOf,
  nextReminderAfter,
  planCompletionGaps,
  planHasResult,
  reminderPreferenceSchema,
  type ReminderPreference,
} from './transfer-plans.js';

const LAGOS = 'Africa/Lagos';
const pref = (over: Partial<ReminderPreference>): ReminderPreference => ({
  frequency: 'weekly',
  startOn: null,
  endOn: null,
  time: '09:00',
  days: [],
  ...over,
});

describe('reminder preferences', () => {
  it('needs two different weekdays for twice a week and an end after the start', () => {
    expect(
      reminderPreferenceSchema.safeParse({ frequency: 'twice_weekly', days: [1] }).success,
    ).toBe(false);
    expect(
      reminderPreferenceSchema.safeParse({ frequency: 'twice_weekly', days: [1, 1] }).success,
    ).toBe(false);
    expect(
      reminderPreferenceSchema.safeParse({ frequency: 'twice_weekly', days: [1, 4] }).success,
    ).toBe(true);
    expect(
      reminderPreferenceSchema.safeParse({
        frequency: 'daily',
        startOn: '2026-12-01',
        endOn: '2026-11-30',
      }).success,
    ).toBe(false);
    expect(reminderPreferenceSchema.safeParse({ frequency: 'daily', time: '25:00' }).success).toBe(
      false,
    );
    // Off: nothing else is checked, so a stale choice of days cannot block saving.
    expect(reminderPreferenceSchema.safeParse({ frequency: 'none', days: [1] }).success).toBe(true);
  });
});

describe('nextReminderAfter', () => {
  // 10:00 in Lagos on Thursday 12 November 2026.
  const from = new Date('2026-11-12T09:00:00.000Z');

  it('sends at the chosen time of day in the event timezone, never in the past', () => {
    // 09:00 Lagos has passed today, so daily goes tomorrow at 08:00 UTC.
    expect(nextReminderAfter(pref({ frequency: 'daily' }), from, LAGOS)?.toISOString()).toBe(
      '2026-11-13T08:00:00.000Z',
    );
    // 18:30 Lagos is still ahead today.
    expect(
      nextReminderAfter(pref({ frequency: 'daily', time: '18:30' }), from, LAGOS)?.toISOString(),
    ).toBe('2026-11-12T17:30:00.000Z');
  });

  it('starts on the start date when it is ahead, and keeps that cadence', () => {
    const weekly = pref({ frequency: 'weekly', startOn: '2026-11-16' }); // a Monday
    const first = nextReminderAfter(weekly, from, LAGOS)!;
    expect(first.toISOString()).toBe('2026-11-16T08:00:00.000Z');
    expect(nextReminderAfter(weekly, first, LAGOS)?.toISOString()).toBe('2026-11-23T08:00:00.000Z');
    const everyOther = pref({ frequency: 'every_other_day', startOn: '2026-11-12' });
    expect(nextReminderAfter(everyOther, from, LAGOS)?.toISOString()).toBe(
      '2026-11-14T08:00:00.000Z',
    );
    const fortnightly = pref({ frequency: 'fortnightly', startOn: '2026-11-12' });
    expect(nextReminderAfter(fortnightly, from, LAGOS)?.toISOString()).toBe(
      '2026-11-26T08:00:00.000Z',
    );
  });

  it('twice a week lands on the chosen weekdays only', () => {
    const p = pref({ frequency: 'twice_weekly', days: [2, 5] }); // Tuesday and Friday
    const first = nextReminderAfter(p, from, LAGOS)!;
    expect(first.toISOString()).toBe('2026-11-13T08:00:00.000Z'); // Friday
    expect(nextReminderAfter(p, first, LAGOS)?.toISOString()).toBe('2026-11-17T08:00:00.000Z'); // Tuesday
  });

  it('monthly keeps the day of the month and shortens for short months', () => {
    const p = pref({ frequency: 'monthly', startOn: '2026-10-31' });
    expect(nextReminderAfter(p, from, LAGOS)?.toISOString()).toBe('2026-11-30T08:00:00.000Z');
    const after = nextReminderAfter(p, new Date('2026-11-30T09:00:00.000Z'), LAGOS);
    expect(after?.toISOString()).toBe('2026-12-31T08:00:00.000Z');
  });

  it('stops at the end date and when reminders are off', () => {
    expect(nextReminderAfter(pref({ frequency: 'none' }), from, LAGOS)).toBeNull();
    const p = pref({ frequency: 'daily', endOn: '2026-11-13' });
    const last = nextReminderAfter(p, from, LAGOS)!;
    expect(last.toISOString()).toBe('2026-11-13T08:00:00.000Z');
    expect(nextReminderAfter(p, last, LAGOS)).toBeNull();
  });

  it('knows the last week of a window', () => {
    const p = { endOn: '2026-11-20' };
    expect(inFinalReminderWeek(p, new Date('2026-11-13T09:00:00.000Z'), LAGOS)).toBe(false);
    expect(inFinalReminderWeek(p, new Date('2026-11-14T09:00:00.000Z'), LAGOS)).toBe(true);
    expect(inFinalReminderWeek({ endOn: null }, from, LAGOS)).toBe(false);
  });

  it('places a wall-clock time correctly across zones', () => {
    expect(instantOf('2026-11-12', '09:00', LAGOS).toISOString()).toBe('2026-11-12T08:00:00.000Z');
    expect(instantOf('2026-11-12', '09:00', 'UTC').toISOString()).toBe('2026-11-12T09:00:00.000Z');
  });
});

describe('planCompletionGaps and planHasResult', () => {
  const action = (over: Partial<Parameters<typeof planCompletionGaps>[0][number]>) => ({
    id: 'a',
    action: 'Run the workshop',
    progressStatus: 'in_progress' as const,
    evidenceRecords: [],
    ...over,
  });

  it('wants every written action applied with evidence, leaves out blank and dropped ones', () => {
    expect(planCompletionGaps([action({ action: '   ' })])).toEqual([]);
    expect(planCompletionGaps([action({ progressStatus: 'no_longer_applicable' })])).toEqual([]);
    expect(planCompletionGaps([action({})])).toEqual([
      { actionId: 'a', action: 'Run the workshop', missing: ['applied', 'evidence'] },
    ]);
    expect(
      planCompletionGaps([
        action({
          progressStatus: 'applied',
          evidenceRecords: [{ description: 'Attendance sheet' }],
        }),
      ]),
    ).toEqual([]);
    expect(
      planCompletionGaps([
        action({ progressStatus: 'completed', evidenceRecords: [{ description: '' }] }),
      ]),
    ).toEqual([{ actionId: 'a', action: 'Run the workshop', missing: ['evidence'] }]);
  });

  it('separates a recorded result from completion: a measure without a result is not one', () => {
    expect(planHasResult([{ measures: [], progress: [] }])).toBe(false);
    expect(planHasResult([{ measures: [{ actualValue: '' }], progress: [] }])).toBe(false);
    expect(planHasResult([{ measures: [{ actualValue: '12' }], progress: [] }])).toBe(true);
    expect(
      planHasResult([{ measures: [], progress: [{ results: 'Three teams adopted it' }] }]),
    ).toBe(true);
  });
});
