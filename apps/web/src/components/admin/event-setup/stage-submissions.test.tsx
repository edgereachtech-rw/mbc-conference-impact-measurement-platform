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

const ADA = '11111111-1111-4111-8111-111111111111';
const GRACE = '22222222-2222-4222-8222-222222222222';
const DEE = '33333333-3333-4333-8333-333333333333';

describe('StageSubmissions', () => {
  it('shows the counts, averages, CSV download, each delegate’s response with its answers section by section, and the non-completers with an email shortcut', async () => {
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
              knowledge: { questions: 5, respondents: 1, averageScore: 3, averagePercent: 60 },
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
                id: ADA,
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                organisation: 'Analytical Engines',
                signedUp: true,
                started: true,
              },
              {
                id: GRACE,
                name: 'Grace Hopper',
                email: 'grace@example.com',
                organisation: null,
                signedUp: false,
                started: false,
              },
            ],
          });
        }
        if (url.endsWith('/responses')) {
          return json({
            responses: [
              {
                delegateId: DEE,
                name: 'Dee Legate',
                email: 'dee@example.com',
                organisation: 'Mentor Co',
                submittedAt: '2026-11-07T10:00:00.000Z',
                updatedAt: '2026-11-07T10:00:00.000Z',
                sectionsSubmitted: 2,
                sectionsTotal: 2,
                answered: 3,
              },
              {
                delegateId: ADA,
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                organisation: 'Analytical Engines',
                submittedAt: null,
                updatedAt: '2026-11-06T10:00:00.000Z',
                sectionsSubmitted: 1,
                sectionsTotal: 2,
                answered: 1,
              },
            ],
          });
        }
        if (url.endsWith(`/responses/${DEE}`)) {
          return json({
            response: {
              delegate: {
                id: DEE,
                name: 'Dee Legate',
                email: 'dee@example.com',
                organisation: 'Mentor Co',
              },
              submittedAt: '2026-11-07T10:00:00.000Z',
              updatedAt: '2026-11-07T10:00:00.000Z',
              sections: [
                {
                  key: 'general',
                  title: 'Questions',
                  description: null,
                  marking: 'none',
                  submittedAt: '2026-11-07T09:00:00.000Z',
                  questions: [
                    {
                      id: 'g1',
                      prompt: 'Why are you attending?',
                      type: 'long_text',
                      required: true,
                      isKnowledge: false,
                      answer: 'To learn',
                      correct: null,
                      score: null,
                    },
                  ],
                },
                {
                  key: 's1',
                  title: 'Baseline knowledge',
                  description: null,
                  marking: 'knowledge',
                  submittedAt: '2026-11-07T10:00:00.000Z',
                  questions: [
                    {
                      id: 'k1',
                      prompt: 'What does ROE assess?',
                      type: 'single_choice',
                      required: true,
                      isKnowledge: true,
                      answer: 'Certificates issued',
                      correct: false,
                      score: 0,
                    },
                    {
                      id: 'k2',
                      prompt: 'Unanswered one',
                      type: 'single_choice',
                      required: false,
                      isKnowledge: true,
                      answer: '',
                      correct: null,
                      score: null,
                    },
                  ],
                },
              ],
            },
          });
        }
        return json({});
      }),
    );
    const user = userEvent.setup();
    render(
      <StageSubmissions
        eventId="e1"
        eventName="Summit"
        stage="pre_conference"
        timezone="Africa/Lagos"
        readOnly={false}
      />,
    );
    expect(await screen.findByText('Not yet submitted (2)')).toBeTruthy();
    expect(screen.getAllByText('Submitted')[0]!.parentElement?.textContent).toMatch(
      /1.*33\.3% of invited/,
    );
    expect(screen.getByText(/Average 3 of 5 \(60%\) across 1 submitted response/)).toBeTruthy();
    expect(screen.getByText(/Rating-scale statements/).closest('table')?.textContent).toMatch(
      /I follow up after training\.14/,
    );
    expect(
      screen.getByRole('link', { name: 'Download responses (CSV)' }).getAttribute('href'),
    ).toBe('/api/v1/events/e1/assessments/pre_conference/responses.csv');

    // Responses by delegate, with section progress, and one delegate's answers in a popup.
    const table = screen.getByRole('table', { name: 'Responses by delegate' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Dee LegateMentor Co2 of 2 sections · 3 answers7 Nov 2026/),
      expect.stringMatching(/Ada LovelaceAnalytical Engines1 of 2 sections · 1 answerIn progress/),
    ]);
    await user.click(screen.getByRole('button', { name: 'View answers: Dee Legate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Answers: Dee Legate' });
    expect(dialog.textContent).toMatch(/dee@example.com · Mentor Co · submitted 7 Nov 2026/);
    const general = within(dialog).getByRole('region', { name: 'Section: Questions' });
    expect(general.textContent).toMatch(/Why are you attending\?To learn/);
    const knowledge = within(dialog).getByRole('region', { name: 'Section: Baseline knowledge' });
    expect(knowledge.textContent).toMatch(
      /What does ROE assess\?Certificates issuedWrong · 0 points/,
    );
    expect(knowledge.textContent).toMatch(/Unanswered oneNo answer/);
    expect(calls.some((u) => u.endsWith(`/responses/${DEE}`))).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Non-completers and the reminder shortcut.
    const list = screen.getByRole('list', { name: 'Delegates who have not submitted' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Ada Lovelace · Analytical EnginesStarted', 'Grace HopperNot signed up']);
    await user.click(screen.getByRole('button', { name: 'Email these delegates' }));
    const composer = await screen.findByRole('dialog');
    expect(composer.textContent).toMatch(/2 selected delegates/);
    await user.click(within(composer).getByRole('button', { name: 'Close' }));
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
          : url.endsWith('/responses')
            ? json({ responses: [] })
            : json({ delegates: [] }),
      ),
    );
    render(
      <StageSubmissions
        eventId="e1"
        eventName="Summit"
        stage="follow_up"
        timezone="Africa/Lagos"
        readOnly
      />,
    );
    expect(await screen.findByText('Everyone invited has submitted.')).toBeTruthy();
    expect(screen.getByText('No delegate has started yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Email these delegates/ })).toBeNull();
    expect(screen.queryByText(/Knowledge score/)).toBeNull();
  });
});
