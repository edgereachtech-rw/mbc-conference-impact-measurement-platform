import type { MeasureReportRow } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeasuresReport } from './measures-report';

const MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const delegate = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Dee Legate',
  email: 'dee@example.com',
  organisation: 'Acme',
  attendanceFormat: 'physical' as const,
};
const MEASURE = '55555555-5555-4555-8555-555555555555';

const result = (
  id: string,
  value: string,
  resultOn: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  value,
  resultOn,
  method: 'From the monthly operations report',
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
  ...extra,
});

function rows(withEvidence: boolean): MeasureReportRow[] {
  return [
    {
      delegate,
      planStatus: 'submitted',
      action: {
        id: '44444444-4444-4444-8444-444444444444',
        order: 1,
        title: 'Faster handovers',
        action: 'Brief stakeholders',
        isPriority: true,
        progressStatus: 'applied',
        measureStatus: 'identified',
      },
      summary: 'with_result',
      measures: [
        {
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
          targetOn: '2027-03-31',
          actualValue: '9',
          actualOn: '2027-02-15',
          source: 'Workplace records or reports',
          influences: 'Two colleagues joined',
          support: 'supported',
          results: [
            result('r2', '9', '2027-02-15', {
              support: 'supported',
              hasInfluences: true,
              influences: 'Two colleagues joined',
              isFinal: true,
            }),
            result('r1', '10', '2027-01-15'),
          ],
          updatedAt: '2027-02-16T10:00:00.000Z',
        },
      ],
      evidence: { self_reported: 1, supported: 1 },
      evidenceRecords: withEvidence
        ? [
            {
              id: '66666666-6666-4666-8666-666666666666',
              order: 1,
              measureId: MEASURE,
              type: 'confirmation',
              description: 'My manager confirmed the new turnaround',
              evidenceOn: '2027-02-20',
              support: 'supported',
              supportedBy: 'Line manager',
              reference: 'February review notes',
              updatedAt: '2027-02-21T10:00:00.000Z',
            },
            {
              id: '77777777-6666-4666-8666-666666666666',
              order: 2,
              measureId: null,
              type: 'work_product',
              description: 'Set up the measures before the workshop',
              evidenceOn: null,
              support: 'self_reported',
              supportedBy: '',
              reference: '',
              updatedAt: '2027-02-21T10:00:00.000Z',
            },
          ]
        : null,
    },
    {
      delegate,
      planStatus: 'submitted',
      action: {
        id: '88888888-4444-4444-8444-444444444444',
        order: 2,
        title: '',
        action: 'Define measures before training',
        isPriority: false,
        progressStatus: 'not_started',
        measureStatus: 'not_yet_known',
      },
      summary: 'not_yet_known',
      measures: [],
      evidence: { self_reported: 0, supported: 0 },
      evidenceRecords: withEvidence ? [] : null,
    },
  ];
}

function stub() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return json({ rows: rows(url.includes('evidence=true')) });
    }),
  );
  return calls;
}

describe('MeasuresReport', () => {
  it('shows the overview, one register row per measure with the latest result, and the detail with every result in date order', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    const table = await screen.findByRole('table');
    const overview = screen.getByRole('region', { name: 'Business measures overview' });
    expect(overview.textContent).toMatch(/Planned actions2/);
    expect(overview.textContent).toMatch(/Actions with measures1/);
    expect(overview.textContent).toMatch(/Not yet known1/);
    expect(within(table).getByText('Turnaround time')).toBeTruthy();
    expect(within(table).getByText('Measure not yet known')).toBeTruthy();
    expect(within(table).getByText('Improved')).toBeTruthy();
    expect(within(table).getByText('2 results')).toBeTruthy();
    expect(screen.queryByText(/My manager confirmed/)).toBeNull();
    expect(calls).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Details: Turnaround time/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Turnaround time' });
    const results = within(dialog).getByRole('region', { name: 'Actual results' });
    const items = within(results).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/10 days/);
    expect(items[1]!.textContent).toMatch(/9 days/);
    expect(items[1]!.textContent).toMatch(/Final/);
    expect(items[1]!.textContent).toMatch(/Two colleagues joined/);
    expect(within(dialog).getByText(/Days from request to delivery/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Load evidence text' }));
    expect(await within(dialog).findByText(/My manager confirmed the new turnaround/)).toBeTruthy();
    // Evidence on the action as a whole is not listed under one measure.
    expect(within(dialog).queryByText(/Set up the measures before the workshop/)).toBeNull();
    expect(calls[1]).toMatch(/\/events\/e1\/transfer-plans\/measures\?evidence=true$/);
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy();
  });

  it('filters by how far the results have come and by the action’s choice', async () => {
    stub();
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Show'), 'no_result');
    expect(screen.getByText('Nothing matches this filter.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Show'), 'updated');
    expect(screen.getByText('Turnaround time')).toBeTruthy();
    expect(screen.queryByText('Define measures before training')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Show'), 'not_yet_known');
    expect(screen.getByText('Define measures before training')).toBeTruthy();
    expect(screen.queryByText('Turnaround time')).toBeNull();
  });

  it('posts the shown rows to be formatted as a spreadsheet, and reports a refusal', async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
        });
        if (init?.method === 'POST') {
          return new Response(new Blob(['xlsx']), {
            status: 200,
            headers: { 'content-type': MEDIA_TYPE },
          });
        }
        return json({ rows: rows(false) });
      }),
    );
    // jsdom has no object URLs or real navigation, so the save is stubbed and the click ignored.
    const created: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        created.push('blob:x');
        return 'blob:x';
      }),
      revokeObjectURL: vi.fn(),
    });
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /Export to Excel/ }));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/v1/exports/workbook');
    const body = post.body as {
      filename: string;
      sheets: Array<{ name: string; header: string[]; rows: unknown[][] }>;
    };
    expect(body.filename).toBe('summit-business-measures');
    expect(body.sheets).toHaveLength(1);
    expect(body.sheets[0]!.header).toContain('Results recorded');
    // One row per measure, and one for the action without a measure.
    expect(body.sheets[0]!.rows).toHaveLength(2);
    expect(body.sheets[0]!.rows[0]![0]).toBe('Dee Legate');
    expect(body.sheets[0]!.rows[0]!.some((cell) => typeof cell === 'number')).toBe(true);
    expect(created).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the spreadsheet cannot be created', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return json({ error: { code: 'forbidden', message: 'Admins only.' } }, 403);
        }
        return json({ rows: rows(false) });
      }),
    );
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Export to Excel/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Admins only/);
  });
});
