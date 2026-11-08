import type { MyTransferPlan, PlanActionView, TransferPlanSummary } from '@mbc/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferPlanPanel, useMyTransferPlans } from './transfer-plan-panel';

/**
 * Loads the list as the event page does and shows one plan, as its tab would; starting another
 * plan opens it, as the page switches tabs.
 */
function Harness({ planId: initial }: { planId: string }) {
  const plans = useMyTransferPlans(EVENT);
  const [planId, setPlanId] = useState(initial);
  return (
    <TransferPlanPanel
      eventId={EVENT}
      timezone="Africa/Lagos"
      planId={planId}
      plans={plans.state}
      onPlansChanged={() => void plans.refresh()}
      onOpenPlan={setPlanId}
    />
  );
}

afterEach(() => vi.unstubAllGlobals());

const PLAN = '11111111-1111-4111-8111-111111111111';
const PLAN2 = '11111111-1111-4111-8111-222222222222';
const EVENT = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function action(partial: Partial<PlanActionView> = {}): PlanActionView {
  return {
    id: ACTION,
    order: 1,
    isPriority: true,
    title: '',
    priorityLearning: '',
    action: 'Brief stakeholders',
    opportunity: '',
    firstStep: 'Book the meeting',
    startOn: '2026-11-20',
    targetOn: null,
    stakeholders: '',
    support: '',
    barriers: '',
    evidence: '',
    expectedResult: '',
    measure: '',
    baseline: '',
    reviewOn: null,
    progressStatus: 'not_started',
    progress: [],
    measureStatus: null,
    measures: [],
    evidenceRecords: [],
    ...partial,
  };
}

const NO_REMINDER = {
  frequency: 'none' as const,
  startOn: null,
  endOn: null,
  time: '09:00',
  days: [],
  nextReminderAt: null,
};

function plan(partial: Partial<MyTransferPlan> = {}): MyTransferPlan {
  return {
    plan: {
      id: PLAN,
      eventId: EVENT,
      sequence: 1,
      title: '',
      status: 'draft',
      version: 1,
      submittedAt: null,
      completedAt: null,
      outcome: 'pending',
      outcomeNote: '',
      impactChecks: [],
      updatedAt: '2026-11-12T10:00:00.000Z',
      reminder: NO_REMINDER,
      actions: [],
    },
    sessions: [
      {
        id: SESSION,
        date: '2026-11-13',
        title: 'Transfer Planning 2',
        startTime: '14:00',
        endTime: '15:30',
        order: 1,
        isFinal: true,
      },
    ],
    canSubmit: true,
    references: [
      {
        questionKey: '55555555-5555-4555-8555-555555555555',
        prompt: 'What would you like to learn or gain from the conference?',
        answer: 'How to measure transfer',
      },
      {
        questionKey: '66666666-6666-4666-8666-666666666666',
        prompt: 'What would you like to do differently after the conference?',
        answer: null,
      },
    ],
    reminders: [],
    ...partial,
  };
}

/** The list entry the API would derive from a plan. */
function summaryOf(p: MyTransferPlan): TransferPlanSummary {
  return {
    id: p.plan.id,
    sequence: p.plan.sequence,
    title: p.plan.title,
    status: p.plan.status,
    actions: p.plan.actions.filter((a) => a.action.trim()).length,
    priorityAction: p.plan.actions.find((a) => a.isPriority)?.action ?? null,
    submittedAt: p.plan.submittedAt,
    completedAt: p.plan.completedAt,
    outcome: p.plan.outcome,
    checkDue: p.plan.impactChecks.some((c) => !c.answeredAt),
    updatedAt: p.plan.updatedAt,
    reminder: p.plan.reminder,
  };
}

/**
 * Fakes the API for one delegate: the list, each plan by id, saves, submission, progress,
 * completion and starting another plan (2026-11-06).
 */
function stub(initial: MyTransferPlan) {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
  const plans = new Map<string, MyTransferPlan>([[initial.plan.id, initial]]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      calls.push({ url, init, body });
      if (url.endsWith('/transfer-plans') && init?.method === 'POST') {
        const created = plan({
          plan: {
            ...plan().plan,
            id: PLAN2,
            sequence: plans.size + 1,
            title: (body as { title: string }).title,
          },
        });
        plans.set(PLAN2, created);
        return json(created, 201);
      }
      if (url.endsWith('/transfer-plans')) {
        return json({ plans: [...plans.values()].map(summaryOf) });
      }
      const id = /transfer-plans\/([^/?]+)/.exec(url)?.[1] ?? initial.plan.id;
      if (!plans.has(id)) {
        return json(
          { error: { code: 'not_found', message: 'Plan not found.', requestId: 'r404' } },
          404,
        );
      }
      let current = plans.get(id)!;
      if (init?.method === 'PUT') {
        const input = body as {
          version: number;
          title: string;
          actions: Array<{
            title?: string;
            priorityLearning?: string;
            action: string;
            isPriority: boolean;
            measureStatus?: 'identified' | 'not_yet_known' | 'not_applicable' | null;
          }>;
          reminder: MyTransferPlan['plan']['reminder'];
        };
        if (input.version !== current.plan.version) {
          return json(
            {
              error: {
                code: 'stale_plan',
                message: 'Your plan changed since you opened it.',
                requestId: 'r1',
              },
            },
            409,
          );
        }
        current = {
          ...current,
          plan: {
            ...current.plan,
            version: current.plan.version + 1,
            title: input.title,
            reminder: { ...current.plan.reminder, ...input.reminder },
            actions: input.actions.map((a, i) =>
              action({
                id: `${ACTION.slice(0, -1)}${i}`,
                title: a.title ?? '',
                priorityLearning: a.priorityLearning ?? '',
                action: a.action,
                isPriority: a.isPriority,
                measureStatus: a.measureStatus ?? null,
                startOn: null,
                firstStep: '',
              }),
            ),
          },
        };
        plans.set(id, current);
        return json(current);
      }
      if (url.endsWith('/submit')) {
        current = {
          ...current,
          canSubmit: false,
          plan: {
            ...current.plan,
            status: 'submitted',
            submittedAt: '2026-11-13T13:30:00.000Z',
            version: current.plan.version + 1,
          },
        };
        plans.set(id, current);
        return json(current);
      }
      if (url.endsWith('/complete')) {
        current = {
          ...current,
          plan: {
            ...current.plan,
            status: 'completed',
            completedAt: '2027-02-20T10:00:00.000Z',
            outcome:
              (body as { improvement: string }).improvement === 'seen'
                ? 'impact_demonstrated'
                : 'applied',
            outcomeNote: (body as { note: string }).note,
            impactChecks: [
              {
                id: 'c1',
                round: 1,
                dueOn: '2027-05-21',
                notifiedAt: null,
                answeredAt: null,
                answer: null,
                note: '',
                evidence: '',
              },
            ],
            version: current.plan.version + 1,
            reminder: NO_REMINDER,
          },
        };
        plans.set(id, current);
        return json(current);
      }
      return json(current);
    }),
  );
  return calls;
}

describe('TransferPlanPanel', () => {
  it('shows the pre-event answer, saves a draft with the version seen, reviews and submits', async () => {
    const calls = stub(plan());
    const user = userEvent.setup();
    render(<Harness planId={PLAN} />);
    expect((await screen.findAllByText('Draft')).length).toBeGreaterThan(0);
    expect(await screen.findByText('How to measure transfer')).toBeTruthy();
    expect(screen.getByText(/\(final session\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit my plan' }).hasAttribute('disabled')).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Add an action' }));
    const card = screen.getByRole('article', { name: 'Action 1' });
    expect(
      (within(card).getByLabelText('Is this your first priority action?') as HTMLSelectElement)
        .value,
    ).toBe('first');
    // The first plan has no name until the delegate gives it one here (2026-11-08).
    await user.type(screen.getByLabelText('Plan name'), 'Coaching plan');
    // Submission waits for the three required fields of every action (spec 2026-11-08).
    await user.type(within(card).getByLabelText(/^Action title/), 'Measures first');
    await user.type(within(card).getByLabelText(/^Priority learning/), 'Measure before you train');
    await user.type(
      within(card).getByLabelText(/^What specifically will you do differently?/),
      'Define measures first',
    );
    // The business-measure question sits with the action's questions (2026-11-08).
    await user.selectOptions(
      within(card).getByLabelText('Can you identify a business measure for this action?'),
      'identified',
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe(`/api/v1/me/events/${EVENT}/transfer-plans/${PLAN}`);
    expect(put?.body).toMatchObject({
      version: 1,
      title: 'Coaching plan',
      actions: [
        {
          title: 'Measures first',
          priorityLearning: 'Measure before you train',
          action: 'Define measures first',
          isPriority: true,
          startOn: null,
          measureStatus: 'identified',
        },
      ],
      reminder: { frequency: 'none', startOn: null, endOn: null, time: '09:00', days: [] },
    });
    expect(await screen.findByText('Draft saved.')).toBeTruthy();
    // Only a "yes" shows the way to the measures themselves.
    expect(await screen.findByRole('button', { name: 'Add a measure' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit my plan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your plan?' });
    expect(within(dialog).getByRole('list', { name: 'Summary: your actions' }).textContent).toMatch(
      /Define measures first.*First priority/,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    const submit = calls.find((c) => c.url.endsWith('/submit'));
    expect(submit?.body).toEqual({ version: 2 });
    const done = await screen.findByRole('dialog', { name: 'Plan submitted' });
    await user.click(within(done).getByRole('button', { name: 'Close' }));
    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Submit my plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('refuses a stale save with a reload', async () => {
    const calls = stub(
      plan({ canSubmit: false, plan: { ...plan().plan, version: 3, actions: [action()] } }),
    );
    const user = userEvent.setup();
    render(<Harness planId={PLAN} />);
    expect(await screen.findByText(/You can submit at any time/)).toBeTruthy();
    // The server decides whether submission is open; here it is not.
    expect(screen.queryByRole('button', { name: 'Submit my plan' })).toBeNull();
    // Another tab saved in the meantime: the server now holds version 4.
    calls.length = 0;
    vi.mocked(fetch).mockImplementationOnce(async () =>
      json(
        {
          error: {
            code: 'stale_plan',
            message: 'Your plan changed since you opened it.',
            requestId: 'r2',
          },
        },
        409,
      ),
    );
    const card = screen.getByRole('article', { name: 'Brief stakeholders' });
    await user.type(within(card).getByLabelText(/^What is the first step/), ' today');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/changed since you opened it/);
    expect(within(alert).getByRole('button', { name: 'Reload my plan' })).toBeTruthy();
  });

  it('falls back to the current plan when the one it asked for no longer exists', async () => {
    // The page still holds an old plan id; the server only knows the current plan.
    const calls = stub(plan({ plan: { ...plan().plan, id: PLAN2 } }));
    render(<Harness planId={PLAN} />);
    expect(await screen.findByText('How to measure transfer')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith(`/transfer-plans/${PLAN}`))).toBe(true);
    expect(calls.some((c) => c.url.endsWith(`/transfer-plans/${PLAN2}`))).toBe(true);
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('shows the progress the follow-ups recorded and leaves recording to them', async () => {
    stub(
      plan({
        canSubmit: false,
        plan: {
          ...plan().plan,
          status: 'submitted',
          submittedAt: '2026-11-13T13:30:00.000Z',
          version: 5,
          actions: [
            action({
              progressStatus: 'applied',
              progress: [
                {
                  id: 'p1',
                  status: 'applied',
                  wave: 1,
                  waveLabel: '30-day follow-up',
                  occurredOn: '2026-12-10',
                  note: 'Used it in the Q1 programme',
                  evidence: null,
                  results: null,
                  challenges: null,
                  newTargetOn: null,
                  recordedAt: '2026-12-15T09:00:00.000Z',
                },
              ],
            }),
          ],
        },
      }),
    );
    render(<Harness planId={PLAN} />);
    const card = await screen.findByRole('article', { name: 'Brief stakeholders' });
    expect(within(card).queryByRole('button', { name: 'Record progress' })).toBeNull();
    const list = within(card).getByRole('list', { name: 'Progress from follow-ups' });
    expect(list.textContent).toMatch(/30-day follow-up/);
    expect(list.textContent).toMatch(/Applied/);
    expect(list.textContent).toMatch(/Used it in the Q1 programme/);
    // A submitted plan says what completion still needs: evidence, now that the action is applied.
    expect(
      screen.getByRole('list', { name: 'Still needed before completion' }).textContent,
    ).toMatch(/Brief stakeholders: needs evidence/);
    expect(
      screen.getByRole('button', { name: 'Mark this plan completed' }).hasAttribute('disabled'),
    ).toBe(true);
    // Support is no longer asked from the plan page.
    expect(screen.queryByText(/Need support to apply your plan/)).toBeNull();
  });

  it('completes a submitted plan once every action is applied with evidence, asks about impact, then runs the checks', async () => {
    const calls = stub(
      plan({
        canSubmit: false,
        plan: {
          ...plan().plan,
          status: 'submitted',
          submittedAt: '2026-11-13T13:30:00.000Z',
          version: 5,
          actions: [
            action({
              progressStatus: 'applied',
              measures: [
                {
                  id: 'm1',
                  order: 1,
                  kind: 'quantitative',
                  name: 'Turnaround',
                  importance: '',
                  method: 'From the tracker',
                  unit: 'days',
                  direction: 'lower',
                  baselineState: 'known',
                  baselineValue: '12',
                  baselineOn: null,
                  targetState: 'set',
                  targetValue: '8',
                  targetOn: null,
                  actualValue: '9',
                  actualOn: '2027-01-15',
                  source: '',
                  influences: '',
                  support: 'self_reported',
                  results: [],
                  updatedAt: '2027-01-15T00:00:00.000Z',
                },
              ],
              evidenceRecords: [
                {
                  id: 'e1',
                  order: 1,
                  measureId: null,
                  type: 'confirmation',
                  description: 'Manager confirmed it in the review',
                  evidenceOn: null,
                  support: 'supported',
                  supportedBy: 'Line manager',
                  reference: '',
                  updatedAt: '2027-01-15T00:00:00.000Z',
                },
              ],
            }),
          ],
        },
      }),
    );
    const user = userEvent.setup();
    render(<Harness planId={PLAN} />);
    expect(await screen.findByText(/Every action is applied, with evidence/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mark this plan completed' }));
    const confirm = await screen.findByRole('dialog', { name: 'Complete this plan?' });
    // Completion asks about impact: a measurable improvement is the delegate's own claim.
    await user.click(within(confirm).getByLabelText(/Yes, there is a measurable improvement/));
    await user.type(
      within(confirm).getByLabelText(/what changed, or what has not changed yet/),
      'Turnaround fell to 9 days',
    );
    await user.click(within(confirm).getByRole('button', { name: 'Complete the plan' }));
    const post = calls.find((c) => c.url.endsWith('/complete'));
    expect(post?.url).toBe(`/api/v1/me/events/${EVENT}/transfer-plans/${PLAN}/complete`);
    expect(post?.body).toEqual({
      version: 5,
      improvement: 'seen',
      note: 'Turnaround fell to 9 days',
    });
    const done = await screen.findByRole('dialog', { name: 'Plan completed' });
    expect(done.textContent).toMatch(/organisers have been told/);
    await user.click(within(done).getByRole('button', { name: 'Close' }));
    // Finished: read-only, no saving, no new actions, reminders stopped.
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText(/This plan is finished and its reminders have stopped/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add an action' })).toBeNull();
    // Impact assessment takes over: the reported outcome and the next check's date.
    expect(screen.getAllByText('Impact demonstrated').length).toBeGreaterThan(0);
    expect(screen.getByText(/We will ask you on 21 May 2027 whether/)).toBeTruthy();
  });

  it('lets the delegate start another plan and choose twice-weekly reminders with a window', async () => {
    const calls = stub(
      plan({ plan: { ...plan().plan, status: 'submitted', version: 2, actions: [action()] } }),
    );
    const user = userEvent.setup();
    render(<Harness planId={PLAN} />);
    await screen.findByRole('article', { name: 'Brief stakeholders' });
    await user.click(screen.getByRole('button', { name: 'Start another plan' }));
    await user.type(screen.getByLabelText('What is this plan about?'), 'Coaching rollout');
    await user.click(screen.getByRole('button', { name: 'Start this plan' }));
    const created = calls.find(
      (c) => c.init?.method === 'POST' && c.url.endsWith('/transfer-plans'),
    );
    expect(created?.body).toEqual({ title: 'Coaching rollout' });
    // The new plan opens on its own, empty.
    await vi.waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Brief stakeholders' })).toBeNull(),
    );

    // Twice a week: the days appear and exactly two can be chosen; the window and time are saved.
    await user.selectOptions(await screen.findByLabelText('How often'), 'twice_weekly');
    const days = screen.getByRole('group', { name: 'Which two days' });
    expect(within(days).getByText('Choose two days.')).toBeTruthy();
    await user.click(within(days).getByLabelText('Tuesday'));
    await user.click(within(days).getByLabelText('Friday'));
    expect((within(days).getByLabelText('Monday') as HTMLInputElement).disabled).toBe(true);
    expect(within(days).queryByText('Choose two days.')).toBeNull();
    // A time input takes its value by change event: typing into it is not reliable in jsdom.
    fireEvent.change(screen.getByLabelText('At what time'), { target: { value: '18:00' } });
    await user.type(screen.getByLabelText('Start from'), '2026-12-10');
    await user.type(screen.getByLabelText('Until'), '2027-01-31');
    await user.click(screen.getByRole('button', { name: 'Add an action' }));
    await user.type(
      within(screen.getByRole('article', { name: 'Action 1' })).getByLabelText(
        /^What specifically will you do differently?/,
      ),
      'Coach two team leads',
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe(`/api/v1/me/events/${EVENT}/transfer-plans/${PLAN2}`);
    expect(put?.body).toMatchObject({
      reminder: {
        frequency: 'twice_weekly',
        days: [2, 5],
        time: '18:00',
        startOn: '2026-12-10',
        endOn: '2027-01-31',
      },
    });
  });
});
