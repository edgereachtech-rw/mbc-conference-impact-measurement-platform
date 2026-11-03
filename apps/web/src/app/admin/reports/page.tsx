import type { Metadata } from 'next';

import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { ReportsPage } from '@/components/admin/reports/reports-page';
import { platform } from '@/config/platform';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Reports' };

/**
 * Every report in one place (backlog E15, E16): choose an event, then any of its reports. The
 * same workspace sits on each event's own Reports tab; this page saves going through the event.
 * The API authorises every request the screen makes, and external reports stay behind their
 * approval there, not here.
 */
export default async function AdminReportsPage() {
  const session = await getSession();
  const access = importsAccess(session);

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[{ label: 'Overview', href: '/admin' }, { label: 'Reports' }]}
        title="Reports"
        description="The event dashboard, the immediate conference report, the follow-up report, and the organisation and sponsor reports. Every figure carries its denominator; nothing leaves the platform until M.Bryan approves it."
      />
      <AdminContent>
        {access === 'allowed' ? (
          <ReportsPage timezone={platform.timezone} />
        ) : (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">
              Reports are produced by M.Bryan admins. Your account does not have that role.
            </p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
