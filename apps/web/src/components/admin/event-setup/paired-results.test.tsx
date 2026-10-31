import type { PairedResults as PairedResultsView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PairedResults } from './paired-results';

afterEach(() => vi.unstubAllGlobals());

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const Q1 = '33333333-3333-4333-8333-333333333333';

const paired: PairedResultsView = {
  stage: 'end_of_conference',
  sections: [
    {
      sectionId: S1,
      title: 'Knowledge check',
      sourceStage: 'pre_conference',
      sourceTitle: 'Baseline knowledge',
      marking: 'knowledge',
      knowledge: {
        questions: 5,
        paired: 12,
        averageBeforePercent: 48,
        averageAfterPercent: 71.5,
        changePoints: 23.5,
      },
      statements: [],
    },
    {
      sectionId: S2,
      title: 'Confidence',
      sourceStage: 'pre_conference',
      sourceTitle: 'Baseline confidence',
      marking: 'scored',
      knowledge: null,
      statements: [
        {
          questionId: Q1,
          prompt: 'Identify a relevant measure and establish a baseline?',
          paired: 10,
          averageBefore: 2.4,
          averageAfter: 3.6,
          change: 1.2,
        },
      ],
    },
  ],
};

function stub(body: PairedResultsView) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ paired: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

describe('PairedResults', () => {
  it('shows paired knowledge averages in percentage points and self-reported confidence per statement', async () => {
    stub(paired);
    render(<PairedResults eventId="e1" stage="end_of_conference" />);
    const knowledge = await screen.findByRole('region', { name: 'Knowledge check' });
    expect(knowledge.textContent).toMatch(
      /Repeats “Baseline knowledge” from the pre-conference assessment/,
    );
    expect(within(knowledge).getByText('Delegates paired').nextElementSibling?.textContent).toBe(
      '12',
    );
    expect(within(knowledge).getByText('Average before').nextElementSibling?.textContent).toBe(
      '48%',
    );
    expect(within(knowledge).getByText('Average after').nextElementSibling?.textContent).toBe(
      '71.5%',
    );
    expect(within(knowledge).getByText('Change').nextElementSibling?.textContent).toBe('+23.5 pp');
    const confidence = screen.getByRole('region', { name: 'Confidence' });
    expect(confidence.textContent).toMatch(/Self-reported confidence/);
    const row = within(confidence)
      .getByText(/Identify a relevant measure/)
      .closest('tr')!;
    expect(row.textContent).toMatch(/10.*2\.4.*3\.6.*\+1\.2/);
  });

  it('explains how to pair when the stage repeats nothing', async () => {
    stub({ stage: 'end_of_conference', sections: [] });
    render(<PairedResults eventId="e1" stage="end_of_conference" />);
    expect(await screen.findByText('Nothing to pair yet')).toBeTruthy();
    expect(screen.getByText(/Repeat a section/)).toBeTruthy();
  });
});
