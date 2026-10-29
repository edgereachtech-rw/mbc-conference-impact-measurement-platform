import type { Metadata } from 'next';

import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { ImportWizard } from '@/components/imports/import-wizard';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Registration imports' };

/**
 * Admin import screen (E2-1). The page decides only what to render; every request the screen
 * makes is authorised by the API, so hiding the tool is a courtesy, not the access control.
 */
export default async function ImportsPage() {
  const session = await getSession();
  const access = importsAccess(session);

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[{ label: 'Overview', href: '/admin' }, { label: 'Imports' }]}
        title="Registration imports"
        description="Bring an event's registrations in from a CSV or XLSX export: map the columns, review the preview, then confirm. Attendance is never imported."
      />
      <AdminContent>
        {access === 'allowed' ? (
          <div className="rounded-none border border-corp-line bg-white p-4 md:p-6">
            <ImportWizard />
          </div>
        ) : (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">
              Registration imports are run by M.Bryan admins. Your account does not have that role.
            </p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
