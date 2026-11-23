import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelegateTable } from './delegate-table';

const row = (id: string, name: string, status: 'active' | 'cancelled') => ({
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
const COUNTS = { active: 2, pending: 0, cancelled: 1, duplicate: 0, test: 0 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

/** The welcome pack to the ticked delegates (2026-11-23). */
describe('DelegateTable: welcome pack to a selection', () => {
  it('asks once more, sends to exactly the ticked delegates, and says who was left out', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        if (url.includes('/onboarding/send')) {
          return json(
            {
              eligible: 2,
              sent: 2,
              pending: 0,
              failed: 0,
              notSignedIn: 2,
              lastSentAt: null,
              justSent: 2,
              justFailed: 0,
            },
            201,
          );
        }
        if (url.includes('/batches')) return json({ batches: [] });
        return json({
          delegates: [
            row('d1', 'Ada', 'active'),
            row('d2', 'Ben', 'active'),
            row('d3', 'Cal', 'cancelled'),
          ],
          page: 1,
          pageSize: 50,
          total: 3,
          counts: COUNTS,
        });
      }),
    );
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" />);
    await screen.findByRole('table', { name: 'Delegates' });

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Ben' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Cal' }));
    await user.click(screen.getByRole('button', { name: 'Send welcome pack' }));
    // Nothing is sent on the first press.
    expect(calls.some((c) => c.url.includes('/onboarding/send'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm: send 3 welcome packs' }));

    const send = calls.find((c) => c.url.endsWith('/events/e1/onboarding/send'));
    expect(send?.body).toEqual({ scope: 'selected', delegateIds: ['d1', 'd2', 'd3'] });
    expect(
      await screen.findByText(
        /Welcome pack sent to 2 delegates; 1 not sent \(only active and test registrations get a pack\)\./,
      ),
    ).toBeTruthy();
    // The selection is cleared with it.
    expect(screen.queryByRole('button', { name: 'Send welcome pack' })).toBeNull();
  });

  it('refuses "all matching": only an explicit selection gets the pack', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/batches')
          ? json({ batches: [] })
          : json({
              delegates: [row('d1', 'Ada', 'active')],
              page: 1,
              pageSize: 50,
              total: 60,
              counts: { ...COUNTS, active: 60 },
            }),
      ),
    );
    const user = userEvent.setup();
    render(<DelegateTable eventId="e1" />);
    await screen.findByRole('table', { name: 'Delegates' });
    await user.click(screen.getByRole('checkbox', { name: 'Select Ada' }));
    await user.click(screen.getByRole('button', { name: /Select all 60 matching/ }));
    expect(
      (screen.getByRole('button', { name: 'Send welcome pack' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
