import type { EventReport } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReport } from './report-fixture';
import { ReportWorkspace } from './report-workspace';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(report: (url: string) => EventReport = () => makeReport()) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      });
      if (url.includes('/reports/organisations')) {
        return json({ organisations: [{ name: 'Acme', nominees: 2 }] });
      }
      if (init?.method === 'POST') return json({ approval: null }, 201);
      return json({ report: report(url) });
    }),
  );
  return calls;
}

const reportUrls = (calls: Array<{ url: string; method?: string }>) =>
  calls.filter((c) => !c.method && !c.url.includes('/organisations')).map((c) => c.url);

describe('ReportWorkspace', () => {
  it('loads the dashboard, offers the downloads and shows no approval controls', async () => {
    const calls = stub();
    render(<ReportWorkspace eventId="e1" timezone="Africa/Lagos" kinds={['dashboard']} />);
    expect(await screen.findByText('Event dashboard')).toBeTruthy();
    expect(reportUrls(calls)).toEqual(['/api/v1/events/e1/reports/dashboard']);
    expect(screen.queryByRole('tablist', { name: 'Report' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download the report' }).getAttribute('href')).toBe(
      '/api/v1/events/e1/reports/dashboard/export.md',
    );
    expect(
      screen.getByRole('link', { name: 'Download the figures (CSV)' }).getAttribute('href'),
    ).toBe('/api/v1/events/e1/reports/dashboard/export.csv');
    expect(screen.queryByRole('button', { name: /Approve these sections/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Delegate participation' })).toBeTruthy();
  });

  it('asks the server again when the filters or the sections change', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<ReportWorkspace eventId="e1" timezone="Africa/Lagos" kinds={['dashboard']} />);
    await screen.findByText('Event dashboard');
    await user.selectOptions(screen.getByLabelText('Attendance format'), 'physical');
    await screen.findByRole('region', { name: 'Delegate participation' });
    expect(reportUrls(calls).at(-1)).toBe('/api/v1/events/e1/reports/dashboard?format=physical');
    await user.type(screen.getByLabelText('Period from'), '2027-01-01');
    await screen.findByRole('region', { name: 'Delegate participation' });
    expect(reportUrls(calls).at(-1)).toMatch(/\?format=physical&from=2027-01-01$/);
    // Dropping a section names the rest, in report order.
    await user.click(screen.getByRole('checkbox', { name: 'Expectations and baseline' }));
    await screen.findByRole('region', { name: 'Delegate participation' });
    expect(reportUrls(calls).at(-1)).toMatch(
      /sections=participation%2Cexperience%2Cexpectations_end%2Ctransfer%2Cresults/,
    );
  });

  it('switches between report kinds and asks which organisation an organisation report is for', async () => {
    const calls = stub((url) =>
      makeReport({
        kind: url.includes('organisation') ? 'organisation' : 'conference',
        audience: url.includes('organisation') ? 'external' : 'internal',
        approval: url.includes('organisation')
          ? { required: true, current: null, covers: false }
          : null,
      }),
    );
    const user = userEvent.setup();
    render(
      <ReportWorkspace
        eventId="e1"
        timezone="Africa/Lagos"
        kinds={['conference', 'follow_up', 'organisation', 'sponsor']}
      />,
    );
    const tabs = await screen.findByRole('tablist', { name: 'Report' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([
      'Immediate conference report',
      'Follow-up report',
      'Organisation report',
      'Sponsor or partner report',
    ]);
    expect(reportUrls(calls).at(-1)).toBe('/api/v1/events/e1/reports/conference');

    await user.click(within(tabs).getByRole('tab', { name: 'Organisation report' }));
    expect(await screen.findByText('Choose the organisation')).toBeTruthy();
    expect(screen.getByText(/built from that organisation’s nominees only/)).toBeTruthy();
    // Nothing was requested without an organisation.
    expect(reportUrls(calls).some((u) => u.includes('reports/organisation'))).toBe(false);
    await user.selectOptions(screen.getByLabelText('Nominating organisation'), 'Acme');
    await screen.findByRole('region', { name: 'Delegate participation' });
    expect(reportUrls(calls).at(-1)).toMatch(/reports\/organisation\?organisation=Acme$/);
  });

  it('withholds the download of an unapproved external report and records the approval', async () => {
    let approved = false;
    const calls = stub(() =>
      makeReport({
        kind: 'sponsor',
        audience: 'external',
        sections: ['participation', 'transfer'],
        approval: approved
          ? {
              required: true,
              covers: true,
              current: {
                id: 'a1',
                sections: ['participation', 'transfer'],
                note: '',
                approvedAt: '2026-12-01T09:00:00.000Z',
                approvedBy: 'admin@example.com',
              },
            }
          : { required: true, current: null, covers: false },
      }),
    );
    const user = userEvent.setup();
    render(<ReportWorkspace eventId="e1" timezone="Africa/Lagos" kinds={['sponsor']} />);
    expect(await screen.findByText('Not approved')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download the report' })).toBeNull();
    expect(screen.getByText(/aggregates only, and M.Bryan must approve it/)).toBeTruthy();
    expect(screen.getByText(/never publishes or emails a report/)).toBeTruthy();

    await user.type(screen.getByLabelText('What was agreed (optional)'), 'Agreed on 1 December');
    approved = true;
    await user.click(screen.getByRole('button', { name: /Approve these sections for sharing/ }));
    const approval = calls.find((c) => c.method === 'POST')!;
    expect(approval.url).toBe('/api/v1/events/e1/reports/sponsor/approve');
    // A sponsor report's own default sections, in report order; no organisation for this kind.
    expect(approval.body).toEqual({
      sections: ['participation', 'experience', 'expectations_end', 'transfer', 'results'],
      note: 'Agreed on 1 December',
    });
    expect(await screen.findByText(/Approved for sharing\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download the report' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Withdraw the approval' }));
    expect(calls.filter((c) => c.method === 'POST').at(-1)!.url).toBe(
      '/api/v1/events/e1/reports/sponsor/revoke',
    );
  });

  it('shows the error state with a retry when the report cannot be built', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/organisations')) return json({ organisations: [] });
        return json({ error: { code: 'forbidden', message: 'Admins only.' } }, 403);
      }),
    );
    render(<ReportWorkspace eventId="e1" timezone="Africa/Lagos" kinds={['dashboard']} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/admins/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
