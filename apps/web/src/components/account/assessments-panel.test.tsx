import type { AssessmentStage, MyAssessment } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssessmentsPanel, useMyAssessments } from './assessments-panel';

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
  sourceQuestionKey: null,
  builtin: null,
  referenceQuestionKey: null,
  showReferenceAnswer: false,
  visibleWhen: 'always',
  allowDecline: false,
  ...extra,
});
const noContext: MyAssessment['context'] = {
  references: [],
  referenceAnswers: {},
  planStatus: null,
  plan: null,
};
const open: MyAssessment = {
  stage: 'pre_conference',
  wave: 1,
  waveLabel: '',
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
  context: noContext,
};
const upcoming: MyAssessment = {
  stage: 'follow_up',
  wave: 1,
  waveLabel: '',
  status: 'upcoming',
  opensAt: '2026-12-13T08:00:00.000Z',
  closesAt: null,
  sections: [],
  questions: [],
  response: null,
  feedback: {},
  canAnswer: false,
  context: noContext,
};
const CORRECT = { correct: true, correctValue: 'b', correctLabel: 'Examine the gap' };
const scored: MyAssessment = {
  ...open,
  stage: 'follow_up',
  wave: 1,
  waveLabel: '',
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
  wave: 1,
  waveLabel: '',
  sections: [
    {
      id: 's1',
      title: 'About the sessions',
      description: 'Think about today.',
      highlightDescription: false,
      order: 1,
      marking: 'none',
      audience: 'all',
      sourceSectionId: null,
      sourceLabel: null,
    },
    {
      id: 's2',
      title: 'About you',
      description: null,
      highlightDescription: false,
      order: 2,
      marking: 'scored',
      audience: 'all',
      sourceSectionId: null,
      sourceLabel: null,
    },
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
        const stage = url.split('?')[0]!.split('/').pop()!;
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
              // The stub marks the scored section s2 as the API would: 3 of 4 points.
              sectionMarks: keys.has('s2') ? { s2: { scored: 3, max: 4, percent: 75 } } : {},
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

/** Loads the list as the event page does and shows the one assessment under test. */
function Harness({ stage, wave = 1 }: { stage: AssessmentStage; wave?: number }) {
  const { state, retry, update } = useMyAssessments('e1');
  return (
    <AssessmentsPanel
      eventId="e1"
      timezone="Africa/Lagos"
      stage={stage}
      wave={wave}
      state={state}
      onUpdated={update}
      onRetry={retry}
    />
  );
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PLAN_ACTION = '99999999-9999-4999-8999-999999999999';
const PLAN_ID = '88888888-8888-4888-8888-888888888888';
/** A 30-day follow-up with a plan whose action has no status in this wave yet. */
const followUpWithPlan: MyAssessment = {
  ...open,
  stage: 'follow_up',
  wave: 1,
  waveLabel: '30-day follow-up',
  questions: [
    question('t', { type: 'long_text', prompt: 'What have you done so far?', required: false }),
  ] as MyAssessment['questions'],
  context: {
    ...noContext,
    plan: {
      id: PLAN_ID,
      status: 'submitted',
      actions: [
        {
          id: PLAN_ACTION,
          order: 1,
          title: 'Faster handovers',
          action: 'Brief stakeholders',
          isPriority: true,
          progressStatus: 'not_started',
          targetDate: null,
          followUps: [],
        },
      ],
    },
  },
};

describe('AssessmentsPanel', () => {
  it('asks where each planned action stands before the follow-up questions, with the detail the status needs', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as {
            actions: Array<{ status: 'applied'; note: string; occurredOn: string }>;
          };
          calls.push({ url, body });
          const recorded = {
            ...followUpWithPlan,
            context: {
              ...followUpWithPlan.context,
              plan: {
                ...followUpWithPlan.context.plan!,
                actions: followUpWithPlan.context.plan!.actions.map((a) => ({
                  ...a,
                  progressStatus: body.actions[0]!.status,
                  followUps: [
                    {
                      wave: 1,
                      waveLabel: '30-day follow-up',
                      status: body.actions[0]!.status,
                      note: body.actions[0]!.note,
                      occurredOn: body.actions[0]!.occurredOn,
                      recordedAt: '2026-12-15T09:00:00.000Z',
                    },
                  ],
                })),
              },
            },
          };
          return json({ assessments: [recorded] });
        }
        return json({ assessments: [followUpWithPlan] });
      }),
    );
    const user = userEvent.setup();
    render(<Harness stage="follow_up" />);
    const card = await screen.findByRole('article', { name: '30-day follow-up' });
    // The questions wait for the statuses.
    expect(within(card).queryByLabelText('What have you done so far?')).toBeNull();
    expect(within(card).getByText(/questions follow once you have saved/)).toBeTruthy();
    const section = within(card).getByRole('region', { name: 'Where your actions stand' });
    const form = within(section).getByRole('group', { name: 'Faster handovers' });
    await user.selectOptions(
      within(form).getByLabelText('Where does this action stand?'),
      'applied',
    );
    expect(form.textContent).toMatch(/used the learning or practice at least once/);
    await user.click(within(section).getByRole('button', { name: 'Save where my actions stand' }));
    expect(within(section).getByRole('alert').textContent).toMatch(/Give an example/);
    expect(calls).toHaveLength(0);
    await user.type(
      within(form).getByLabelText(/^An example of applying it/),
      'Used it in the Q1 programme',
    );
    await user.type(within(form).getByLabelText(/^When did this application occur/), '2026-12-10');
    await user.click(within(section).getByRole('button', { name: 'Save where my actions stand' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(
      /\/me\/events\/e1\/assessments\/follow_up\/plan-progress\?wave=1$/,
    );
    expect(calls[0]!.body).toEqual({
      planId: PLAN_ID,
      actions: [
        {
          actionId: PLAN_ACTION,
          status: 'applied',
          note: 'Used it in the Q1 programme',
          occurredOn: '2026-12-10',
        },
      ],
    });
    // Saved: the summary shows, and the questions open.
    const summary = await within(card).findByRole('list', { name: 'Statuses in this follow-up' });
    expect(summary.textContent).toMatch(/Applied/);
    expect(summary.textContent).toMatch(/Used it in the Q1 programme/);
    expect(within(card).getByLabelText('What have you done so far?')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('shows one stage per tab, flags missing answers in a banner, saves a draft and submits after a review popup', async () => {
    const calls = stub([open, upcoming]);
    const user = userEvent.setup();
    // An upcoming stage on its own tab says so; no second row of stage tabs exists any more.
    const later = render(<Harness stage="follow_up" />);
    expect(
      (await screen.findByRole('article', { name: 'Follow-up assessment' })).textContent,
    ).toMatch(/Opens later/);
    expect(screen.queryByRole('tablist')).toBeNull();
    later.unmount();
    render(<Harness stage="pre_conference" />);
    const card = await screen.findByRole('article', { name: 'Pre-conference assessment' });
    expect(within(card).getByText('Open')).toBeTruthy();

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
      '/api/v1/me/events/e1/assessments/pre_conference?wave=1',
    );
    expect(puts(calls)[0]).toEqual({ answers: { r: 4, c: 'hr' } });
    expect((await within(card).findByRole('status')).textContent).toMatch(/Draft saved/);

    // The review popup lists every answer before anything is sent.
    await user.type(within(card).getByLabelText(/What do you want to learn/), 'Everything');
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your responses?' });
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
    const finished = await screen.findByRole('dialog', { name: 'All sections submitted' });
    expect(finished.textContent).toMatch(/Thank you/);
    expect(
      within(finished).getByRole('link', { name: 'Back to my dashboard' }).getAttribute('href'),
    ).toBe('/account');
    await user.keyboard('{Escape}');
    expect(within(card).getByText('Submitted')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Submit answers' })).toBeNull();
  });

  it('walks through the sections in order: the next one appears only after the current is submitted', async () => {
    const calls = stub([sectioned]);
    const user = userEvent.setup();
    render(<Harness stage="during_conference" />);
    const card = await screen.findByRole('article', { name: 'During-conference assessment' });
    // Only the first section is on screen; nothing lets the delegate skip ahead or number the
    // questions (2026-11-06).
    // No section counter on the card (2026-11-07): the sections lead one into the next.
    expect(within(card).queryByText(/sections submitted/)).toBeNull();
    expect(within(card).getByRole('region', { name: 'About the sessions' })).toBeTruthy();
    expect(within(card).queryByText(/Are you a manager?/)).toBeNull();
    expect(within(card).queryByText(/Section 1 of 2/)).toBeNull();
    expect(
      within(card).queryByRole('button', { name: /Next section|Previous section/ }),
    ).toBeNull();
    expect(within(card).queryByRole('list', { name: 'Sections' })).toBeNull();
    expect(within(card).queryByText(/^1\. /)).toBeNull();
    expect(within(card).getByText('Did you attend the keynote?')).toBeTruthy();

    // A required answer missing in this section is flagged in the banner, nothing is sent.
    await user.click(within(card).getByRole('button', { name: 'Submit section' }));
    expect(within(card).getAllByRole('alert')[0]!.textContent).toMatch(
      /One question needs attention/,
    );
    expect(puts(calls)).toHaveLength(0);

    // Submitting the first section: review, then the confirmation says what comes next.
    await user.click(within(card).getAllByLabelText('Yes')[0]!);
    await user.click(within(card).getByRole('button', { name: 'Submit section' }));
    const review = await screen.findByRole('dialog', { name: 'Submit this section?' });
    expect(
      within(review).getByRole('region', { name: 'Summary: About the sessions' }).textContent,
    ).toMatch(/Did you attend the keynote\?Yes/);
    expect(within(review).queryByRole('region', { name: 'Summary: About you' })).toBeNull();
    // An unmarked section asks the delegate to check their responses.
    expect(review.textContent).toMatch(/Check your responses below/);
    await user.click(within(review).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls)[0]).toEqual({ answers: { a: true }, submitSection: 's1' });
    const done = await screen.findByRole('dialog', { name: 'Section submitted' });
    expect(within(done).getByRole('status').textContent).toMatch(
      /“About the sessions” is recorded.*Next: “About you”.*1 section left/,
    );
    await user.click(within(done).getByRole('button', { name: 'Continue to the next section' }));

    // The second section has taken its place; the submitted one is out of the way.
    expect(within(card).queryByText(/sections submitted/)).toBeNull();
    expect(within(card).getByRole('region', { name: 'About you' })).toBeTruthy();
    expect(within(card).queryByRole('region', { name: 'About the sessions' })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Previous section/ })).toBeNull();
    await user.click(within(card).getByLabelText('Yes'));
    await user.click(within(card).getByRole('button', { name: 'Submit section' }));
    // A marked (scored) section gets no "check your responses" line.
    const reviewTwo = await screen.findByRole('dialog', { name: 'Submit this section?' });
    expect(reviewTwo.textContent).not.toMatch(/Check your responses below/);
    await user.click(within(reviewTwo).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls)[1]).toEqual({ answers: { a: true, d: true }, submitSection: 's2' });
    const all = await screen.findByRole('dialog', { name: 'All sections submitted' });
    expect(within(all).getByRole('status').textContent).toMatch(
      /Every section is submitted.*email you when the next step opens/,
    );
    // The scored section's mark, as a percentage, shown at once.
    expect(within(all).getByLabelText('Your mark').textContent).toMatch(/75%.*3 of 4 points/);
    expect(within(all).getByRole('link', { name: 'Back to my dashboard' })).toBeTruthy();
    expect(within(all).queryByRole('button', { name: 'Close' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(within(card).getByText('Submitted')).toBeTruthy();
    // Read-only afterwards, every section shown together.
    expect(within(card).getByRole('region', { name: 'About the sessions' })).toBeTruthy();
    expect(within(card).getByRole('region', { name: 'About you' })).toBeTruthy();
    expect(within(card).getByText(/shown above/)).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Save draft|Submit/ })).toBeNull();
  });

  it('saves a knowledge answer at once, shows the result and locks it, and handles exclusive and "Other" options', async () => {
    const calls = stub([scored]);
    const user = userEvent.setup();
    render(<Harness stage="follow_up" />);
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
    const dialog = await screen.findByRole('dialog', { name: 'Submit your responses?' });
    expect(dialog.textContent).toMatch(/Other, please specify: A coaching log/);
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls).at(-1)).toEqual({
      answers: { k: 'a', m: { selected: ['other'], other: 'A coaching log' } },
      submitSection: 'general',
    });
  });

  const block = {
    id: 'x',
    title: 'Your expectations',
    description: null,
    highlightDescription: false,
    order: 1,
    marking: 'none' as const,
    audience: 'all' as const,
    sourceSectionId: null,
    sourceLabel: null,
  };

  it('shows the pre-event answer above the expectations block and fills in the plan status', async () => {
    const withBlock: MyAssessment = {
      ...open,
      stage: 'end_of_conference',
      wave: 1,
      waveLabel: '',
      sections: [block],
      questions: [
        question('p', {
          type: 'single_choice',
          prompt: 'To what extent did the conference provide what you hoped to gain?',
          sectionId: 'x',
          referenceQuestionKey: '55555555-5555-4555-8555-555555555555',
          showReferenceAnswer: true,
          visibleWhen: 'reference_answered',
          options: [
            { value: 'fully', label: 'Fully' },
            { value: 'partly', label: 'Partly' },
          ],
        }),
        question('s', {
          type: 'single_choice',
          prompt: 'Have you completed your Individual Transfer Plan?',
          sectionId: 'x',
          builtin: 'plan_status',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'started', label: 'Started but not completed' },
            { value: 'no', label: 'No' },
          ],
        }),
      ] as MyAssessment['questions'],
      context: {
        references: [],
        referenceAnswers: {
          '55555555-5555-4555-8555-555555555555': {
            prompt: 'What would you like to learn or gain from the conference?',
            answer: 'How to measure transfer',
          },
        },
        planStatus: 'started',
        plan: null,
      },
    };
    stub([withBlock]);
    render(<Harness stage="end_of_conference" />);
    const card = await screen.findByRole('article', { name: 'End-of-conference evaluation' });
    expect(
      within(card).getByRole('note', { name: 'Before the conference, you said' }).textContent,
    ).toMatch(/How to measure transfer/);
    expect(
      (within(card).getByLabelText('Started but not completed') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('lets a delegate without a recorded expectation decline, and then skips whether it was met', async () => {
    const after: MyAssessment = {
      ...open,
      stage: 'end_of_conference',
      wave: 1,
      waveLabel: '',
      sections: [block],
      questions: [
        question('r', {
          type: 'long_text',
          prompt:
            'You did not record this before the conference. Looking back, what did you hope to gain from attending?',
          sectionId: 'x',
          order: 1,
          referenceQuestionKey: '55555555-5555-4555-8555-555555555555',
          visibleWhen: 'reference_unanswered',
          allowDecline: true,
          required: false,
        }),
        question('m', {
          type: 'single_choice',
          prompt: 'To what extent was this expectation met?',
          sectionId: 'x',
          order: 2,
          referenceQuestionKey: '55555555-5555-4555-8555-555555555555',
          visibleWhen: 'reference_unanswered',
          options: [
            { value: 'met', label: 'Met' },
            { value: 'not_met', label: 'Not met' },
          ],
        }),
      ] as MyAssessment['questions'],
      context: {
        references: [],
        referenceAnswers: {},
        planStatus: 'no',
        plan: null,
      },
    };
    const calls = stub([after]);
    const user = userEvent.setup();
    render(<Harness stage="end_of_conference" />);
    const card = await screen.findByRole('article', { name: 'End-of-conference evaluation' });
    expect(within(card).getByText(/To what extent was this expectation met/)).toBeTruthy();
    expect(within(card).queryByRole('note')).toBeNull();
    await user.click(within(card).getByLabelText('Prefer not to answer'));
    expect(within(card).queryByText(/To what extent was this expectation met/)).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Submit answers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your responses?' });
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    expect(puts(calls).at(-1)).toMatchObject({
      answers: { r: 'Prefer not to answer' },
      submitSection: 'x',
    });
  });

  it('shows a section introduction plainly, or highlighted when the admin marked it so', async () => {
    // As it is: a subtitle under the title, no note role.
    stub([sectioned]);
    const { unmount } = render(<Harness stage="during_conference" />);
    let card = await screen.findByRole('article', { name: 'During-conference assessment' });
    expect(within(card).getByText('Think about today.')).toBeTruthy();
    expect(within(card).queryByRole('note', { name: 'Introduction' })).toBeNull();
    unmount();

    // Marked as an introduction: same words, announced and shown as a note.
    const highlighted: MyAssessment = {
      ...sectioned,
      sections: sectioned.sections.map((s) =>
        s.id === 's1' ? { ...s, highlightDescription: true } : s,
      ),
    };
    vi.unstubAllGlobals();
    stub([highlighted]);
    render(<Harness stage="during_conference" />);
    card = await screen.findByRole('article', { name: 'During-conference assessment' });
    const intro = within(card).getByRole('note', { name: 'Introduction' });
    expect(intro.textContent).toBe('Think about today.');
  });

  it('shows the empty state when nothing is open', async () => {
    stub([]);
    render(<Harness stage="pre_conference" />);
    expect(await screen.findByText('This assessment is not open yet')).toBeTruthy();
  });
});
