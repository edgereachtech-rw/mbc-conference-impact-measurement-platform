import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EventDashboard } from '@/components/admin/event-dashboard';
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

export const metadata: Metadata = { title: 'Event dashboard' };

/** The event's summary page: delegates, assessment stages and messages at a glance. */
export default async function EventDashboardPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
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
          { label: event?.name ?? 'Event', href: event ? `/admin/events/${event.id}` : undefined },
          { label: 'Dashboard' },
        ]}
        eyebrow={event ? `${eventTypeLabels[event.eventType]} · ${event.code}` : undefined}
        title={event ? `${event.name}: dashboard` : 'Dashboard'}
        description="Delegates, assessment stages and messages at a glance."
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
          event ? (
            <Link
              href={`/admin/events/${event.id}`}
              className={consoleButton({ variant: 'secondary' })}
            >
              Manage event
            </Link>
          ) : null
        }
      />
      <AdminContent>
        {access !== 'allowed' || !event ? (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">Event dashboards are for M.Bryan admins.</p>
          </div>
        ) : (
          <EventDashboard eventId={event.id} timezone={event.timezone} />
        )}
      </AdminContent>
    </>
  );
}
