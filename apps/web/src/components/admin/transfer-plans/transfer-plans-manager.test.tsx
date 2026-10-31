import type { EventDetail, TransferPlanAdminDetail, TransferPlanListItem } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferPlansManager } from './transfer-plans-manager';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DEE = '77777777-7777-4777-8777-777777777777';
const ADA = '88888888-8888-4888-8888-888888888888';
const Q1 = '11111111-1111-4111-8111-111111111111';
const Q2 = '22222222-2222-4222-8222-222222222222';
const PLAN = '33333333-3333-4333-8333-333333333333';
const ACTION = '44444444-4444-4444-8444-444444444444';

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
  dates: [],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};

const progress = {
  not_started: 0,
  started: 0,
  in_progress: 0,
  applied: 0,
  applied_consistently: 0,
  completed: 0,
  changed: 0,
  no_longer_applicable: 0,
};
const plans: TransferPlanListItem[] = [
  {
    delegate: {
      id: DEE,
      name: 'Dee Legate',
      email: 'dee@example.com',
      organisation: 'Acme',
      attendanceFormat: 'physical',
    },
    status: 'submitted',
    actions: 2,
    priorityAction: 'Brief stakeholders',
    submittedAt: '2026-11-13T13:30:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    progress: { ...progress, applied: 1, not_started: 1 },
    reminderFrequency: 'weekly',
  },
  {
    delegate: {
      id: ADA,
      name: 'Ada Other',
      email: 'ada@example.com',
      organisation: null,
      attendanceFormat: 'virtual',
    },
    status: 'draft',
    actions: 0,
    priorityAction: null,
    submittedAt: null,
    updatedAt: '2026-11-12T16:10:00.000Z',
    progress,
    reminderFrequency: 'none',
  },
];

const detail: TransferPlanAdminDetail = {
  delegate: plans[0]!.delegate,
  plan: {
    id: PLAN,
    eventId: 'e1',
    status: 'submitted',
    version: 6,
    submittedAt: '2026-11-13T13:30:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    reminder: { frequency: 'weekly', startOn: null, nextReminderAt: '2026-12-01T09:00:00.000Z' },
    actions: [
      {
        id: ACTION,
        order: 1,
        isPriority: true,
        priorityLearning: 'Measurement before training',
        action: 'Brief stakeholders (revised)',
        opportunity: '',
        firstStep: 'Book the meeting',
        startOn: '2026-11-20',
        targetOn: '2027-01-15',
        stakeholders: '',
        support: '',
        barriers: '',
        evidence: '',
        expectedResult: '',
        measure: 'Not yet known',
        baseline: '',
        reviewOn: null,
        progressStatus: 'applied',
        progress: [
          {
            id: 'p1',
            status: 'applied',
            note: 'Used in Q1 plan',
            evidence: null,
            results: null,
            challenges: null,
            newTargetOn: '2027-01-15',
            recordedAt: '2026-11-24T09:00:00.000Z',
          },
        ],
      },
    ],
  },
  snapshot: null,
  references: [
    {
      questionKey: Q1,
      prompt: 'What would you like to learn or gain from the conference?',
      answer: 'How to measure transfer',
    },
  ],
  history: [
    {
      at: '2026-11-13T13:30:00.000Z',
      by: 'dee@example.com',
      action: 'transfer_plan.submitted',
      detail: null,
    },
  ],
  reminders: [
    {
      scheduledFor: '2026-11-25T09:00:00.000Z',
      sentAt: '2026-11-25T09:05:00.000Z',
      status: 'sent',
    },
  ],
};
detail.snapshot = {
  ...detail.plan,
  version: 4,
  actions: [
    {
      ...detail.plan.actions[0]!,
      action: 'Brief stakeholders',
      progressStatus: 'not_started',
      progress: [],
    },
  ],
};

function stub() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/reference-questions')) {
        if (init?.method === 'PUT') {
          return json({ references: JSON.parse(String(init.body)).questionKeys });
        }
        return json({
          references: [Q1],
          questions: [
            {
              questionKey: Q1,
              prompt: 'What would you like to learn or gain from the conference?',
              type: 'long_text',
            },
            {
              questionKey: Q2,
              prompt: 'What would you like to do differently after the conference?',
              type: 'long_text',
            },
          ],
        });
      }
      if (url.endsWith(`/transfer-plans/${DEE}`)) return json({ plan: detail });
      return json({
        plans,
        sessions: [
          {
            id: 's1',
            date: '2026-11-13',
            title: 'Transfer Planning 2',
            startTime: '14:00',
            endTime: '15:30',
            order: 1,
            isFinal: true,
          },
        ],
      });
    }),
  );
  return calls;
}

describe('TransferPlansManager', () => {
  it('counts plans and applied actions, lists them with filters, and opens one plan with its versions', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<TransferPlansManager event={event} />);
    expect(await screen.findByText('Plans started')).toBeTruthy();
    expect(screen.getByText('Plans started').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText('Plans submitted').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Actions applied').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Submission opens here')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('1 not yet started · 1 applied')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Ada Other')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.selectOptions(screen.getByLabelText('With an action'), 'applied');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Dee Legate')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dee Legate' });
    expect(calls.some((c) => c.url.endsWith(`/transfer-plans/${DEE}`))).toBe(true);
    expect(dialog.textContent).toMatch(/How to measure transfer/);
    expect(dialog.textContent).toMatch(/Brief stakeholders \(revised\)/);
    expect(dialog.textContent).toMatch(/Not yet known/);
    expect(dialog.textContent).toMatch(/Every week.*1 sent/);
    await user.click(within(dialog).getByRole('button', { name: 'As submitted' }));
    expect(dialog.textContent).not.toMatch(/\(revised\)/);
    expect(dialog.textContent).toMatch(/1\. Brief stakeholders/);
  });

  it('saves which pre-event questions come back as references', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<TransferPlansManager event={event} />);
    const learn = await screen.findByLabelText(/What would you like to learn or gain/);
    expect((learn as HTMLInputElement).checked).toBe(true);
    expect(learn.closest('label')?.textContent).toMatch(/Expectation/);
    const differently = screen.getByLabelText(/What would you like to do differently/);
    expect((differently as HTMLInputElement).checked).toBe(false);
    await user.click(differently);
    expect(differently.closest('label')?.textContent).toMatch(/2$/);
    await user.click(screen.getByRole('button', { name: 'Save references' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe('/api/v1/events/e1/reference-questions');
    expect(JSON.parse(String(put?.init?.body))).toEqual({ questionKeys: [Q1, Q2] });
    expect(await screen.findByText('Reference questions saved.')).toBeTruthy();
  });
});
