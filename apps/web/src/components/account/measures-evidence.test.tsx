import type { MeasureView, MyTransferPlan, PlanActionView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionMeasures, EvidenceDialog, MeasureLine, MeasuresDialog } from './measures-evidence';

afterEach(() => vi.unstubAllGlobals());

const EVENT = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333';
const MEASURE = '44444444-4444-4444-8444-444444444444';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function measure(partial: Partial<MeasureView> = {}): MeasureView {
  return {
    id: MEASURE,
    order: 1,
    status: 'identified',
    kind: 'quantitative',
    name: 'Turnaround time',
    importance: '',
    unit: 'days',
    direction: 'lower',
    baselineValue: '12',
    baselineOn: '2026-11-01',
    targetValue: '8',
    targetOn: null,
    actualValue: '',
    actualOn: null,
    source: '',
    influences: '',
    support: 'self_reported',
    readings: [],
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...partial,
  };
}

function action(partial: Partial<PlanActionView> = {}): PlanActionView {
  return {
    id: ACTION,
    order: 1,
    isPriority: true,
    priorityLearning: '',
    action: 'Brief stakeholders',
    opportunity: '',
    firstStep: '',
    startOn: null,
    targetOn: null,
    stakeholders: '',
    support: '',
    barriers: '',
    evidence: '',
    expectedResult: '',
    measure: '',
    baseline: '',
    reviewOn: null,
    progressStatus: 'applied',
    progress: [],
    measures: [],
    evidenceRecords: [],
    ...partial,
  };
}

const planResponse = (): MyTransferPlan => ({
  plan: {
    id: '11111111-1111-4111-8111-111111111111',
    eventId: EVENT,
    sequence: 1,
    title: '',
    status: 'submitted',
    version: 8,
    completedAt: null,
    submittedAt: '2026-11-13T13:30:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    reminder: {
      frequency: 'none',
      startOn: null,
      endOn: null,
      time: '09:00',
      days: [],
      nextReminderAt: null,
    },
    actions: [action()],
  },
  sessions: [],
  canSubmit: false,
  references: [],
  reminders: [],
});

function stub(status = 200, body: unknown = planResponse()) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      });
      return json(body, status);
    }),
  );
  return calls;
}

describe('MeasureLine', () => {
  it('reads a drop as an improvement when lower is better and keeps the earlier results', () => {
    render(
      <MeasureLine
        measure={measure({
          actualValue: '9',
          actualOn: '2027-02-15',
          support: 'supported',
          source: 'Monthly operations report',
          readings: [
            {
              id: 'r1',
              value: '10',
              readingOn: '2027-01-15',
              source: 'Team tracker',
              support: 'self_reported',
              recordedAt: '2027-01-16T10:00:00.000Z',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Improved')).toBeTruthy();
    expect(screen.getByText(/Change -3 days · target not yet reached/)).toBeTruthy();
    expect(screen.getByText('· Supported by another source')).toBeTruthy();
    expect(screen.getByText(/Earlier results: 10 days \(/)).toBeTruthy();
    expect(screen.getByText('Lower is better')).toBeTruthy();
  });

  it('never calls an increase an improvement without a direction, and shows the status otherwise', () => {
    const { unmount } = render(
      <MeasureLine measure={measure({ direction: 'unspecified', actualValue: '14' })} />,
    );
    expect(screen.getByText('Not comparable')).toBeTruthy();
    expect(screen.getByText(/Direction of improvement not stated/)).toBeTruthy();
    unmount();
    render(<MeasureLine measure={measure({ status: 'not_applicable', name: 'Revenue' })} />);
    expect(screen.getByText('Not applicable')).toBeTruthy();
    expect(screen.queryByText(/Baseline/)).toBeNull();
  });
});

describe('ActionMeasures', () => {
  it('waits for unsaved plan edits before opening either dialog', () => {
    render(
      <ActionMeasures
        action={action()}
        disabled={false}
        dirty
        onMeasures={() => {}}
        onEvidence={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add a measure' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Add evidence' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/Save your plan first/)).toBeTruthy();
  });
});

describe('MeasuresDialog', () => {
  it('refuses a non-number for a quantitative measure before calling the server, then saves', async () => {
    const calls = stub();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MeasuresDialog
        eventId={EVENT}
        planId="p1"
        action={action()}
        version={7}
        onClose={() => {}}
        onSaved={onSaved}
        onStale={() => {}}
      />,
    );
    expect(screen.getByText(/Do not enter confidential/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add a measure' }));
    const form = screen.getByRole('group', { name: 'Measure 1' });
    await user.type(within(form).getByLabelText('Measure'), 'Error rate');
    await user.type(within(form).getByLabelText('Baseline'), '12 %');
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(screen.getByRole('alert').textContent).toMatch(/must be a number/);
    expect(calls).toHaveLength(0);

    await user.clear(within(form).getByLabelText('Baseline'));
    await user.type(within(form).getByLabelText('Baseline'), '12');
    await user.type(within(form).getByLabelText('Unit'), '%');
    await user.selectOptions(within(form).getByLabelText('Which way is better?'), 'lower');
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.url).toMatch(
      new RegExp(`/me/events/${EVENT}/transfer-plans/p1/actions/${ACTION}/measures$`),
    );
    expect(calls[0]!.body).toEqual({
      version: 7,
      measures: [
        expect.objectContaining({
          status: 'identified',
          kind: 'quantitative',
          name: 'Error rate',
          unit: '%',
          direction: 'lower',
          baselineValue: '12',
          baselineOn: null,
          actualValue: '',
          actualOn: null,
          support: 'self_reported',
        }),
      ],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('lets a measure be not yet known with no value, keeps ids, and reports a stale plan', async () => {
    const calls = stub(409, {
      error: { code: 'stale_plan', message: 'Your plan changed since you opened it.' },
    });
    const onStale = vi.fn();
    const user = userEvent.setup();
    render(
      <MeasuresDialog
        eventId={EVENT}
        planId="p1"
        action={action({ measures: [measure()] })}
        version={7}
        onClose={() => {}}
        onSaved={() => {}}
        onStale={onStale}
      />,
    );
    const form = screen.getByRole('group', { name: 'Turnaround time' });
    await user.selectOptions(
      within(form).getByLabelText('Do you have a measure for this action?'),
      'not_yet_known',
    );
    expect(within(form).queryByLabelText('Baseline')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(calls[0]!.body).toEqual({
      version: 7,
      measures: [expect.objectContaining({ id: MEASURE, status: 'not_yet_known' })],
    });
    expect(onStale).toHaveBeenCalledWith('Your plan changed since you opened it.');
  });
});

describe('EvidenceDialog', () => {
  it('needs a description, then saves the classification without any file', async () => {
    const calls = stub();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <EvidenceDialog
        eventId={EVENT}
        planId="p1"
        action={action()}
        version={7}
        onClose={() => {}}
        onSaved={onSaved}
        onStale={() => {}}
      />,
    );
    expect(screen.getByText(/Nothing is uploaded here/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add evidence' }));
    await user.click(screen.getByRole('button', { name: 'Save evidence' }));
    expect(screen.getByRole('alert').textContent).toMatch(/describe it in your own words/);
    expect(calls).toHaveLength(0);

    const form = screen.getByRole('group', { name: 'Evidence 1' });
    await user.type(within(form).getByLabelText('Description (required)'), 'Ran the checklist');
    await user.selectOptions(
      within(form).getByLabelText('What kind of evidence is it?'),
      'confirmation',
    );
    await user.click(within(form).getByRole('radio', { name: /^Supported by another source/ }));
    await user.type(within(form).getByLabelText('Supported by'), 'Line manager');
    await user.click(screen.getByRole('button', { name: 'Save evidence' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(
      new RegExp(`/me/events/${EVENT}/transfer-plans/p1/actions/${ACTION}/evidence$`),
    );
    expect(calls[0]!.body).toEqual({
      version: 7,
      evidence: [
        {
          type: 'confirmation',
          description: 'Ran the checklist',
          evidenceOn: null,
          support: 'supported',
          supportedBy: 'Line manager',
          reference: '',
        },
      ],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
