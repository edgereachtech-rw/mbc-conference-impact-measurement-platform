import type { Metadata } from 'next';

import { NewEventForm } from '@/components/admin/event-setup/new-event-form';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'New event' };

/** Create an event: profile and dates now, sessions and assessments on the event's page. */
export default async function NewEventPage() {
  const session = await getSession();
  const access = importsAccess(session);
  return (
    <>
      <AdminPageHeader
        breadcrumbs={[
          { label: 'Overview', href: '/admin' },
          { label: 'Events', href: '/admin/events' },
          { label: 'New event' },
        ]}
        eyebrow="Events"
        title="New event"
        description="Set up the profile and pick the dates. The event starts as a draft; add sessions and configure assessments on its page, then publish."
      />
      <AdminContent>
        {access === 'allowed' ? (
          <div className="rounded-none border border-corp-line bg-white p-4 md:p-6">
            <NewEventForm />
          </div>
        ) : (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">Events are created by M.Bryan admins.</p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
