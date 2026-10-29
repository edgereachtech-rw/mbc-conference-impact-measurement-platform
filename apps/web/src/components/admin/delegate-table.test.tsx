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
const SENT = { messageId: 'm1', total: 2, sent: 2, failed: 0, skipped: 0 };

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

    expect(calls[0]?.url).toMatch(/pageSize=10/); // 10 rows by default
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
    expect(calls[calls.length - 1]?.url).toMatch(/pageSize=50&?/);
    expect(calls[calls.length - 1]?.url).toMatch(/page=1/);
  });

  it('selects delegates with checkboxes and emails exactly those through the composer', async () => {
    const calls = stub((_url, init) => {
      if (init?.method === 'POST') return { status: 201, body: SENT };
      const delegates = [
        row('d1', 'Zara Zed', 'active'),
        row('d2', 'Adam Able', 'active'),
        row('d4', 'Dup Licate', 'duplicate'),
      ];
      return {
        status: 200,
        body: { delegates, page: 1, pageSize: 50, total: 3, counts: COUNTS },
      };
    });
    const onMessageSent = vi.fn();
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" eventName="ITTEC 2026" onMessageSent={onMessageSent} />);
    await screen.findByRole('table', { name: 'Delegates' });
    expect(screen.queryByRole('region', { name: 'Selection' })).toBeNull();
    expect(screen.getByLabelText('Select Dup Licate')).toHaveProperty('disabled', true);

    await user.click(screen.getByLabelText('Select Zara Zed'));
    await user.click(screen.getByLabelText('Select Adam Able'));
    const bar = screen.getByRole('region', { name: 'Selection' });
    expect(bar.textContent).toMatch(/2 selected/);
    expect(within(bar).queryByRole('button', { name: /Select all/ })).toBeNull(); // page = everything

    await user.click(within(bar).getByRole('button', { name: 'Send email' }));
    const dialog = screen.getByRole('dialog', { name: 'New message' });
    expect(dialog.textContent).toMatch(/2 selected delegates/);
    await user.type(within(dialog).getByLabelText('Subject'), 'Hello');
    await user.type(within(dialog).getByLabelText('Message'), 'Dear {{{{firstName}}');
    await user.click(within(dialog).getByRole('button', { name: 'Send to 2 delegates' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    expect((await within(dialog).findByRole('status')).textContent).toMatch(/Sent to 2 delegates/);
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/v1/events/e1/messages');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      subject: 'Hello',
      body: 'Dear {{firstName}}',
      recipients: { delegateIds: ['d1', 'd2'] },
    });
    expect(onMessageSent).toHaveBeenCalledWith(SENT);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Selection' })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Message sent to 2 delegates/);
    expect(screen.getByLabelText('Select Zara Zed')).toHaveProperty('checked', false);
  });

  it('extends a page selection to every delegate matching the filter and sends by filter', async () => {
    const calls = stub((url, init) => {
      if (init?.method === 'POST') return { status: 201, body: { ...SENT, total: 120, sent: 120 } };
      const status = new URL(url, 'http://x').searchParams.get('status');
      const delegates =
        status === 'pending'
          ? [row('d3', 'Mia Mid', 'pending')]
          : [row('d1', 'Zara Zed', 'active'), row('d3', 'Mia Mid', 'pending')];
      return {
        status: 200,
        body: { delegates, page: 1, pageSize: 50, total: 120, counts: COUNTS },
      };
    });
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" eventName="ITTEC 2026" />);
    await screen.findByRole('table', { name: 'Delegates' });
    await user.click(screen.getByRole('button', { name: 'Pending (1)' }));
    await screen.findByLabelText('Select Mia Mid');
    await user.click(screen.getByLabelText('Select all on this page'));
    const bar = screen.getByRole('region', { name: 'Selection' });
    expect(bar.textContent).toMatch(/1 selected/);
    await user.click(within(bar).getByRole('button', { name: 'Select all 120 matching' }));
    expect(bar.textContent).toMatch(/All 120 delegates matching the current filter selected/);

    await user.click(within(bar).getByRole('button', { name: 'Send email' }));
    const dialog = screen.getByRole('dialog', { name: 'New message' });
    expect(dialog.textContent).toMatch(/all 120 delegates matching the current filter/);
    await user.type(within(dialog).getByLabelText('Subject'), 'Reminder');
    await user.type(within(dialog).getByLabelText('Message'), 'Please complete your registration.');
    await user.click(within(dialog).getByRole('button', { name: 'Send to 120 delegates' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await within(dialog).findByRole('status');
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body)).recipients).toEqual({
      filter: { status: 'pending' },
    });

    // Changing the filter drops the "all matching" extension.
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByLabelText('Select Mia Mid'));
    await user.click(screen.getByRole('button', { name: 'All (3)' }));
    expect(screen.getByRole('region', { name: 'Selection' }).textContent).toMatch(/1 selected/);
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
