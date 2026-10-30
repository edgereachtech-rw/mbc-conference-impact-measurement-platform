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
  isKnowledge: false,
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
  feedback: {},
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
  feedback: {},
  canAnswer: false,
};
const CORRECT = { correct: true, correctValue: 'b', correctLabel: 'Examine the gap' };
const scored: MyAssessment = {
  ...open,
  stage: 'follow_up',
  questions: [
    question('k', {
      type: 'single_choice',
      prompt: 'What should be done first?',
      isKnowledge: true,
      options: [
        { value: 'a', label: 'Enrol everyone' },
        { value: 'b', label: 'Examine the gap' },
        { value: 'e', label: 'I am not sure' },
      ],
    }),
    question('m', {
      type: 'multiple_choice',
      prompt: 'Which do you use?',
      options: [
        { value: 'plan', label: 'A transfer plan' },
        { value: 'none', label: 'None of the above', exclusive: true },
        { value: 'other', label: 'Other, please specify', other: true },
      ],
    }),
  ] as MyAssessment['questions'],
};
const sectioned: MyAssessment = {
  ...open,
  stage: 'during_conference',
  sections: [
    {
      id: 's1',
      title: 'About the sessions',
      description: 'Think about today.',
      order: 1,
      marking: 'none',
    },
    { id: 's2', title: 'About you', description: null, order: 2, marking: 'none' },
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

/**
 * Fakes the API: a PUT keeps the answers, records the submitted section, and marks the stage
 * submitted once every section that holds questions is in (like the server does).
 */
function stub(assessments: MyAssessment[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const submittedBy = new Map<string, Set<string>>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        const stage = url.split('/').pop()!;
        const keys = submittedBy.get(stage) ?? new Set<string>();
        if (body.submitSection) keys.add(body.submitSection);
        submittedBy.set(stage, keys);
        const saved = assessments.map((a) => {
          if (a.stage !== stage) return a;
          const all = new Set(a.questions.map((q) => q.sectionId ?? 'general'));
          const complete = [...all].every((k) => keys.has(k));
          return {
            ...a,
            canAnswer: !complete,
            response: {
              submittedAt: complete ? '2026-11-07T10:00:00.000Z' : null,
              updatedAt: 'x',
              answers: body.answers,
              submittedSections: [...keys],
            },
            // The stub scores the knowledge question "k" (correct answer "b") like the API.
            feedback:
              typeof body.answers.k === 'string'
                ? { k: { ...CORRECT, correct: body.answers.k === 'b' } }
                : {},
          };
        });
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
const puts = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter((c) => c.init?.method === 'PUT').map((c) => JSON.parse(String(c.init?.body)));

afterEach(() => vi.unstubAllGlobals());

describe('AssessmentsPanel', () => {
  it('shows open and upcoming stages, flags missing answers in a banner, saves a draft and submits after a review popup', async () => {
    const calls = stub([open, upcoming]);
    const user = userEvent.setup();
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'Pre-conference assessment' });
    expect(within(card).getByText('Open')).toBeTruthy();
    const later = screen.getByRole('article', { name: 'Follow-up assessment' });
    expect(later.textContent).toMatch(/Opens later/);

    // Nothing answered: a highlighted banner plus one message per required question, no request.
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    const alerts = within(card).getAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(alerts[0]!.textContent).toMatch(/2 questions need attention.*highlighted below/);
    expect(puts(calls)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(card).getByRole('radio', { name: '4' }));
    await user.click(within(card).getByLabelText('HR'));
    expect(within(card).queryByRole('alert')).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Save draft' }));
    expect(calls.find((c) => c.init?.method === 'PUT')?.url).toBe(
      '/api/v1/me/events/e1/assessments/pre_conference',
    );
    expect(puts(calls)[0]).toEqual({ answers: { r: 4, c: 'hr' } });
    expect((await within(card).findByRole('status')).textContent).toMatch(/Draft saved/);

    // The review popup lists every answer before anything is sent.
    await user.type(within(card).getByLabelText(/What do you want to learn/), 'Everything');
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your answers?' });
    expect(dialog.textContent).toMatch(/cannot be changed/);
    const summary = within(dialog).getByRole('region', { name: 'Summary: Questions' });
    expect(summary.textContent).toMatch(/How confident are you\?4/);
    expect(summary.textContent).toMatch(/Your role\?HR/);
    expect(summary.textContent).toMatch(/What do you want to learn\?Everything/);
    expect(puts(calls)).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls)[1]).toEqual({
      answers: { r: 4, c: 'hr', t: 'Everything' },
      submitSection: 'general',
    });
    expect(
      (await screen.findByRole('dialog', { name: 'All sections submitted' })).textContent,
    ).toMatch(/Thank you/);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(within(card).getByText('Submitted')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Submit answers' })).toBeNull();
  });

  it('submits sections one at a time, locks each, and completes the stage with the last one', async () => {
    const calls = stub([sectioned]);
    const user = userEvent.setup();
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'During-conference assessment' });
    expect(within(card).getByText('Section 1 of 2')).toBeTruthy();
    expect(within(card).getByText('0 of 2 sections submitted')).toBeTruthy();
    expect(within(card).getByRole('region', { name: 'About the sessions' })).toBeTruthy();
    expect(within(card).queryByText(/Are you a manager?/)).toBeNull();

    // Move on without answering, submit the second section first.
    await user.click(within(card).getByRole('button', { name: 'Next section' }));
    expect(within(card).getByText('Section 2 of 2')).toBeTruthy();
    await user.click(within(card).getByLabelText('Yes'));
    await user.click(within(card).getByRole('button', { name: 'Submit section' }));
    const review = await screen.findByRole('dialog', { name: 'Submit this section?' });
    expect(within(review).getByRole('region', { name: 'Summary: About you' }).textContent).toMatch(
      /Are you a manager\?Yes/,
    );
    expect(
      within(review).queryByRole('region', { name: 'Summary: About the sessions' }),
    ).toBeNull();
    await user.click(within(review).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls)[0]).toEqual({ answers: { d: true }, submitSection: 's2' });
    const done = await screen.findByRole('dialog', { name: 'Section submitted' });
    expect(done.textContent).toMatch(/1 more section to submit/);
    await user.click(within(done).getByRole('button', { name: 'Continue' }));

    // Back on the first section, which is still open; the submitted one is locked.
    expect(within(card).getByText('Section 1 of 2')).toBeTruthy();
    expect(within(card).getByText('1 of 2 sections submitted')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: '✓ About you' }));
    expect(within(card).getByLabelText('Yes')).toHaveProperty('disabled', true);
    expect(within(card).getByText('This section is submitted and cannot be changed.')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Previous section' }));

    // A required answer missing in this section is flagged in the banner, nothing is sent.
    await user.click(within(card).getByRole('button', { name: 'Submit section' }));
    expect(within(card).getAllByRole('alert')[0]!.textContent).toMatch(
      /One question needs attention/,
    );
    expect(puts(calls)).toHaveLength(1);
    await user.click(within(card).getAllByLabelText('Yes')[0]!);
    await user.click(within(card).getByRole('button', { name: 'Submit section' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Submit this section?' })).getByRole(
        'button',
        { name: 'Submit now' },
      ),
    );
    expect(puts(calls)[1]).toEqual({ answers: { d: true, a: true }, submitSection: 's1' });
    const all = await screen.findByRole('dialog', { name: 'All sections submitted' });
    // The final summary shows every section with its title.
    expect(within(all).getByRole('region', { name: 'Summary: About the sessions' })).toBeTruthy();
    expect(within(all).getByRole('region', { name: 'Summary: About you' })).toBeTruthy();
    await user.click(within(all).getByRole('button', { name: 'Close' }));
    expect(within(card).getByText('Submitted')).toBeTruthy();
    // Read-only afterwards, every section visible under its title.
    expect(within(card).getByRole('region', { name: 'About the sessions' })).toBeTruthy();
    expect(within(card).getByRole('region', { name: 'About you' })).toBeTruthy();
  });

  it('saves a knowledge answer at once, shows the result and locks it, and handles exclusive and "Other" options', async () => {
    const calls = stub([scored]);
    const user = userEvent.setup();
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'Follow-up assessment' });
    expect(card.textContent).toMatch(/saved as soon as you choose it/);

    await user.click(within(card).getByLabelText('Enrol everyone'));
    expect(puts(calls)[0]).toEqual({ answers: { k: 'a' } });
    expect((await within(card).findByRole('status')).textContent).toMatch(
      /Not quite. The correct answer is: Examine the gap/,
    );
    expect(within(card).getByLabelText('Enrol everyone')).toHaveProperty('disabled', true);
    expect(within(card).getByLabelText(/Examine the gap/)).toHaveProperty('disabled', true);

    // Exclusive options stand alone; "Other" needs its text before submitting.
    await user.click(within(card).getByLabelText('A transfer plan'));
    await user.click(within(card).getByLabelText('None of the above'));
    expect(within(card).getByLabelText('A transfer plan')).toHaveProperty('checked', false);
    await user.click(within(card).getByLabelText('Other, please specify'));
    expect(within(card).getByLabelText('None of the above')).toHaveProperty('checked', false);
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    expect(within(card).getAllByRole('alert').at(-1)!.textContent).toMatch(/Please specify/);
    await user.type(within(card).getByLabelText('Please specify'), 'A coaching log');
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your answers?' });
    expect(dialog.textContent).toMatch(/Other, please specify: A coaching log/);
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls).at(-1)).toEqual({
      answers: { k: 'a', m: { selected: ['other'], other: 'A coaching log' } },
      submitSection: 'general',
    });
  });

  it('shows the empty state when nothing is open', async () => {
    stub([]);
    render(<AssessmentsPanel eventId="e1" timezone="Africa/Lagos" />);
    expect(await screen.findByText('No assessments open yet')).toBeTruthy();
  });
});
