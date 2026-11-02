import type { Metadata } from 'next';

import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { StaffManager } from '@/components/admin/staff/staff-manager';
import { event } from '@/config/event';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Staff accounts' };

/**
 * Staff accounts (backlog E3-9): an admin adds another admin, changes a role or deactivates an
 * account. The page decides only what to render; the API authorises every request it makes, so
 * hiding the screen is a courtesy, not the access control.
 */
export default async function StaffPage() {
  const session = await getSession();
  const access = importsAccess(session);

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[{ label: 'Overview', href: '/admin' }, { label: 'Staff' }]}
        title="Staff accounts"
        description="Who can sign in to the console, and as what. Adding an admin takes an email address: there is no password to set, and the account signs in with the same one-time link everyone else uses."
      />
      <AdminContent>
        {access === 'allowed' && session ? (
          <StaffManager currentUserId={session.user.id} timezone={event.timezone} />
        ) : (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">
              Staff accounts are managed by M.Bryan admins. Your account does not have that role.
            </p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
