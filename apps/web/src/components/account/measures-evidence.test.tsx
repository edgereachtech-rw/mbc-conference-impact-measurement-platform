import type { MeasureView, MyTransferPlan, PlanActionView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActionMeasures,
  EvidenceDialog,
  MeasureLine,
  MeasuresDialog,
  ResultsDialog,
} from './measures-evidence';

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
    kind: 'quantitative',
    name: 'Turnaround time',
    importance: 'Clients wait for it',
    method: 'Days from request to delivery, from the tracker',
    unit: 'days',
    direction: 'lower',
    baselineState: 'known',
    baselineValue: '12',
    baselineOn: '2026-11-01',
    targetState: 'set',
    targetValue: '8',
    targetOn: null,
    actualValue: '',
    actualOn: null,
    source: '',
    influences: '',
    support: 'self_reported',
    results: [],
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...partial,
  };
}

const result = (id: string, value: string, resultOn: string) => ({
  id,
  value,
  resultOn,
  method: 'Average from the tracker',
  meaning: '',
  isFinal: false,
  sourceType: 'workplace_records' as const,
  source: '',
  hasInfluences: false,
  influences: '',
  support: 'self_reported' as const,
  measureName: 'Turnaround time',
  measureKind: 'quantitative' as const,
  unit: 'days',
  recordedAt: `${resultOn}T10:00:00.000Z`,
  updatedAt: `${resultOn}T10:00:00.000Z`,
});

function action(partial: Partial<PlanActionView> = {}): PlanActionView {
  return {
    id: ACTION,
    order: 1,
    isPriority: true,
    title: 'Faster handovers',
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
    measureStatus: null,
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
    outcome: 'pending',
    outcomeNote: '',
    impactChecks: [],
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

const dialogProps = {
  eventId: EVENT,
  planId: 'p1',
  version: 7,
  onClose: () => {},
  onStale: () => {},
};

describe('MeasureLine', () => {
  it('reads a drop as an improvement when lower is better and counts the kept results', () => {
    render(
      <MeasureLine
        measure={measure({
          actualValue: '9',
          actualOn: '2027-02-15',
          support: 'supported',
          source: 'Other: Monthly operations report',
          results: [result('r2', '9', '2027-02-15'), result('r1', '10', '2027-01-15')],
        })}
      />,
    );
    expect(screen.getByText('Improved')).toBeTruthy();
    expect(screen.getByText(/Change -3 days · target not yet reached/)).toBeTruthy();
    expect(screen.getByText('· Supported by another source')).toBeTruthy();
    expect(screen.getByText(/2 results recorded; earlier ones are kept/)).toBeTruthy();
    expect(screen.getByText('Lower is better')).toBeTruthy();
    expect(screen.getByText(/Measured by: Days from request/)).toBeTruthy();
  });

  it('shows an unknown baseline and a not-applicable target as answers, and never calls an increase an improvement without a direction', () => {
    const { unmount } = render(
      <MeasureLine measure={measure({ direction: 'unspecified', actualValue: '14' })} />,
    );
    expect(screen.getByText('Not comparable')).toBeTruthy();
    expect(screen.getByText(/Direction of improvement not stated/)).toBeTruthy();
    unmount();
    render(
      <MeasureLine
        measure={measure({
          baselineState: 'not_yet_known',
          baselineValue: '',
          targetState: 'not_applicable',
          targetValue: '',
        })}
      />,
    );
    expect(screen.getByText(/Baseline Not yet known · Target Not applicable/)).toBeTruthy();
    expect(screen.getByText('No actual result recorded yet.')).toBeTruthy();
  });
});

describe('ActionMeasures', () => {
  it('offers measures only once the action answers "yes", waits for unsaved plan edits, and shows the choice', () => {
    // No answer yet: no way to add measures, only a pointer to the question on the card.
    const first = render(
      <ActionMeasures
        action={action()}
        disabled={false}
        dirty={false}
        onMeasures={() => {}}
        onEvidence={() => {}}
        onResults={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add a measure' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add evidence' })).toBeTruthy();
    expect(screen.getByText(/Answer “Can you identify a business measure/)).toBeTruthy();
    first.unmount();
    // "Not yet known": the answer is shown, still no measures button.
    const second = render(
      <ActionMeasures
        action={action({ measureStatus: 'not_yet_known' })}
        disabled={false}
        dirty={false}
        onMeasures={() => {}}
        onEvidence={() => {}}
        onResults={() => {}}
      />,
    );
    expect(screen.getByText('Not yet known')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a measure' })).toBeNull();
    second.unmount();
    const { unmount } = render(
      <ActionMeasures
        action={action({ measureStatus: 'identified' })}
        disabled={false}
        dirty
        onMeasures={() => {}}
        onEvidence={() => {}}
        onResults={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add a measure' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Add evidence' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/Save your plan first/)).toBeTruthy();
    unmount();
    const onResults = vi.fn();
    render(
      <ActionMeasures
        action={action({ measureStatus: 'identified', measures: [measure()] })}
        disabled={false}
        dirty={false}
        onMeasures={() => {}}
        onEvidence={() => {}}
        onResults={onResults}
      />,
    );
    expect(screen.getByText('1 measure')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit measures' })).toBeTruthy();
    screen.getByRole('button', { name: 'Record a result' }).click();
    expect(onResults).toHaveBeenCalledWith(expect.objectContaining({ id: MEASURE }));
  });
});

describe('MeasuresDialog', () => {
  it('asks for the name, why it matters, how it is measured and the unit, refuses a non-number, then saves the choice with the measure', async () => {
    const calls = stub();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MeasuresDialog
        {...dialogProps}
        action={action({ measureStatus: 'identified' })}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText(/Do not enter confidential/)).toBeTruthy();
    // The question itself is answered on the action card, not here (2026-11-08).
    expect(
      screen.queryByLabelText('Can you identify a business measure for this action?'),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Add at least one measure/);

    await user.click(screen.getByRole('button', { name: 'Add a measure' }));
    const form = screen.getByRole('group', { name: 'Measure 1' });
    await user.type(within(form).getByLabelText(/^What would you like to measure/), 'Error rate');
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(screen.getByRole('alert').textContent).toMatch(/why this measure is important/);
    await user.type(
      within(form).getByLabelText(/^Why is this measure important/),
      'Errors cost rework',
    );
    await user.type(within(form).getByLabelText(/^How will you measure it/), 'From the QA log');
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(screen.getByRole('alert').textContent).toMatch(/give the unit/);
    await user.type(within(form).getByLabelText(/^What unit will you use/), '%');
    await user.selectOptions(
      within(form).getByLabelText('Do you know the current starting value (baseline)?'),
      'known',
    );
    // A quantitative value is a number field: letters and symbols are not taken (2026-11-08).
    const baseline = within(form).getByLabelText(/^Baseline value/) as HTMLInputElement;
    expect(baseline.type).toBe('number');
    await user.type(baseline, '12 %');
    expect(baseline.value).not.toBe('12 %');
    await user.clear(baseline);
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(screen.getByRole('alert').textContent).toMatch(/give the current value/);
    expect(calls).toHaveLength(0);

    await user.type(baseline, '12');
    await user.selectOptions(within(form).getByLabelText('Which way is better?'), 'lower');
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.url).toMatch(
      new RegExp(`/me/events/${EVENT}/transfer-plans/p1/actions/${ACTION}/measures$`),
    );
    expect(calls[0]!.body).toEqual({
      version: 7,
      measureStatus: 'identified',
      measures: [
        {
          kind: 'quantitative',
          name: 'Error rate',
          importance: 'Errors cost rework',
          method: 'From the QA log',
          unit: '%',
          direction: 'lower',
          baselineState: 'known',
          baselineValue: '12',
          baselineOn: null,
          targetState: 'not_yet_known',
          targetValue: '',
          targetOn: null,
        },
      ],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps existing ids and reports a stale plan', async () => {
    const calls = stub(409, {
      error: { code: 'stale_plan', message: 'Your plan changed since you opened it.' },
    });
    const onStale = vi.fn();
    const user = userEvent.setup();
    render(
      <MeasuresDialog
        {...dialogProps}
        action={action({ measureStatus: 'identified', measures: [measure()] })}
        onSaved={() => {}}
        onStale={onStale}
      />,
    );
    expect(screen.getByRole('group', { name: 'Turnaround time' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save measures' }));
    expect(calls[0]!.body).toEqual({
      version: 7,
      measureStatus: 'identified',
      measures: [expect.objectContaining({ id: MEASURE, name: 'Turnaround time' })],
    });
    expect(onStale).toHaveBeenCalledWith('Your plan changed since you opened it.');
  });
});

describe('ResultsDialog', () => {
  it('needs the value, date, method and source, asks what "other" means, and keeps earlier results in the payload', async () => {
    const calls = stub();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const m = measure({
      actualValue: '10',
      actualOn: '2027-01-15',
      results: [result('r1', '10', '2027-01-15')],
    });
    render(
      <ResultsDialog
        {...dialogProps}
        action={action({ measureStatus: 'identified', measures: [m] })}
        measure={m}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText(/never overwritten/)).toBeTruthy();
    // The earlier result is listed, closed, and stays untouched.
    expect(screen.getByRole('group', { name: 'Result 1' }).textContent).toMatch(/10 days/);

    await user.click(screen.getByRole('button', { name: 'Record a result' }));
    const form = screen.getByRole('group', { name: 'Result 1' });
    await user.click(screen.getByRole('button', { name: 'Save results' }));
    expect(screen.getByRole('alert').textContent).toMatch(/record the actual result/);
    const actual = within(form).getByLabelText(/^Actual result/) as HTMLInputElement;
    expect(actual.type).toBe('number');
    await user.type(actual, 'nine');
    expect(actual.value).toBe('');
    await user.clear(actual);
    await user.type(actual, '9');
    await user.type(within(form).getByLabelText(/^Date of result/), '2027-02-15');
    await user.type(
      within(form).getByLabelText(/^How was this result obtained/),
      'Monthly operations report',
    );
    await user.click(screen.getByRole('button', { name: 'Save results' }));
    expect(screen.getByRole('alert').textContent).toMatch(/source of this information/);
    await user.selectOptions(
      within(form).getByLabelText(/^What is the source of this information/),
      'other',
    );
    await user.click(screen.getByRole('button', { name: 'Save results' }));
    expect(screen.getByRole('alert').textContent).toMatch(/specify the source/);
    await user.type(
      within(form).getByLabelText(/^Please describe the source/),
      'Operations report',
    );
    const factors = within(form).getByRole('group', {
      name: 'Were there other factors that influenced this result?',
    });
    await user.click(within(factors).getByLabelText('Yes'));
    await user.type(
      within(form).getByLabelText(/^Describe the other influencing factors/),
      'Two colleagues joined',
    );
    await user.click(within(form).getByRole('radio', { name: /^Supported by another source/ }));
    const final = within(form).getByRole('group', { name: 'Is this result final?' });
    await user.click(within(final).getByLabelText('Yes'));
    expect(calls).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save results' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(
      new RegExp(
        `/me/events/${EVENT}/transfer-plans/p1/actions/${ACTION}/measures/${MEASURE}/results$`,
      ),
    );
    expect(calls[0]!.body).toEqual({
      version: 7,
      results: [
        {
          value: '9',
          resultOn: '2027-02-15',
          method: 'Monthly operations report',
          meaning: '',
          isFinal: true,
          sourceType: 'other',
          source: 'Operations report',
          hasInfluences: true,
          influences: 'Two colleagues joined',
          support: 'supported',
        },
        expect.objectContaining({ id: 'r1', value: '10', resultOn: '2027-01-15' }),
      ],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe('EvidenceDialog', () => {
  it('needs a description, then saves the classification, the measure it supports and no file', async () => {
    const calls = stub();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <EvidenceDialog
        {...dialogProps}
        action={action({ measureStatus: 'identified', measures: [measure()] })}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText(/Nothing is uploaded here/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add evidence' }));
    await user.click(screen.getByRole('button', { name: 'Save evidence' }));
    expect(screen.getByRole('alert').textContent).toMatch(/describe it in your own words/);
    expect(calls).toHaveLength(0);

    const form = screen.getByRole('group', { name: 'Evidence 1' });
    await user.type(
      within(form).getByLabelText('Describe the evidence (required)'),
      'Ran the checklist',
    );
    await user.selectOptions(
      within(form).getByLabelText('What type of evidence is this?'),
      'confirmation',
    );
    await user.selectOptions(
      within(form).getByLabelText('Which measure does it support?'),
      MEASURE,
    );
    await user.click(within(form).getByRole('radio', { name: /^Supported by another source/ }));
    await user.type(within(form).getByLabelText('Who or what is the source?'), 'Line manager');
    await user.click(screen.getByRole('button', { name: 'Save evidence' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(
      new RegExp(`/me/events/${EVENT}/transfer-plans/p1/actions/${ACTION}/evidence$`),
    );
    expect(calls[0]!.body).toEqual({
      version: 7,
      evidence: [
        {
          measureId: MEASURE,
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
