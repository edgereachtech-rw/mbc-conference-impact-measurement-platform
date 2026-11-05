import type { DelegateListItem } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelegateTable } from './delegate-table';

const row = (id: string, name: string, status: DelegateListItem['registrationStatus']) => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  organisation: null,
  jobTitle: null,
  country: null,
  attendanceFormat: 'physical' as const,
  capacity: 'individual' as const,
  registrationStatus: status,
  registrationSource: null,
  externalRegistrationId: null,
  identityId: null,
  signedUpAt: null,
  importedAt: null,
  createdAt: '2026-11-05T00:00:00Z',
});
const COUNTS = { active: 2, pending: 0, cancelled: 0, duplicate: 0, test: 1 };

afterEach(() => vi.unstubAllGlobals());

/** Test delegates (decision of 2026-11-05): marked from the list, by explicit selection only. */
describe('DelegateTable: marking test delegates', () => {
  it('marks the ticked delegates through the API, says what changed, and reloads', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    let lists = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const u = new URL(url, 'http://x');
        if (u.pathname.endsWith('/delegates/test')) {
          return new Response(JSON.stringify({ updated: 2, skipped: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        lists += 1;
        const delegates = [
          row('d1', 'Ada', lists === 1 ? 'active' : 'test'),
          row('d2', 'Ben', lists === 1 ? 'active' : 'test'),
          row('d3', 'Cal', 'test'),
        ];
        return new Response(
          JSON.stringify({ delegates, page: 1, pageSize: 50, total: 3, counts: COUNTS }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" />);
    await screen.findByRole('table', { name: 'Delegates' });

    // Nothing ticked: the buttons are not offered yet (the selection bar only appears with one).
    expect(screen.queryByRole('button', { name: 'Mark as test delegates' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Ben' }));
    await user.click(screen.getByRole('button', { name: 'Mark as test delegates' }));

    const mark = calls.find((c) => c.url.endsWith('/events/e1/delegates/test'));
    expect(mark).toMatchObject({ method: 'POST', body: { delegateIds: ['d1', 'd2'], test: true } });
    expect(await screen.findByText(/2 marked as test delegates/)).toBeTruthy();
    // The list is read again, so the new status shows without a manual refresh.
    expect(lists).toBe(2);
    // The selection is cleared, so the marking buttons go with it.
    expect(screen.queryByRole('button', { name: 'Mark as test delegates' })).toBeNull();
  });

  it('refuses "all matching": only an explicit selection can be marked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              delegates: [row('d1', 'Ada', 'active')],
              page: 1,
              pageSize: 50,
              total: 60,
              counts: { ...COUNTS, active: 60 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" />);
    await screen.findByRole('table', { name: 'Delegates' });
    await user.click(screen.getByRole('checkbox', { name: 'Select Ada' }));
    await user.click(screen.getByRole('button', { name: /Select all 60 matching/ }));
    expect(
      (screen.getByRole('button', { name: 'Mark as test delegates' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
