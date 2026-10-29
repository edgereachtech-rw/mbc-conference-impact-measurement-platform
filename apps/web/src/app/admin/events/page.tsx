import type { Metadata } from 'next';

import { EventsList } from '@/components/admin/events-list';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Events' };

/** Events the organiser team runs; each opens its own page with details and the delegate list. */
export default async function EventsPage() {
  const session = await getSession();
  const access = importsAccess(session);

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[{ label: 'Overview', href: '/admin' }, { label: 'Events' }]}
        title="Events"
        description="Open an event to see its details, registrations and import history."
      />
      <AdminContent>
        {access === 'allowed' ? (
          <EventsList />
        ) : (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">Events are managed by M.Bryan admins.</p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
