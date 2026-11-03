import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReport } from './report-fixture';
import { ReportsPage } from './reports-page';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const events = [
  {
    id: 'draft-1',
    slug: 'next-year',
    name: 'Next year',
    startsOn: '2027-05-01',
    endsOn: '2027-05-02',
    timezone: 'Africa/Lagos',
    format: 'hybrid' as const,
    status: 'draft' as const,
  },
  {
    id: 'active-1',
    slug: 'summit',
    name: 'Summit',
    startsOn: '2026-11-12',
    endsOn: '2026-11-13',
    timezone: 'Africa/Lagos',
    format: 'hybrid' as const,
    status: 'active' as const,
  },
];

function stub(list = events) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/events')) return json({ events: list });
      if (url.includes('/reports/organisations')) return json({ organisations: [] });
      if (url.includes('/reports/')) return json({ report: makeReport() });
      return json({});
    }),
  );
  return calls;
}

describe('ReportsPage', () => {
  it('opens on the running event and offers every report for it', async () => {
    const calls = stub();
    render(<ReportsPage timezone="Africa/Lagos" />);

    // The draft event is listed first, but the page opens on the one that is running.
    expect((await screen.findByLabelText('Event')) as HTMLSelectElement).toBeTruthy();
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('active-1');
    // The report is fetched by an effect that runs after the event list arrives, so this waits
    // for the request rather than assuming it has already gone out when the select appears.
    await vi.waitFor(() =>
      expect(calls.some((u) => u === '/api/v1/events/active-1/reports/dashboard')).toBe(true),
    );

    const tabs = await screen.findByRole('tablist', { name: 'Report' });
    expect(tabs.textContent).toMatch(/Event dashboard/);
    expect(tabs.textContent).toMatch(/Immediate conference report/);
    expect(tabs.textContent).toMatch(/Follow-up report/);
    expect(tabs.textContent).toMatch(/Organisation report/);
    expect(tabs.textContent).toMatch(/Sponsor or partner report/);
    // The external ones say so before they are opened.
    expect(screen.getAllByText('approval required')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: 'Open the event dashboard' }).getAttribute('href'),
    ).toBe('/admin/events/active-1/dashboard');
  });

  it('rebuilds the report when another event is chosen', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<ReportsPage timezone="Africa/Lagos" />);
    await screen.findByRole('tablist', { name: 'Report' });

    await user.selectOptions(screen.getByLabelText('Event'), 'draft-1');
    await screen.findByRole('tablist', { name: 'Report' });
    expect(calls.some((u) => u === '/api/v1/events/draft-1/reports/dashboard')).toBe(true);
  });

  it('says so when there is no event to report on', async () => {
    stub([]);
    render(<ReportsPage timezone="Africa/Lagos" />);
    expect(await screen.findByText('No event to report on yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to events' }).getAttribute('href')).toBe(
      '/admin/events',
    );
    expect(screen.queryByRole('tablist', { name: 'Report' })).toBeNull();
  });

  it('shows the error state with a retry when the events cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'forbidden', message: 'Admins only.' } }, 403)),
    );
    render(<ReportsPage timezone="Africa/Lagos" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/admins/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
