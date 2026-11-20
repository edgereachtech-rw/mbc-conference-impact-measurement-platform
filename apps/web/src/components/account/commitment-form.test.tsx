import { DEFAULT_CHECKLIST_TEMPLATE, type MyTransferPlan } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommitmentForm } from './commitment-form';

const PLAN = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

const data: MyTransferPlan = {
  plan: {
    id: PLAN,
    eventId: EVENT,
    sequence: 1,
    title: '',
    trainingName: '',
    checklist: null,
    status: 'draft',
    version: 1,
    submittedAt: null,
    completedAt: null,
    outcome: 'pending',
    outcomeNote: '',
    impactChecks: [],
    updatedAt: '2026-11-23T10:00:00.000Z',
    actions: [],
  },
  mode: 'commitment',
  template: DEFAULT_CHECKLIST_TEMPLATE,
  sessions: [],
  canSubmit: true,
  references: [],
  reminders: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('CommitmentForm', () => {
  it('asks for the training, at least one tick and a commitment among the ticks, then saves once', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({
            ...data,
            plan: {
              ...data.plan,
              status: 'submitted',
              version: 3,
              submittedAt: '2026-11-23T11:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <CommitmentForm
        eventId={EVENT}
        timezone="Africa/Lagos"
        data={data}
        template={DEFAULT_CHECKLIST_TEMPLATE}
        onSaved={onSaved}
        onReload={vi.fn()}
      />,
    );
    const form = screen.getByRole('form', { name: 'My Training Checklist and Commitment' });
    expect(within(form).getByText(/Choose one current or upcoming training/)).toBeTruthy();
    // Every action is its own tick box, in its group.
    const during = within(form).getByRole('group', { name: 'During training' });
    expect(within(during).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(form).getAllByRole('checkbox')).toHaveLength(11);

    const save = within(form).getByRole('button', { name: 'Save my commitment' });
    await user.click(save);
    expect(within(form).getByRole('alert').textContent).toMatch(/What is the name of the training/);
    await user.type(
      within(form).getByLabelText(/What is the name of the training/),
      'Coaching skills',
    );
    await user.click(save);
    expect(within(form).getByRole('alert').textContent).toMatch(/Tick at least one action/);
    expect(calls).toHaveLength(0);

    // Only ticked actions can be committed to.
    await user.click(within(during).getByLabelText('Protect the trainee’s time to participate.'));
    await user.click(within(form).getByLabelText('Explain why the trainee is attending.'));
    const choose = within(form).getByLabelText('Which action will you commit to?');
    expect(
      within(choose)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Choose an action',
      'Explain why the trainee is attending.',
      'Protect the trainee’s time to participate.',
    ]);
    await user.selectOptions(choose, 'protect_time');
    await user.type(within(form).getByLabelText('What will you do?'), 'Block both afternoons');
    await user.type(within(form).getByLabelText('By what date?'), '2026-12-15');
    await user.type(
      within(form).getByLabelText('What will show you have done it?'),
      'The calendar entries',
    );
    await user.click(within(form).getByLabelText('Yes'));
    await user.type(within(form).getByLabelText('Remind me on'), '2026-12-10');
    await user.click(save);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/v1/me/events/${EVENT}/transfer-plans/${PLAN}/commitment`);
    expect(calls[0]!.body).toEqual({
      version: 1,
      trainingName: 'Coaching skills',
      ticked: ['protect_time', 'explain_why'],
      commitmentKey: 'protect_time',
      what: 'Block both afternoons',
      byOn: '2026-12-15',
      evidence: 'The calendar entries',
      reminderOn: '2026-12-10',
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ plan: expect.objectContaining({ status: 'submitted' }) }),
      'Your checklist and commitment have been saved.',
    );
  });

  it('shows a saved commitment back with its updates from the follow-ups', () => {
    render(
      <CommitmentForm
        eventId={EVENT}
        timezone="Africa/Lagos"
        data={{
          ...data,
          plan: {
            ...data.plan,
            status: 'submitted',
            submittedAt: '2026-11-23T11:00:00.000Z',
            trainingName: 'Coaching skills',
            checklist: { ticked: ['protect_time'], commitmentKey: 'protect_time' },
            actions: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                order: 1,
                isPriority: true,
                title: 'Protect the trainee’s time to participate.',
                priorityLearning: '',
                action: 'Block both afternoons',
                opportunity: '',
                firstStep: '',
                startOn: null,
                targetOn: '2026-12-15',
                stakeholders: '',
                support: '',
                barriers: '',
                evidence: 'The calendar entries',
                expectedResult: '',
                measure: '',
                baseline: '',
                reviewOn: null,
                progressStatus: 'started',
                progress: [
                  {
                    id: '44444444-4444-4444-8444-444444444444',
                    status: 'started',
                    wave: 1,
                    waveLabel: '30-day follow-up',
                    occurredOn: null,
                    note: 'One afternoon done',
                    evidence: null,
                    results: null,
                    challenges: null,
                    newTargetOn: null,
                    recordedAt: '2026-12-23T09:00:00.000Z',
                  },
                ],
                measureStatus: null,
                measures: [],
                evidenceRecords: [],
                reminder: {
                  frequency: 'once',
                  startOn: '2026-12-10',
                  endOn: '2026-12-10',
                  time: '09:00',
                  days: [],
                  nextReminderAt: '2026-12-10T08:00:00.000Z',
                },
              },
            ],
          },
        }}
        template={DEFAULT_CHECKLIST_TEMPLATE}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/Saved 23 Nov 2026/);
    expect((screen.getByLabelText('What will you do?') as HTMLTextAreaElement).value).toBe(
      'Block both afternoons',
    );
    expect((screen.getByLabelText('Remind me on') as HTMLInputElement).value).toBe('2026-12-10');
    const updates = screen.getByRole('region', { name: 'Your updates' });
    expect(updates.textContent).toMatch(/30-day follow-up: I have started/);
    expect(updates.textContent).toMatch(/One afternoon done/);
  });
});
