import type { Metadata } from 'next';

import { MyEventsScreen } from '@/components/account/my-events';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { event } from '@/config/event';
import { loadMyEvents } from '@/lib/my-events-server';

export const metadata: Metadata = { title: 'My events' };

/** `/account/events`: every event linked to the delegate's identity (backlog E3-10, D7). */
export default async function MyEventsPage() {
  const initialEvents = await loadMyEvents();
  return (
    <>
      <AdminPageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/account' }, { label: 'My events' }]}
        title="My events"
        description="Every event you are registered for. Registration and attendance are shown separately; attendance is recorded at the conference."
      />
      <AdminContent>
        <MyEventsScreen initialEvents={initialEvents} contactEmail={event.contactEmail} />
      </AdminContent>
    </>
  );
}
