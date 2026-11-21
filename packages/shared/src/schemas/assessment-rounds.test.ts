import { describe, expect, it } from 'vitest';

import { stageTitleOf } from './events.js';
import { nextSteps } from './next-steps.js';
import type { Journey } from './reports.js';

/** Additional rounds of an assessment (2026-11-21): how an unnamed round is called. */
describe('assessment rounds', () => {
  it('names an added round after its kind until the organisers give it a title', () => {
    expect(stageTitleOf({ stage: 'pre_conference', wave: 1 }, 'training')).toBe(
      'Pre-training assessment',
    );
    expect(stageTitleOf({ stage: 'pre_conference', wave: 2 }, 'training')).toBe(
      'Pre-training assessment (round 2)',
    );
    expect(
      stageTitleOf({ stage: 'pre_conference', wave: 2, title: 'Batch 2 baseline' }, null),
    ).toBe('Batch 2 baseline');
    // The follow-ups keep their own names.
    expect(stageTitleOf({ stage: 'follow_up', wave: 2, waveLabel: '60-day follow-up' }, null)).toBe(
      '60-day follow-up',
    );
  });

  it('lists each open round as its own step on the dashboard', () => {
    const journey: Journey = {
      event: { id: '11111111-1111-4111-8111-111111111111', name: 'E', timezone: 'Africa/Lagos' },
      attendance: { status: 'pending', dates: [] },
      assessments: [
        { stage: 'pre_conference', wave: 1, waveLabel: '', state: 'open', submittedAt: null },
        { stage: 'pre_conference', wave: 2, waveLabel: '', state: 'open', submittedAt: null },
      ],
      reflections: { available: 0, submitted: 0 },
      feedback: { sessions: 0, submitted: 0 },
      plan: null,
      transferPlanHidden: true,
      supportRequests: { state: 'not_collected' },
    };
    expect(nextSteps(journey).map((s) => [s.label, s.tab])).toEqual([
      ['Complete your pre-conference assessment', 'assessment-pre_conference-1'],
      ['Complete your pre-conference assessment (round 2)', 'assessment-pre_conference-2'],
    ]);
  });
});
