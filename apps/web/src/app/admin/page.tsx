import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminOverview } from '@/components/admin/admin-overview';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin console' };

/**
 * Console overview: KPIs, events, recent imports and platform checks, all from admin-only routes.
 * Admin is the only staff role (2026-11-02), and `/admin/*` admits no delegate, so everyone who
 * reaches this page is an admin; the API authorises each request regardless.
 */
export default async function AdminPage() {
  const session = await getSession();

  return (
    <>
      <AdminPageHeader
        eyebrow="Overview"
        title={`Welcome back, ${session?.displayName ?? ''}`}
        description="Registrations, communications and release readiness for your events, in one place."
        actions={
          <Link href="/admin/imports" className={consoleButton({ variant: 'accent' })}>
            New import
          </Link>
        }
      />
      <AdminContent>
        <AdminOverview />
      </AdminContent>
    </>
  );
}
