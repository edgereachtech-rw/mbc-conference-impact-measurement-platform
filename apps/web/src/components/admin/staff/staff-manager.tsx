'use client';

import { staffRoles, type StaffRole } from '@mbc/shared';
import { Loader2Icon, UserPlusIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import {
  consoleButton,
  Panel,
  StatePanel,
  StatTile,
  StatusPill,
  TableScroll,
} from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface StaffAccount {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
  lastSignInAt: string | null;
  createdAt: string;
}

interface Props {
  /** The signed-in admin, so the screen never offers to lock them out of their own account. */
  currentUserId: string;
  timezone: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; staff: StaffAccount[] }
  | { kind: 'error'; message: string; requestId?: string };

export const staffRoleLabels: Record<StaffRole, string> = {
  admin: 'Admin',
};
/** Safe under noUncheckedIndexedAccess, and readable if a role is ever added to the API first. */
const labelOf = (role: StaffRole | undefined) => (role ? (staffRoleLabels[role] ?? role) : 'staff');

/** The one assignable role (E3-9); every other role on an account is retired and cannot sign in. */
const ONLY_ROLE: StaffRole = 'admin';
const roleHint = 'Full access: events, delegates, imports, reports and staff accounts.';

/**
 * Staff accounts (backlog E3-9): who can sign in to the console. Admin is the only staff role, so
 * there is nothing to choose: an admin adds another admin by email — no password to set and nothing
 * sent automatically; the new admin signs in with the same one-time link every account uses.
 * Accounts are deactivated and reactivated here, and the API ends that person's sessions at once so
 * the change takes effect immediately. Every change is audited. An admin can never deactivate their
 * own account. An account still carrying a retired role (analyst, support, speaker) is shown so it
 * can be deactivated; it cannot sign in, and this screen never promotes it to admin (D8 item 7).
 */
export function StaffManager({ currentUserId, timezone }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [version, setVersion] = useState(0);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ staff: StaffAccount[] }>('/staff').then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', staff: r.staff });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'The staff accounts could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const created = await apiFetch<{ account: StaffAccount }>('/staff', {
        method: 'POST',
        body: JSON.stringify({ email, role: ONLY_ROLE }),
      });
      setNotice(
        `${created.account.email} can now sign in as ${labelOf(ONLY_ROLE).toLowerCase()}. Tell them to use the sign-in page with this address; no password is set and nothing was emailed automatically.`,
      );
      setEmail('');
      refresh();
    } catch (err) {
      setProblem(describeError(err, 'The account could not be created.').message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(account: StaffAccount, body: { status: 'active' | 'inactive' }) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await apiFetch(`/staff/${account.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setNotice(
        body.status === 'inactive'
          ? `${account.email} can no longer sign in, and any session they had is closed.`
          : `${account.email} can sign in again.`,
      );
      refresh();
    } catch (err) {
      setProblem(describeError(err, 'The account could not be changed.').message);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading')
    return <StatePanel kind="loading" title="Loading staff accounts…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Staff unavailable"
        description={state.message}
        requestId={state.requestId}
        action={
          <button
            type="button"
            onClick={refresh}
            className={consoleButton({ variant: 'secondary' })}
          >
            Try again
          </button>
        }
      />
    );
  }

  const admins = state.staff.filter((s) => s.role === 'admin' && s.status === 'active');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile
          label="Staff accounts"
          value={state.staff.length}
          hint="Everyone who can sign in to the console"
        />
        <StatTile
          label="Active admins"
          value={admins.length}
          tone={admins.length > 1 ? 'positive' : 'attention'}
          hint={
            admins.length > 1
              ? 'More than one, so nobody is a single point of failure'
              : 'Add a second admin so access never rests on one account'
          }
        />
        <StatTile
          label="Deactivated"
          value={state.staff.filter((s) => s.status === 'inactive').length}
          hint="Kept for the audit trail; cannot sign in"
        />
      </div>

      <Panel>
        <h2 className="font-corporate text-sm font-semibold text-corp-ink">Add an admin</h2>
        <p className="mt-1 text-sm text-corp-muted">
          An account is the email address, nothing else: admin is the only staff role, and there is
          no password to set. The person signs in from the sign-in page with this address and
          receives a one-time link and code, exactly as delegates do. The platform sends them
          nothing automatically, so tell them the account exists.
        </p>
        {problem ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-brand-danger">
            {problem}
          </p>
        ) : null}
        <form
          onSubmit={(e) => void add(e)}
          className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
        >
          <div className="space-y-1">
            <label htmlFor={`${id}-email`} className="text-sm font-semibold text-corp-ink">
              Email address
            </label>
            <input
              id={`${id}-email`}
              type="email"
              required
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@organisation.com"
              className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy || email.trim() === ''}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlusIcon aria-hidden="true" />
            )}
            Add admin
          </button>
        </form>
        <p className="mt-2 text-xs text-corp-muted">{roleHint}</p>
        {notice ? (
          <p role="status" className="mt-3 text-sm font-semibold text-corp-green-text">
            {notice}
          </p>
        ) : null}
      </Panel>

      <Panel flush>
        <h2 className="border-b border-corp-line p-4 font-corporate text-sm font-semibold text-corp-ink">
          Staff accounts
        </h2>
        {state.staff.length === 0 ? (
          <p className="p-4 text-sm text-corp-muted">No staff account exists yet.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Last signed in</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-corp-line">
                {state.staff.map((account) => {
                  const self = account.id === currentUserId;
                  const assignable = (staffRoles as readonly string[]).includes(account.role);
                  return (
                    <tr key={account.id}>
                      <td className="px-4 py-2">
                        <p className="font-semibold text-corp-ink">{account.email}</p>
                        {self ? <p className="text-xs text-corp-muted">This is you</p> : null}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-corp-text">{labelOf(account.role as StaffRole)}</span>
                        {assignable ? null : (
                          <p className="text-xs text-corp-muted">
                            Retired role; this account cannot sign in
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill tone={account.status === 'active' ? 'positive' : 'attention'}>
                          {account.status === 'active' ? 'Active' : 'Deactivated'}
                        </StatusPill>
                      </td>
                      <td className="px-4 py-2 text-xs text-corp-muted">
                        {account.lastSignInAt
                          ? formatInstant(account.lastSignInAt, timezone)
                          : 'Never'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {self ? (
                          <span className="text-xs text-corp-muted">
                            You cannot deactivate your own account
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void patch(account, {
                                status: account.status === 'active' ? 'inactive' : 'active',
                              })
                            }
                            className={consoleButton({ variant: 'secondary', size: 'sm' })}
                          >
                            {account.status === 'active' ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        <p className="border-t border-corp-line p-4 text-xs text-corp-muted">
          Deactivating closes the person’s sessions at once and keeps the account for the audit
          trail; it is never deleted. Admin is the only staff role, so there is no role to change
          here: an account carrying a retired role is deactivated rather than promoted. Delegate
          accounts are not shown here: they come from the event’s registrations.
        </p>
      </Panel>
    </div>
  );
}
