import type { EventDetail, SupportRequestView, SupportRequests } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportManager } from './support-manager';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const event = { id: 'e1', timezone: 'Africa/Lagos' } as EventDetail;

function request(partial: Partial<SupportRequestView> = {}): SupportRequestView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    eventId: 'e1',
    delegate: {
      id: 'd1',
      name: 'Dee Legate',
      email: 'dee@example.com',
      organisation: 'First City Monument Bank',
    },
    source: 'follow_up',
    kind: 'support',
    context: '30-day follow-up',
    action: 'Introduce a tracking process',
    request: 'An introduction to the HR director.',
    barrier: 'HR has not agreed the time.',
    status: 'open',
    actionTaken: '',
    addressedBy: null,
    addressedAt: null,
    createdAt: '2026-12-15T09:00:00.000Z',
    updatedAt: '2026-12-15T09:00:00.000Z',
    ...partial,
  };
}

describe('SupportManager', () => {
  it('lists open requests with their barrier and source, records the action taken and marks one addressed', async () => {
    let current: SupportRequests = {
      requests: [
        request(),
        request({
          id: '22222222-2222-4222-8222-222222222222',
          source: 'delegate',
          context: 'Transfer plan page',
          action: null,
          request: 'A short call with someone who has set up tracking before.',
          barrier: 'HR has not agreed the time.',
          status: 'addressed',
          actionTaken: 'Introduced to a 2025 delegate.',
          addressedBy: 'admin@example.com',
          addressedAt: '2026-12-16T10:00:00.000Z',
        }),
      ],
      counts: { open: 1, addressed: 1, openSupport: 1, openBarriers: 0 },
      barriers: [{ text: 'HR has not agreed the time.', count: 2 }],
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as { status: string; actionTaken: string };
          current = {
            ...current,
            requests: current.requests.map((r) =>
              r.id === current.requests[0]!.id
                ? {
                    ...r,
                    status: body.status as SupportRequestView['status'],
                    actionTaken: body.actionTaken,
                    addressedAt: '2026-12-17T09:00:00.000Z',
                    addressedBy: 'admin@example.com',
                  }
                : r,
            ),
            counts: { open: 0, addressed: 2, openSupport: 0, openBarriers: 0 },
          };
          return json({ request: current.requests[0] });
        }
        return json(current);
      }),
    );
    const user = userEvent.setup();
    render(<SupportManager event={event} />);

    // Open ones first by default, with where they came from and the barrier beside them.
    const list = await screen.findByRole('list', { name: 'Support requests' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toMatch(/Dee Legate · First City Monument Bank/);
    expect(items[0]!.textContent).toMatch(/30-day follow-up · From a follow-up answer/);
    expect(items[0]!.textContent).toMatch(/Action: Introduce a tracking process/);
    expect(items[0]!.textContent).toMatch(/Barrier named with it: HR has not agreed the time\./);
    expect(screen.getByText('Open support requests').parentElement?.textContent).toMatch(/1/);
    expect(
      within(screen.getByRole('list', { name: 'Barriers' })).getByText(/2 delegates/),
    ).toBeTruthy();

    // The addressed one is a filter away, with what was done and by whom.
    await user.click(screen.getByRole('button', { name: 'Addressed' }));
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toMatch(
      /Action taken: Introduced to a 2025 delegate\. \(addressed 16 Dec 2026.*by admin@example\.com\)/,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));

    // Recording the action taken marks the request addressed.
    await user.click(within(list).getByRole('button', { name: 'Record the action taken' }));
    const dialog = await screen.findByRole('dialog', { name: 'Support for Dee Legate' });
    await user.type(within(dialog).getByLabelText('Action taken'), 'Call arranged for Friday.');
    expect((within(dialog).getByLabelText('Addressed') as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Mark addressed' }));
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toBe(`/api/v1/events/e1/support-requests/${request().id}`);
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      status: 'addressed',
      actionTaken: 'Call arranged for Friday.',
    });
    expect((await screen.findByRole('status')).textContent).toMatch(/marked addressed/);
    await vi.waitFor(() => expect(screen.getByText(/Nothing open/)).toBeTruthy());
  });
});
