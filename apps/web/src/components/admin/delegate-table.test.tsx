import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelegateTable } from './delegate-table';

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function stub(handler: Handler) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const res = handler(url, init);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const row = (id: string, name: string, status: string, organisation: string | null = 'Acme') => ({
  id,
  name,
  email: `${id}@example.com`,
  organisation,
  jobTitle: null,
  country: 'Nigeria',
  attendanceFormat: 'physical',
  capacity: 'individual',
  registrationStatus: status,
  registrationSource: 'eventbrite',
  externalRegistrationId: `R-${id}`,
  identityId: null,
  signedUpAt: null,
  importedAt: null,
  createdAt: '2026-10-30T10:00:00Z',
});
const COUNTS = { active: 2, pending: 1, cancelled: 0, duplicate: 0, test: 0 };

afterEach(() => vi.unstubAllGlobals());

describe('DelegateTable', () => {
  it('lists the active event’s delegates with counts, searches, filters, and changes a status through the API', async () => {
    const calls = stub((url, init) => {
      if (init?.method === 'PATCH') return { status: 200, body: { delegate: { id: 'd2' } } };
      const u = new URL(url, 'http://x');
      const q = u.searchParams.get('q');
      const status = u.searchParams.get('status');
      let delegates = [
        row('d1', 'Zara Zed', 'active'),
        row('d2', 'Adam Able', 'active'),
        row('d3', 'Mia Mid', 'pending', null),
      ];
      if (q) delegates = delegates.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
      if (status) delegates = delegates.filter((d) => d.registrationStatus === status);
      return {
        status: 200,
        body: { delegates, page: 1, pageSize: 50, total: delegates.length, counts: COUNTS },
      };
    });
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" />);
    const table = await screen.findByRole('table', { name: 'Delegates' });
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3
    expect(calls[0]?.url).toMatch(/\/events\/e1\/delegates\?/);
    const tiles = screen.getByRole('region', { name: 'Registrations by status' });
    expect(tiles.textContent).toMatch(/Active2/);
    expect(tiles.textContent).toMatch(/Pending1/);

    await user.click(screen.getByRole('button', { name: 'Pending (1)' }));
    expect(
      await within(await screen.findByRole('table', { name: 'Delegates' })).findByText('Mia Mid'),
    ).toBeTruthy();
    expect(screen.queryByText('Zara Zed')).toBeNull();
    expect(calls[calls.length - 1]?.url).toMatch(/status=pending/);

    await user.click(screen.getByRole('button', { name: 'All (3)' }));
    await user.type(screen.getByLabelText('Search'), 'adam');
    await user.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByText('Adam Able')).toBeTruthy();
    expect(calls[calls.length - 1]?.url).toMatch(/q=adam/);

    await user.selectOptions(screen.getByLabelText('Status of Adam Able'), 'cancelled');
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toBe('/api/v1/delegates/d2');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ registrationStatus: 'cancelled' });
    expect((await screen.findByRole('status')).textContent).toMatch(/Status set to cancelled/);
  });

  it('shows empty and error states safely', async () => {
    stub(() => ({
      status: 200,
      body: {
        delegates: [],
        page: 1,
        pageSize: 50,
        total: 0,
        counts: { active: 0, pending: 0, cancelled: 0, duplicate: 0, test: 0 },
      },
    }));
    const { unmount } = render(<DelegateTable eventId="e1" />);
    expect(await screen.findByText(/No delegates have been imported/)).toBeTruthy();
    unmount();
    vi.unstubAllGlobals();
    stub(() => ({
      status: 403,
      body: { error: { code: 'forbidden', message: 'no', requestId: 'r7' } },
    }));
    render(<DelegateTable eventId="e1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Only M.Bryan admins/);
    expect(alert.textContent).toMatch(/r7/);
  });
});
