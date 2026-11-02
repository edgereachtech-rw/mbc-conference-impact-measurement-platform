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

function rows(withEvidence: boolean): MeasureReportRow[] {
  return [
    {
      delegate,
      planStatus: 'submitted',
      action: {
        id: '44444444-4444-4444-8444-444444444444',
        order: 1,
        action: 'Brief stakeholders',
        isPriority: true,
        progressStatus: 'applied',
      },
      summary: 'with_result',
      measures: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          order: 1,
          status: 'identified',
          kind: 'quantitative',
          name: 'Turnaround time',
          importance: 'Clients wait for it',
          unit: 'days',
          direction: 'lower',
          baselineValue: '12',
          baselineOn: '2026-11-01',
          targetValue: '8',
          targetOn: '2027-03-31',
          actualValue: '9',
          actualOn: '2027-02-15',
          source: 'Monthly operations report',
          influences: '',
          support: 'self_reported',
          readings: [],
          updatedAt: '2027-02-16T10:00:00.000Z',
        },
      ],
      evidence: { self_reported: 1, supported: 1 },
      evidenceRecords: withEvidence
        ? [
            {
              id: '66666666-6666-4666-8666-666666666666',
              order: 1,
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
              type: 'example',
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
        action: 'Define measures before training',
        isPriority: false,
        progressStatus: 'not_started',
      },
      summary: 'none',
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
  it('shows what each action’s measures say, with evidence counted but not quoted until asked', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Actual result recorded')).toBeTruthy();
    expect(within(table).getByText('No measure recorded')).toBeTruthy();
    expect(screen.getByText('Improved')).toBeTruthy();
    expect(screen.getByText(/Change -3 days · target not yet reached/)).toBeTruthy();
    expect(screen.getByText('1 self-reported · 1 supported by another source')).toBeTruthy();
    expect(screen.queryByText(/My manager confirmed/)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatch(/evidence=true/);

    await user.click(screen.getByRole('button', { name: 'Load evidence text' }));
    expect(await screen.findByText(/My manager confirmed the new turnaround/)).toBeTruthy();
    expect(calls[1]).toMatch(/\/events\/e1\/transfer-plans\/measures\?evidence=true$/);
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy();
    expect(screen.getByText('Supported by: Line manager')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load evidence text' })).toBeNull();
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
        return json({ rows: rows(false), evidenceIncluded: false });
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
      title: string;
      sheets: Array<{ name: string; header: string[]; rows: unknown[][] }>;
    };
    expect(body.filename).toBe('summit-measures-and-evidence');
    expect(body.sheets).toHaveLength(1);
    expect(body.sheets[0]!.header[0]).toBe('Delegate');
    // One row per action (the second action has no measure, so it still gets a row).
    expect(body.sheets[0]!.rows).toHaveLength(2);
    expect(body.sheets[0]!.rows[0]![0]).toBe('Dee Legate');
    // The evidence counts travel as numbers so the spreadsheet can total them.
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
        return json({ rows: rows(false), evidenceIncluded: false });
      }),
    );
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Export to Excel/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Admins only/);
  });

  it('filters actions by what their measures say', async () => {
    stub();
    const user = userEvent.setup();
    render(<MeasuresReport eventId="e1" slug="summit" />);
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Actions whose measures are'), 'not_yet_known');
    expect(screen.getByText('No action matches this filter.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Actions whose measures are'), 'none');
    expect(screen.getByText('Define measures before training')).toBeTruthy();
    expect(screen.queryByText('Brief stakeholders')).toBeNull();
  });
});
