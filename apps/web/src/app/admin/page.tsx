import { BarChart3Icon, ShieldCheckIcon, UploadIcon, UsersIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminOverview } from '@/components/admin/admin-overview';
import { MbryanLogo } from '@/components/brand/logo';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin console' };

interface ActionCard {
  title: string;
  description: string;
  href?: string;
  icon: ReactNode;
  state: 'ready' | 'soon';
}

const ACTIONS: ActionCard[] = [
  {
    title: 'Registration imports',
    description:
      'Upload a CSV or XLSX export, map the columns, review the preview, confirm, and resolve conflicts.',
    href: '/admin/imports',
    icon: <UploadIcon className="size-5" aria-hidden="true" />,
    state: 'ready',
  },
  {
    title: 'Staff accounts',
    description: 'Create admin and speaker accounts and deactivate them; every change is audited.',
    icon: <ShieldCheckIcon className="size-5" aria-hidden="true" />,
    state: 'soon',
  },
  {
    title: 'Delegate records',
    description: 'Search, correct and cancel registrations; invitations and account status.',
    icon: <UsersIcon className="size-5" aria-hidden="true" />,
    state: 'soon',
  },
  {
    title: 'Dashboard and reports',
    description: 'Core indicators, completion rates and exports arrive with Increment 5.',
    icon: <BarChart3Icon className="size-5" aria-hidden="true" />,
    state: 'soon',
  },
];

/**
 * Admin console in the M.Bryan corporate identity (slate ink, emerald actions, Inter), distinct
 * from the navy conference surfaces delegates see. The page decides only what to render; every
 * admin route is authorised by the API.
 */
export default async function AdminPage() {
  const session = await getSession();
  const access = importsAccess(session);
  if (access === 'signed-out') redirect('/signin?next=/admin');
  if (session?.role === 'delegate') redirect('/account');

  return (
    <main className="flex flex-1 flex-col bg-corp-surface font-corporate text-corp-text">
      <section className="bg-corp-ink-deep text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-gutter py-8 md:flex-row md:items-center md:justify-between md:px-6 md:py-10">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-[0.14em] text-corp-green-bright uppercase">
              M.Bryan admin console
            </p>
            <h1 className="font-corporate text-h1 text-white">Welcome, {session?.displayName}</h1>
            <p className="max-w-prose text-sm text-white/75 md:text-base">
              Signed in as{' '}
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-white uppercase">
                {session?.role}
              </span>
              . Conference operations for the organiser team: imports, accounts, audit and, later,
              the dashboard.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-white p-3">
            <MbryanLogo className="h-10" />
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-gutter py-8 md:px-6 md:py-10">
        {access === 'allowed' ? (
          <>
            <section aria-labelledby="admin-actions-title" className="space-y-3">
              <h2 id="admin-actions-title" className="font-corporate text-h3 text-corp-ink">
                What you can do
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {ACTIONS.map((action) => (
                  <li key={action.title}>
                    {action.href ? (
                      <Link
                        href={action.href}
                        className="flex h-full flex-col gap-2 rounded-2xl border border-corp-green-line bg-white p-4 transition-colors hover:bg-corp-green-soft focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-green"
                      >
                        <span className="flex size-10 items-center justify-center rounded-full bg-corp-green-soft text-corp-green-text">
                          {action.icon}
                        </span>
                        <span className="font-semibold text-corp-ink">{action.title}</span>
                        <span className="text-sm">{action.description}</span>
                        <span className="mt-auto text-sm font-semibold text-corp-green-text">
                          Open →
                        </span>
                      </Link>
                    ) : (
                      <div
                        className="flex h-full flex-col gap-2 rounded-2xl border border-dashed border-corp-line bg-white/60 p-4"
                        aria-label={`${action.title} (coming soon)`}
                      >
                        <span className="flex size-10 items-center justify-center rounded-full bg-corp-surface text-corp-muted">
                          {action.icon}
                        </span>
                        <span className="font-semibold text-corp-ink">{action.title}</span>
                        <span className="text-sm">{action.description}</span>
                        <span className="mt-auto rounded-full bg-corp-surface px-2 py-0.5 text-xs font-semibold text-corp-muted uppercase">
                          Coming soon
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <AdminOverview />
          </>
        ) : (
          <div className="rounded-2xl border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Speaker account</p>
            <p className="mt-1 text-sm">
              The console tools are for M.Bryan admins. Session feedback for your own sessions
              arrives with Increment 3.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
