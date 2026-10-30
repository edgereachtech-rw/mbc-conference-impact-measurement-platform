import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StageSubmissions } from './stage-submissions';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('StageSubmissions', () => {
  it('shows the counts, the knowledge and statement averages, the CSV download and the non-completers with an email shortcut', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith('/summary')) {
          return json({
            summary: {
              stage: 'pre_conference',
              invited: 3,
              started: 2,
              submitted: 1,
              responseRate: 33.3,
              knowledge: {
                questions: 5,
                respondents: 1,
                averageScore: 3,
                averagePercent: 60,
              },
              statements: [
                {
                  questionId: 'q1',
                  questionKey: 'k1',
                  prompt: 'I follow up after training.',
                  responses: 1,
                  average: 4,
                },
              ],
            },
          });
        }
        if (url.endsWith('/non-completers')) {
          return json({
            delegates: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                organisation: 'Analytical Engines',
                signedUp: true,
                started: true,
              },
              {
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Grace Hopper',
                email: 'grace@example.com',
                organisation: null,
                signedUp: false,
                started: false,
              },
            ],
          });
        }
        return json({});
      }),
    );
    const user = userEvent.setup();
    render(
      <StageSubmissions eventId="e1" eventName="Summit" stage="pre_conference" readOnly={false} />,
    );
    expect(await screen.findByText('Not yet submitted (2)')).toBeTruthy();
    expect(screen.getByText('Submitted').parentElement?.textContent).toMatch(
      /1.*33\.3% of invited/,
    );
    expect(screen.getByText(/Average 3 of 5 \(60%\) across 1 submitted response/)).toBeTruthy();
    expect(screen.getByRole('table').textContent).toMatch(/I follow up after training\.14/);
    expect(
      screen.getByRole('link', { name: 'Download responses (CSV)' }).getAttribute('href'),
    ).toBe('/api/v1/events/e1/assessments/pre_conference/responses.csv');
    const list = screen.getByRole('list', { name: 'Delegates who have not submitted' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Ada Lovelace · Analytical EnginesStarted', 'Grace HopperNot signed up']);
    expect(calls.some((u) => u.endsWith('/assessments/pre_conference/non-completers'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Email these delegates' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/2 selected delegates/);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides the reminder button on an archived event and says so when everyone has submitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/summary')
          ? json({
              summary: {
                stage: 'follow_up',
                invited: 2,
                started: 2,
                submitted: 2,
                responseRate: 100,
                knowledge: null,
                statements: [],
              },
            })
          : json({ delegates: [] }),
      ),
    );
    render(<StageSubmissions eventId="e1" eventName="Summit" stage="follow_up" readOnly />);
    expect(await screen.findByText('Everyone invited has submitted.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Email these delegates/ })).toBeNull();
    expect(screen.queryByText(/Knowledge score/)).toBeNull();
  });
});
