import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StaffManager } from './staff-manager';

afterEach(() => vi.unstubAllGlobals());

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SPEAKER = '33333333-3333-4333-8333-333333333333';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const staff = [
  {
    id: ME,
    email: 'me@mbryan.com',
    role: 'admin',
    status: 'active',
    lastSignInAt: '2026-11-01T09:00:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: OTHER,
    email: 'ada@mbryan.com',
    role: 'admin',
    status: 'active',
    lastSignInAt: null,
    createdAt: '2026-10-02T09:00:00.000Z',
  },
  {
    id: SPEAKER,
    email: 'speaker@example.com',
    role: 'speaker',
    status: 'inactive',
    lastSignInAt: null,
    createdAt: '2026-10-03T09:00:00.000Z',
  },
];

function stub(onPost?: (body: unknown) => Response) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      calls.push({ url, method: init?.method, body });
      if (init?.method === 'POST') {
        return onPost
          ? onPost(body)
          : json({ account: { ...staff[1], email: 'new@mbryan.com' } }, 201);
      }
      if (init?.method === 'PATCH') return json({ account: staff[1] });
      return json({ staff });
    }),
  );
  return calls;
}

const manager = () => render(<StaffManager currentUserId={ME} timezone="Africa/Lagos" />);

describe('StaffManager', () => {
  it('lists who can sign in and as what, and counts the active admins', async () => {
    stub();
    manager();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('me@mbryan.com')).toBeTruthy();
    expect(within(table).getByText('ada@mbryan.com')).toBeTruthy();
    expect(within(table).getByText('Deactivated')).toBeTruthy();
    // Two accounts have never signed in; a date is shown only where there is one.
    expect(within(table).getAllByText('Never')).toHaveLength(2);
    const tiles = screen.getByText('Active admins').closest('div')!;
    expect(tiles.textContent).toMatch(/2/);
    expect(screen.getByText(/Delegate accounts are not shown here/)).toBeTruthy();
  });

  it('adds an admin by email alone and says what happens next', async () => {
    const calls = stub();
    const user = userEvent.setup();
    manager();
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Email address'), 'new@mbryan.com');
    // Admin is the only staff role, so there is nothing to pick: the address is the whole form.
    expect(screen.queryByLabelText('Role')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Add admin/ }));

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/v1/staff');
    expect(post.body).toEqual({ email: 'new@mbryan.com', role: 'admin' });
    const said = (await screen.findByRole('status')).textContent ?? '';
    expect(said).toMatch(/can now sign in as admin/);
    expect(said).toMatch(/no password is set and nothing was emailed automatically/);
    // The list is read again so the new account appears.
    expect(calls.filter((c) => !c.method && c.url === '/api/v1/staff')).toHaveLength(2);
  });

  it('reports a refusal from the server instead of pretending the account was created', async () => {
    stub(() =>
      json(
        { error: { code: 'conflict', message: 'An account with this email already exists.' } },
        409,
      ),
    );
    const user = userEvent.setup();
    manager();
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Email address'), 'me@mbryan.com');
    await user.click(screen.getByRole('button', { name: /Add admin/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never offers to deactivate the signed-in admin', async () => {
    stub();
    manager();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    const mine = rows.find((r) => r.textContent?.includes('me@mbryan.com'))!;
    expect(within(mine).getByText('This is you')).toBeTruthy();
    expect(within(mine).getByText(/cannot deactivate your own account/)).toBeTruthy();
    expect(within(mine).queryByRole('button')).toBeNull();
    expect(within(mine).queryByRole('combobox')).toBeNull();

    const other = rows.find((r) => r.textContent?.includes('ada@mbryan.com'))!;
    expect(within(other).getByRole('button', { name: 'Deactivate' })).toBeTruthy();
  });

  it('deactivates another account and says the sessions are closed', async () => {
    const calls = stub();
    const user = userEvent.setup();
    manager();
    const table = await screen.findByRole('table');
    const other = within(table)
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('ada@mbryan.com'))!;
    await user.click(within(other).getByRole('button', { name: 'Deactivate' }));

    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe(`/api/v1/staff/${OTHER}`);
    expect(patch.body).toEqual({ status: 'inactive' });
    expect((await screen.findByRole('status')).textContent).toMatch(
      /can no longer sign in, and any session they had is closed/,
    );
  });

  it('marks an account on a retired role and never offers to promote it', async () => {
    stub();
    manager();
    const table = await screen.findByRole('table');
    // Speaker was removed as a staff role on 2026-11-02; the account stays for the audit trail.
    const retired = within(table)
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('speaker@example.com'))!;
    expect(within(retired).getByText(/Retired role; this account cannot sign in/)).toBeTruthy();
    // No role picker anywhere: a retired account is deactivated, never promoted (D8 item 7).
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(within(retired).getByRole('button', { name: 'Reactivate' })).toBeTruthy();
  });

  it('shows the error state with a retry when the list cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'forbidden', message: 'Admins only.' } }, 403)),
    );
    manager();
    expect((await screen.findByRole('alert')).textContent).toMatch(/admins/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
