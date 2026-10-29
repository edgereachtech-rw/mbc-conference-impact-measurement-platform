import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EventDetail } from '@/components/account/event-detail';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { event as eventConfig } from '@/config/event';
import { countdownLine } from '@/lib/my-events';
import { loadMyEvent } from '@/lib/my-events-server';

export const metadata: Metadata = { title: 'Event' };

/**
 * `/account/events/:eventId`: one of the delegate's events in full, served by
 * `GET /me/events/:eventId`, which answers 404 for any event the session is not registered for.
 */
export default async function MyEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await loadMyEvent(eventId);
  if (!event) notFound();

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/account' },
          { label: 'My events', href: '/account/events' },
          { label: event.name },
        ]}
        title={event.name}
        description={event.theme ? `${event.theme}. ${countdownLine(event)}` : countdownLine(event)}
      />
      <AdminContent>
        <EventDetail event={event} contactEmail={eventConfig.contactEmail} />
      </AdminContent>
    </>
  );
}
