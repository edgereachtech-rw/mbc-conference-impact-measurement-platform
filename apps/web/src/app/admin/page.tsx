import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminOverview } from '@/components/admin/admin-overview';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin console' };

/** Console overview: KPIs, events, recent imports and release gates, all from admin-only routes. */
export default async function AdminPage() {
  const session = await getSession();
  const access = importsAccess(session);

  return (
    <>
      <AdminPageHeader
        title={`Welcome, ${session?.displayName ?? ''}`}
        description="Conference operations for the organiser team: registrations, accounts, audit and, later, the dashboard."
        actions={
          access === 'allowed' ? (
            <Link
              href="/admin/imports"
              className="inline-flex min-h-tap items-center justify-center rounded-none bg-corp-green px-5 text-sm font-semibold text-white hover:bg-corp-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-green"
            >
              New import
            </Link>
          ) : null
        }
      />
      <AdminContent>
        {access === 'allowed' ? (
          <AdminOverview />
        ) : (
          <div className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Speaker account</p>
            <p className="mt-1 text-sm">
              The console tools are for M.Bryan admins. Session feedback for your own sessions
              arrives with Increment 3.
            </p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
