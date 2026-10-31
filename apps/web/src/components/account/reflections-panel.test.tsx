import type { MyReflection } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReflectionsPanel } from './reflections-panel';

afterEach(() => vi.unstubAllGlobals());

const Q1 = '11111111-1111-4111-8111-111111111111';
const Q2 = '22222222-2222-4222-8222-222222222222';
const Q3 = '33333333-3333-4333-8333-333333333333';
const A1 = '44444444-4444-4444-8444-444444444444';
const A2 = '55555555-5555-4555-8555-555555555555';

const question = (
  id: string,
  prompt: string,
  extra: Partial<MyReflection['questions'][number]> = {},
) => ({
  id,
  questionKey: `${id}`,
  version: 1,
  order: 1,
  prompt,
  type: 'long_text' as const,
  required: true,
  concern: false,
  ...extra,
});
const open: MyReflection = {
  id: A1,
  date: '2026-11-12',
  title: 'Day 1 reflection',
  status: 'open',
  opensAt: '2026-11-12T16:00:00.000Z',
  closesAt: '2026-11-12T22:59:00.000Z',
  questions: [
    question(Q1, 'What is the most valuable thing you learned today?'),
    question(Q2, 'What idea could you apply in your work?'),
    question(Q3, 'Is there anything the ITTEC team should address before Day 2?', {
      required: false,
      concern: true,
    }),
  ],
  submission: null,
  canSubmit: true,
};
const upcoming: MyReflection = {
  id: A2,
  date: '2026-11-13',
  title: 'Day 2 reflection',
  status: 'upcoming',
  opensAt: '2026-11-13T16:00:00.000Z',
  closesAt: null,
  questions: [],
  submission: null,
  canSubmit: false,
};

function stub(reflections: MyReflection[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { answers: Record<string, string> };
        const saved = reflections.map((r) =>
          url.endsWith(r.id)
            ? {
                ...r,
                canSubmit: false,
                submission: { submittedAt: '2026-11-12T18:30:00.000Z', answers: body.answers },
              }
            : r,
        );
        return new Response(JSON.stringify({ reflections: saved }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ reflections }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('ReflectionsPanel', () => {
  it('flags missing required answers, reviews in a popup, submits once and shows the answers read-only', async () => {
    const calls = stub([open, upcoming]);
    const user = userEvent.setup();
    render(<ReflectionsPanel eventId="e1" timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'Day 1 reflection' });
    expect(within(card).getByText('Open')).toBeTruthy();
    const later = screen.getByRole('article', { name: 'Day 2 reflection' });
    expect(later.textContent).toMatch(/Opens later.*appear here when the reflection opens/);

    await user.click(within(card).getByRole('button', { name: 'Submit reflection' }));
    expect(within(card).getAllByRole('alert')[0]!.textContent).toMatch(
      /2 questions need an answer/,
    );
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);

    await user.type(within(card).getByLabelText(/most valuable thing/), 'The gap analysis model.');
    await user.type(within(card).getByLabelText(/idea could you apply/), 'The transfer plan.');
    await user.type(within(card).getByLabelText(/ITTEC team should address/), 'The room was cold.');
    expect(within(card).queryByRole('alert')).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Submit reflection' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your reflection?' });
    expect(
      within(dialog).getByRole('region', { name: 'Summary: Day 1 reflection' }).textContent,
    ).toMatch(
      /most valuable thing you learned today\?The gap analysis model\..*ITTEC team should address before Day 2\?The room was cold\./,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe(`/api/v1/me/events/e1/reflections/${A1}`);
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      answers: {
        [Q1]: 'The gap analysis model.',
        [Q2]: 'The transfer plan.',
        [Q3]: 'The room was cold.',
      },
    });
    const done = await screen.findByRole('dialog', { name: 'Reflection submitted' });
    expect(done.textContent).toMatch(/Thank you/);
    await user.click(within(done).getByRole('button', { name: 'Close' }));
    expect(within(card).getByText('Submitted')).toBeTruthy();
    expect(card.textContent).toMatch(/Submitted 12 Nov 2026/);
    expect(card.textContent).toMatch(/The gap analysis model\./);
    expect(within(card).queryByRole('button', { name: 'Submit reflection' })).toBeNull();
  });

  it('shows the empty state when no reflection is published', async () => {
    stub([]);
    render(<ReflectionsPanel eventId="e1" timezone="Africa/Lagos" />);
    expect(await screen.findByText(/No daily reflection is open yet/)).toBeTruthy();
  });
});
