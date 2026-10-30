import type { MyAssessment } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssessmentsPanel } from './assessments-panel';

const question = (id: string, extra: Record<string, unknown>) => ({
  id,
  questionKey: `${id}-k`,
  version: 1,
  order: 1,
  sectionId: null,
  prompt: `Q ${id}`,
  helpText: null,
  required: true,
  area: null,
  options: null,
  scale: null,
  responseCount: 0,
  ...extra,
});
const open: MyAssessment = {
  stage: 'pre_conference',
  status: 'open',
  opensAt: '2026-11-01T08:00:00.000Z',
  closesAt: '2026-11-11T22:59:00.000Z',
  sections: [],
  questions: [
    question('r', {
      type: 'rating',
      prompt: 'How confident are you?',
      scale: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very' },
    }),
    question('c', {
      type: 'single_choice',
      prompt: 'Your role?',
      options: [
        { value: 'hr', label: 'HR' },
        { value: 'ld', label: 'L&D' },
      ],
    }),
    question('t', { type: 'long_text', prompt: 'What do you want to learn?', required: false }),
  ] as MyAssessment['questions'],
  response: null,
  canAnswer: true,
};
const upcoming: MyAssessment = {
  stage: 'follow_up',
  status: 'upcoming',
  opensAt: '2026-12-13T08:00:00.000Z',
  closesAt: null,
  sections: [],
  questions: [],
  response: null,
  canAnswer: false,
};
const sectioned: MyAssessment = {
  ...open,
  stage: 'during_conference',
  sections: [
    { id: 's1', title: 'About the sessions', description: 'Think about today.', order: 1 },
    { id: 's2', title: 'About you', description: null, order: 2 },
  ],
  questions: [
    question('a', { type: 'yes_no', prompt: 'Did you attend the keynote?', sectionId: 's1' }),
    question('b', {
      type: 'yes_no',
      prompt: 'Did you enjoy it?',
      sectionId: 's1',
      required: false,
    }),
    question('d', { type: 'yes_no', prompt: 'Are you a manager?', sectionId: 's2' }),
  ] as MyAssessment['questions'],
};

function stub(assessments: MyAssessment[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        const stage = url.split('/').pop();
        const saved = assessments.map((a) =>
          a.stage === stage
            ? {
                ...a,
                canAnswer: !body.submit,
                response: {
                  submittedAt: body.submit ? '2026-11-07T10:00:00.000Z' : null,
                  updatedAt: 'x',
                  answers: body.answers,
                },
              }
            : a,
        );
        return new Response(JSON.stringify({ assessments: saved }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ assessments }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('AssessmentsPanel', () => {
  it('shows open and upcoming stages, validates before submitting, saves a draft and submits after confirmation', async () => {
    const calls = stub([open, upcoming]);
    const user = userEvent.setup();
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'Pre-conference assessment' });
    expect(within(card).getByText('Open')).toBeTruthy();
    const later = screen.getByRole('article', { name: 'Follow-up assessment' });
    expect(later.textContent).toMatch(/Opens later/);

    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    expect(within(card).getAllByRole('alert')).toHaveLength(2);
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);

    await user.click(within(card).getByRole('radio', { name: '4' }));
    await user.click(within(card).getByLabelText('HR'));
    await user.click(within(card).getByRole('button', { name: 'Save draft' }));
    const draft = calls.find((c) => c.init?.method === 'PUT');
    expect(draft?.url).toBe('/api/v1/me/events/e1/assessments/pre_conference');
    expect(JSON.parse(String(draft?.init?.body))).toEqual({
      answers: { r: 4, c: 'hr' },
      submit: false,
    });
    expect((await within(card).findByRole('status')).textContent).toMatch(/Draft saved/);

    await user.type(within(card).getByLabelText(/What do you want to learn/), 'Everything');
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    expect(card.textContent).toMatch(/Submit your answers\? You cannot change them afterwards/);
    await user.click(within(card).getByRole('button', { name: 'Submit now' }));
    const submit = calls.filter((c) => c.init?.method === 'PUT')[1];
    expect(JSON.parse(String(submit?.init?.body))).toEqual({
      answers: { r: 4, c: 'hr', t: 'Everything' },
      submit: true,
    });
    expect((await within(card).findByRole('status')).textContent).toMatch(/submitted/i);
    expect(within(card).queryByRole('button', { name: 'Submit answers' })).toBeNull();
  });

  it('walks through sections one step at a time and jumps back to the step with a missing answer', async () => {
    const calls = stub([sectioned]);
    const user = userEvent.setup();
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'During-conference assessment' });
    expect(within(card).getByText('Section 1 of 2')).toBeTruthy();
    expect(within(card).getByRole('region', { name: 'About the sessions' })).toBeTruthy();
    expect(within(card).getByText('Think about today.')).toBeTruthy();
    expect(within(card).queryByText(/Are you a manager?/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Submit answers' })).toBeNull();

    // Skip the first section's required question; the final submit sends us back to it.
    await user.click(within(card).getByRole('button', { name: 'Next section' }));
    expect(within(card).getByText('Section 2 of 2')).toBeTruthy();
    expect(within(card).getByText(/Are you a manager?/)).toBeTruthy();
    await user.click(within(card).getByLabelText('Yes'));
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    expect(within(card).getByText('Section 1 of 2')).toBeTruthy();
    expect(within(card).getByRole('alert').textContent).toMatch(/needs an answer/);

    await user.click(within(card).getAllByLabelText('Yes')[0]!);
    await user.click(within(card).getByRole('button', { name: 'About you' }));
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    await user.click(within(card).getByRole('button', { name: 'Submit now' }));
    const submit = calls.find((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(submit?.init?.body))).toEqual({
      answers: { d: true, a: true },
      submit: true,
    });
  });

  it('shows the empty state when nothing is open', async () => {
    stub([]);
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    expect(await screen.findByText('No assessments open yet')).toBeTruthy();
  });
});
