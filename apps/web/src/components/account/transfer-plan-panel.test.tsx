import type { MyTransferPlan, PlanActionView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferPlanPanel } from './transfer-plan-panel';

afterEach(() => vi.unstubAllGlobals());

const PLAN = '11111111-1111-4111-8111-111111111111';
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
    ...partial,
  };
}

function plan(partial: Partial<MyTransferPlan> = {}): MyTransferPlan {
  return {
    plan: {
      id: PLAN,
      eventId: EVENT,
      status: 'draft',
      version: 1,
      submittedAt: null,
      updatedAt: '2026-11-12T10:00:00.000Z',
      reminder: { frequency: 'none', startOn: null, nextReminderAt: null },
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

function stub(initial: MyTransferPlan) {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
  let current = initial;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      calls.push({ url, init, body });
      if (init?.method === 'PUT') {
        const input = body as {
          version: number;
          actions: Array<{ action: string; isPriority: boolean }>;
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
            actions: input.actions.map((a, i) =>
              action({
                id: `${ACTION.slice(0, -1)}${i}`,
                action: a.action,
                isPriority: a.isPriority,
                startOn: null,
                firstStep: '',
              }),
            ),
          },
        };
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
        return json(current);
      }
      if (url.includes('/progress')) {
        const input = body as { status: PlanActionView['progressStatus']; note: string };
        current = {
          ...current,
          plan: {
            ...current.plan,
            version: current.plan.version + 1,
            actions: current.plan.actions.map((a) => ({
              ...a,
              progressStatus: input.status,
              progress: [
                {
                  id: 'p1',
                  status: input.status,
                  note: input.note,
                  evidence: null,
                  results: null,
                  challenges: null,
                  newTargetOn: null,
                  recordedAt: '2026-12-01T09:00:00.000Z',
                },
              ],
            })),
          },
        };
        return json(current, 201);
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
    render(<TransferPlanPanel eventId={EVENT} timezone="Africa/Lagos" />);
    expect(await screen.findByText('Draft')).toBeTruthy();
    expect(screen.getByText('How to measure transfer')).toBeTruthy();
    expect(screen.getByText(/final session, submission opens/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit my plan' }).hasAttribute('disabled')).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Add an action' }));
    const card = screen.getByRole('article', { name: 'Action 1' });
    expect(
      (within(card).getByLabelText('This is my first priority') as HTMLInputElement).checked,
    ).toBe(true);
    await user.type(within(card).getByLabelText('Action'), 'Define measures first');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe(`/api/v1/me/events/${EVENT}/transfer-plan`);
    expect(put?.body).toMatchObject({
      version: 1,
      actions: [{ action: 'Define measures first', isPriority: true, startOn: null }],
      reminder: { frequency: 'none', startOn: null },
    });
    expect(await screen.findByText('Draft saved.')).toBeTruthy();

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
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit my plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('explains when submission opens and refuses a stale save with a reload', async () => {
    const calls = stub(
      plan({ canSubmit: false, plan: { ...plan().plan, version: 3, actions: [action()] } }),
    );
    const user = userEvent.setup();
    render(<TransferPlanPanel eventId={EVENT} timezone="Africa/Lagos" />);
    expect(
      await screen.findByText(
        /You submit from the start of the final Transfer Planning session on 13 Nov 2026 at 14:00/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit my plan' })).toBeNull();
    // Another tab saved in the meantime: the server now holds version 4.
    calls.length = 0;
    const current = calls;
    void current;
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
    await user.type(within(card).getByLabelText('First step'), ' today');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/changed since you opened it/);
    expect(within(alert).getByRole('button', { name: 'Reload my plan' })).toBeTruthy();
  });

  it('records progress on a saved action with the details the status needs', async () => {
    const calls = stub(
      plan({
        canSubmit: false,
        plan: {
          ...plan().plan,
          status: 'submitted',
          submittedAt: '2026-11-13T13:30:00.000Z',
          version: 5,
          actions: [action()],
        },
      }),
    );
    const user = userEvent.setup();
    render(<TransferPlanPanel eventId={EVENT} timezone="Africa/Lagos" />);
    const card = await screen.findByRole('article', { name: 'Brief stakeholders' });
    expect(within(card).getByText('Not yet started')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Record progress' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record progress' });
    await user.selectOptions(
      within(dialog).getByLabelText('Where does this action stand?'),
      'applied',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save progress' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Give an example/);
    expect(calls.filter((c) => c.url.includes('/progress'))).toHaveLength(0);
    await user.type(
      within(dialog).getByLabelText('Details (required)'),
      'Used it in the Q1 programme',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save progress' }));
    const post = calls.find((c) => c.url.includes('/progress'));
    expect(post?.url).toBe(`/api/v1/me/events/${EVENT}/transfer-plan/actions/${ACTION}/progress`);
    expect(post?.body).toMatchObject({ status: 'applied', note: 'Used it in the Q1 programme' });
    const updated = await screen.findByRole('article', { name: 'Brief stakeholders' });
    expect(within(updated).getAllByText('Applied').length).toBeGreaterThan(0);
    expect(updated.textContent).toMatch(/Used it in the Q1 programme/);
  });
});
