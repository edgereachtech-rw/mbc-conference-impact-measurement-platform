import { describe, expect, it } from 'vitest';

import { nextSteps } from './next-steps.js';
import type { Journey } from './reports.js';

/**
 * What the dashboard puts in front of a delegate (task of 2026-11-03). The rule that matters is
 * that only what they can act on now appears: a stage that has not opened, a day that has not
 * happened and a session they did not attend are all somebody else's business.
 */

const journey = (over: Partial<Journey> = {}): Journey => ({
  event: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'ITTEC 2026',
    timezone: 'Africa/Lagos',
  },
  attendance: { status: 'pending', dates: [] },
  assessments: [],
  reflections: { available: 0, submitted: 0 },
  feedback: { sessions: 0, submitted: 0 },
  plan: null,
  supportRequests: { state: 'not_collected' },
  ...over,
});

describe('nextSteps', () => {
  it('asks for an open assessment and says when one is only half done', () => {
    const steps = nextSteps(
      journey({
        assessments: [
          { stage: 'pre_conference', wave: 1, waveLabel: '', state: 'open', submittedAt: null },
          { stage: 'during_conference', wave: 1, waveLabel: '', state: 'draft', submittedAt: null },
        ],
      }),
    );
    expect(steps.map((s) => s.label)).toEqual([
      'Complete your pre-conference assessment',
      'Finish your during-conference assessment',
      // No plan yet, so starting one is always the last thing on the list.
      'Start your transfer plan',
    ]);
    expect(steps[1]!.started).toBe(true);
    expect(steps[0]!.tab).toBe('assessments');
  });

  it('names each follow-up wave, and keeps them apart', () => {
    const steps = nextSteps(
      journey({
        assessments: [
          {
            stage: 'follow_up',
            wave: 1,
            waveLabel: '30-day follow-up',
            state: 'draft',
            submittedAt: null,
          },
          {
            stage: 'follow_up',
            wave: 2,
            waveLabel: '60-day follow-up',
            state: 'open',
            submittedAt: null,
          },
        ],
      }),
    );
    expect(steps.map((x) => x.label)).toEqual([
      'Finish your 30-day follow-up',
      'Complete your 60-day follow-up',
      'Start your transfer plan',
    ]);
    // Distinct keys: two open waves are two things to do, not one row drawn twice.
    expect(new Set(steps.map((x) => x.key)).size).toBe(steps.length);
  });

  it('leaves out a stage that is not the delegate to act on', () => {
    const steps = nextSteps(
      journey({
        assessments: [
          {
            stage: 'pre_conference',
            wave: 1,
            waveLabel: '',
            state: 'submitted',
            submittedAt: '2026-11-01T09:00:00.000Z',
          },
          {
            stage: 'during_conference',
            wave: 1,
            waveLabel: '',
            state: 'not_yet_open',
            submittedAt: null,
          },
          {
            stage: 'end_of_conference',
            wave: 1,
            waveLabel: '',
            state: 'not_configured',
            submittedAt: null,
          },
          { stage: 'follow_up', wave: 1, waveLabel: '', state: 'closed', submittedAt: null },
        ],
        plan: {
          status: 'submitted',
          actions: 3,
          priority: 'Brief the team',
          applied: 1,
          measures: 1,
          withResult: 0,
          evidence: 0,
          reminder: 'monthly',
          nextReminderAt: null,
          updatedAt: '2026-11-14T09:00:00.000Z',
        },
      }),
    );
    expect(steps).toEqual([]);
  });

  it('asks for a check-in only while a date is open and nothing is recorded', () => {
    const open = nextSteps(
      journey({
        attendance: {
          status: 'pending',
          dates: [
            { date: '2026-11-12', status: 'attended', closed: true },
            { date: '2026-11-13', status: 'not_checked_in', closed: false },
          ],
        },
      }),
    );
    expect(open[0]).toMatchObject({ key: 'attendance:2026-11-13', tab: 'attendance' });

    const closed = nextSteps(
      journey({
        attendance: {
          status: 'absent',
          dates: [{ date: '2026-11-13', status: 'not_checked_in', closed: true }],
        },
      }),
    );
    // The organisers closed the date: checking in is no longer something the delegate can do.
    expect(closed.some((s) => s.tab === 'attendance')).toBe(false);
  });

  it('counts what is left for reflections and feedback, and reads as singular for one', () => {
    const steps = nextSteps(
      journey({
        reflections: { available: 2, submitted: 1 },
        feedback: { sessions: 4, submitted: 1 },
      }),
    );
    expect(steps.map((s) => s.label)).toContain('Add your daily reflection');
    expect(steps.map((s) => s.label)).toContain('Give feedback on 3 sessions');

    const several = nextSteps(journey({ reflections: { available: 3, submitted: 0 } }));
    expect(several.map((s) => s.label)).toContain('Add 3 daily reflections');
    const one = nextSteps(journey({ feedback: { sessions: 1, submitted: 0 } }));
    expect(one.map((s) => s.label)).toContain('Give feedback on 1 session');
  });

  it('says finish rather than start once a plan has an action', () => {
    const plan = {
      status: 'draft' as const,
      actions: 2,
      priority: null,
      applied: 0,
      measures: 0,
      withResult: 0,
      evidence: 0,
      reminder: 'none' as const,
      nextReminderAt: null,
      updatedAt: '2026-11-12T09:00:00.000Z',
    };
    expect(nextSteps(journey({ plan }))[0]).toMatchObject({
      label: 'Finish your transfer plan',
      started: true,
      tab: 'transfer-plan',
    });
    expect(nextSteps(journey({ plan: { ...plan, actions: 0 } }))[0]).toMatchObject({
      label: 'Start your transfer plan',
      started: false,
    });
  });

  it('runs in journey order: assessments, attendance, reflections, feedback, plan', () => {
    const steps = nextSteps(
      journey({
        assessments: [
          { stage: 'pre_conference', wave: 1, waveLabel: '', state: 'open', submittedAt: null },
        ],
        attendance: {
          status: 'pending',
          dates: [{ date: '2026-11-12', status: 'not_checked_in', closed: false }],
        },
        reflections: { available: 1, submitted: 0 },
        feedback: { sessions: 1, submitted: 0 },
      }),
    );
    expect(steps.map((s) => s.tab)).toEqual([
      'assessments',
      'attendance',
      'reflections',
      'feedback',
      'transfer-plan',
    ]);
  });
});
