import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EventSettings } from '@/components/admin/event-setup/event-settings';
import { AdminContent, AdminPageHeader, StatusPill } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { loadAdminEvent } from '@/lib/admin-events';
import {
  eventFormatLabels,
  eventStatusLabels,
  eventTypeLabels,
  formatDateShort,
} from '@/lib/events';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Event' };

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await getSession();
  const access = importsAccess(session);
  const event = access === 'allowed' ? await loadAdminEvent(eventId) : null;
  if (access === 'allowed' && !event) notFound();

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[
          { label: 'Overview', href: '/admin' },
          { label: 'Events', href: '/admin/events' },
          { label: event?.name ?? 'Event' },
        ]}
        eyebrow={event ? `${eventTypeLabels[event.eventType]} · ${event.code}` : undefined}
        title={event?.name ?? 'Event'}
        description={event?.theme ?? event?.description}
        meta={
          event ? (
            <>
              <StatusPill tone={event.status === 'active' ? 'positive' : 'neutral'}>
                {eventStatusLabels[event.status]}
              </StatusPill>
              <StatusPill tone="neutral">{eventFormatLabels[event.format]}</StatusPill>
              <span className="text-xs text-corp-muted">
                {event.dates.length
                  ? event.dates.map((d) => formatDateShort(d.date)).join(', ')
                  : 'No dates'}{' '}
                · {event.timezone}
              </span>
            </>
          ) : null
        }
        actions={
          event && event.status !== 'archived' ? (
            <Link href="/admin/imports" className={consoleButton({ variant: 'accent' })}>
              Import registrations
            </Link>
          ) : null
        }
      />
      <AdminContent>
        {access !== 'allowed' || !event ? (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">Events are managed by M.Bryan admins.</p>
          </div>
        ) : (
          <EventSettings initialEvent={event} />
        )}
      </AdminContent>
    </>
  );
}
