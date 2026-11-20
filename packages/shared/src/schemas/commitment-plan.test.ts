import { describe, expect, it } from 'vitest';

import { nextSteps } from './next-steps.js';
import type { Journey } from './reports.js';
import {
  checklistTemplateSchema,
  commitmentSaveSchema,
  DEFAULT_CHECKLIST_TEMPLATE,
  nextReminderAfter,
  templateActions,
} from './transfer-plans.js';

/** The checklist-and-commitment plan mode (2026-11-20). */

const journey = (over: Partial<Journey> = {}): Journey => ({
  event: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Programme',
    timezone: 'Africa/Lagos',
  },
  attendance: { status: 'pending', dates: [] },
  assessments: [],
  reflections: { available: 0, submitted: 0 },
  feedback: { sessions: 0, submitted: 0 },
  plan: null,
  transferPlanHidden: false,
  supportRequests: { state: 'not_collected' },
  ...over,
});

describe('the checklist template', () => {
  it('starts from a complete default with eleven actions in four groups', () => {
    expect(checklistTemplateSchema.safeParse(DEFAULT_CHECKLIST_TEMPLATE).success).toBe(true);
    const actions = templateActions(DEFAULT_CHECKLIST_TEMPLATE);
    expect(actions).toHaveLength(11);
    expect(new Set(actions.map((a) => a.key)).size).toBe(11);
    expect(actions[0]).toMatchObject({
      group: 'Before training, if you are considering a request',
    });
  });

  it('refuses a commitment to an action that was not ticked, and a form with nothing ticked', () => {
    const valid = {
      version: 1,
      trainingName: 'Coaching skills',
      ticked: ['explain_why', 'protect_time'],
      commitmentKey: 'protect_time',
      what: 'Block the two afternoons',
      byOn: '2026-12-15',
      evidence: 'The calendar entries',
      reminderOn: null,
    };
    expect(commitmentSaveSchema.safeParse(valid).success).toBe(true);
    expect(commitmentSaveSchema.safeParse({ ...valid, commitmentKey: 'meet_agree' }).success).toBe(
      false,
    );
    expect(commitmentSaveSchema.safeParse({ ...valid, ticked: [] }).success).toBe(false);
  });
});

describe('a reminder once, on a chosen date', () => {
  const once = {
    frequency: 'once' as const,
    startOn: '2026-12-10',
    endOn: '2026-12-10',
    time: '09:00',
    days: [],
  };
  it('goes out on that day at the chosen time in the event zone, and never again', () => {
    expect(nextReminderAfter(once, new Date('2026-12-01T10:00:00.000Z'), 'Africa/Lagos')).toEqual(
      new Date('2026-12-10T08:00:00.000Z'),
    );
    expect(
      nextReminderAfter(once, new Date('2026-12-10T08:05:00.000Z'), 'Africa/Lagos'),
    ).toBeNull();
  });
});

describe('the plan step on the dashboard', () => {
  const evaluation = {
    stage: 'end_of_conference' as const,
    wave: 1,
    waveLabel: '',
    state: 'open' as const,
    submittedAt: null,
  };
  it('comes before the closing assessments when the organisers place it there, named as the form', () => {
    const steps = nextSteps(
      journey({
        assessments: [evaluation],
        transferPlanMode: 'commitment',
        transferPlanPosition: 'before_closing',
        transferPlanTitle: 'My Training Checklist and Commitment',
      }),
    );
    expect(steps.map((s) => s.label)).toEqual([
      'Complete your My Training Checklist and Commitment',
      'Complete your end-of-conference evaluation',
    ]);
  });
  it('stays last otherwise', () => {
    expect(nextSteps(journey({ assessments: [evaluation] })).map((s) => s.key)).toEqual([
      'assessment:end_of_conference:1',
      'transfer-plan',
    ]);
  });
});
