import type { EventDetail, ReflectionConcern, ReflectionDateView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReflectionsManager } from './reflections-manager';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const D1 = '44444444-4444-4444-8444-444444444444';
const D2 = '55555555-5555-4555-8555-555555555555';
const A1 = '66666666-6666-4666-8666-666666666666';
const Q1 = '11111111-1111-4111-8111-111111111111';
const Q3 = '33333333-3333-4333-8333-333333333333';
const DEE = '77777777-7777-4777-8777-777777777777';

const event: EventDetail = {
  id: 'e1',
  code: 'summit',
  slug: 'summit',
  name: 'Summit',
  description: 'd',
  eventType: 'summit',
  organiser: 'M.Bryan',
  format: 'hybrid',
  timezone: 'Africa/Lagos',
  theme: null,
  location: null,
  website: null,
  imageUrl: null,
  additionalInfo: null,
  status: 'active',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  dates: [
    { id: D1, date: '2026-11-12' },
    { id: D2, date: '2026-11-13' },
  ],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};

const activity: ReflectionDateView['activity'] = {
  id: A1,
  eventDateId: D1,
  date: '2026-11-12',
  title: 'Day 1 reflection',
  status: 'draft',
  opensAt: null,
  closesAt: null,
  publishedAt: null,
  closedAt: null,
  questions: [
    {
      id: Q1,
      questionKey: Q1,
      version: 1,
      order: 1,
      prompt: 'What is the most valuable thing you learned today?',
      type: 'long_text',
      required: true,
      concern: false,
      responseCount: 0,
    },
    {
      id: Q3,
      questionKey: Q3,
      version: 1,
      order: 2,
      prompt: 'Anything to address before Day 2?',
      type: 'long_text',
      required: false,
      concern: true,
      responseCount: 1,
    },
  ],
  submitted: 1,
  registered: 3,
};
const concerns: ReflectionConcern[] = [
  {
    activityId: A1,
    activityTitle: 'Day 1 reflection',
    date: '2026-11-12',
    questionId: Q3,
    prompt: 'Anything to address before Day 2?',
    delegate: { id: DEE, name: 'Dee Legate', email: 'dee@example.com', organisation: 'Mentor Co' },
    value: 'The room was too cold.',
    submittedAt: '2026-11-12T18:30:00.000Z',
  },
];

describe('ReflectionsManager', () => {
  it('lists concerns first, one card per date, enables a date, adds a concern question, publishes and shows responses', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let dates: ReflectionDateView[] = [
      { date: { id: D1, date: '2026-11-12' }, activity },
      { date: { id: D2, date: '2026-11-13' }, activity: null },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/reflections') && !init?.method) return json({ dates, concerns });
        if (url.endsWith(`/reflections/dates/${D2}`)) {
          dates = [
            dates[0]!,
            {
              date: { id: D2, date: '2026-11-13' },
              activity: {
                ...activity,
                id: 'a2',
                eventDateId: D2,
                date: '2026-11-13',
                title: 'Reflection for 13 Nov 2026',
                questions: [],
                submitted: 0,
              },
            },
          ];
          return json({ activity: dates[1]!.activity }, 201);
        }
        if (url.endsWith(`/reflections/${A1}/questions`))
          return json({ question: { id: 'q9' } }, 201);
        if (url.endsWith(`/reflections/${A1}/publish`)) {
          dates = [{ ...dates[0]!, activity: { ...activity, status: 'published' } }, dates[1]!];
          return json({ activity: dates[0]!.activity });
        }
        if (url.endsWith(`/reflections/${A1}/responses`)) {
          return json({
            activity,
            rows: [
              {
                delegate: concerns[0]!.delegate,
                submittedAt: '2026-11-12T18:30:00.000Z',
                answers: { [Q1]: 'The gap analysis model.', [Q3]: 'The room was too cold.' },
              },
            ],
            notSubmitted: [
              { id: 'x1', name: 'Ada Other', email: 'ada@example.com', organisation: null },
              { id: 'x2', name: 'Bea Third', email: 'bea@example.com', organisation: null },
            ],
          });
        }
        return json({});
      }),
    );
    const user = userEvent.setup();
    render(<ReflectionsManager event={event} />);

    const list = await screen.findByRole('list', { name: 'Participant concerns' });
    expect(list.textContent).toMatch(
      /The room was too cold\..*Dee Legate · Mentor Co · 12 Nov 2026 · Day 1 reflection/,
    );

    const day1 = screen.getByRole('article', { name: 'Reflection for 12 Nov 2026' });
    expect(within(day1).getByText('Draft')).toBeTruthy();
    expect(
      within(day1).getByRole('list', { name: 'Questions for 12 Nov 2026' }).textContent,
    ).toMatch(
      /1\. What is the most valuable.*Required.*2\. Anything to address.*Optional.*Concern.*1 answers/,
    );
    expect(within(day1).getByText(/1 of 3 submitted/)).toBeTruthy();
    const day2 = screen.getByRole('article', { name: 'Reflection for 13 Nov 2026' });
    expect(within(day2).getByText('Disabled')).toBeTruthy();

    // Enabling a date creates its draft.
    await user.click(within(day2).getByRole('button', { name: 'Enable a daily reflection' }));
    expect(
      calls.some((c) => c.init?.method === 'POST' && c.url.endsWith(`/reflections/dates/${D2}`)),
    ).toBe(true);
    expect((await screen.findByRole('status')).textContent).toMatch(/enabled as a draft/);

    // A new question flagged as a concern.
    await user.click(within(day1).getByRole('button', { name: 'Add question' }));
    const dialog = await screen.findByRole('dialog', { name: 'New question' });
    await user.click(within(dialog).getByRole('button', { name: 'Add question' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Write the question/);
    await user.type(
      within(dialog).getByLabelText('Question'),
      'What question remains on your mind?',
    );
    await user.selectOptions(within(dialog).getByLabelText('Response type'), 'short_text');
    await user.click(within(dialog).getByLabelText('Required'));
    await user.click(within(dialog).getByLabelText(/participant concerns/));
    await user.click(within(dialog).getByRole('button', { name: 'Add question' }));
    const added = calls.find(
      (c) => c.init?.method === 'POST' && c.url.endsWith(`/reflections/${A1}/questions`),
    );
    expect(JSON.parse(String(added?.init?.body))).toEqual({
      prompt: 'What question remains on your mind?',
      type: 'short_text',
      required: false,
      concern: true,
    });

    // Preview, then publish.
    await user.click(within(day1).getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('dialog', { name: 'Preview: Day 1 reflection' });
    expect(preview.textContent).toMatch(
      /1\. What is the most valuable thing you learned today\?\s*\*/,
    );
    await user.click(within(preview).getByRole('button', { name: 'Close' }));
    await user.click(within(day1).getByRole('button', { name: 'Publish' }));
    expect(
      calls.some((c) => c.init?.method === 'POST' && c.url.endsWith(`/reflections/${A1}/publish`)),
    ).toBe(true);
    expect(
      await within(screen.getByRole('article', { name: 'Reflection for 12 Nov 2026' })).findByText(
        'Published',
      ),
    ).toBeTruthy();

    // Responses by delegate and by question, plus who has not submitted.
    await user.click(screen.getByRole('button', { name: 'Responses (1)' }));
    const responses = await screen.findByRole('dialog', { name: 'Responses: Day 1 reflection' });
    const dee = await within(responses).findByRole('region', { name: 'Response: Dee Legate' });
    expect(dee.textContent).toMatch(
      /What is the most valuable thing you learned today\?The gap analysis model\./,
    );
    expect(dee.textContent).toMatch(
      /Anything to address before Day 2\? · concernThe room was too cold\./,
    );
    expect(
      within(responses).getByRole('region', { name: 'Not yet submitted' }).textContent,
    ).toMatch(/\(2\)Ada Other, Bea Third/);
    await user.click(within(responses).getByRole('tab', { name: 'By question' }));
    await user.selectOptions(within(responses).getByLabelText('Question'), Q3);
    expect(
      within(responses).getByRole('list', { name: 'Answers: Anything to address before Day 2?' })
        .textContent,
    ).toMatch(/The room was too cold\.Dee Legate/);
  });
});
