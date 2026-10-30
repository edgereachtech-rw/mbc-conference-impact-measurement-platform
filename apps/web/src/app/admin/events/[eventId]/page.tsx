import type { EventDetail } from '@mbc/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EventSettings } from '@/components/admin/event-setup/event-settings';
import { EventWorkspace } from '@/components/admin/event-workspace';
import { AdminContent, AdminPageHeader, StatusPill } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { apiInternalUrl } from '@/lib/api';
import {
  eventFormatLabels,
  eventStatusLabels,
  eventTypeLabels,
  formatDateShort,
} from '@/lib/events';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Event' };

/** The event as the API serves it to this admin session, or null when it does not exist or is not allowed. */
async function loadEvent(eventId: string): Promise<EventDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const store = await cookies();
  const token = store.get('mbc_session')?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${apiInternalUrl()}/api/v1/events/${eventId}`, {
      headers: { cookie: `mbc_session=${encodeURIComponent(token)}`, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return ((await res.json()) as { event: EventDetail }).event;
  } catch {
    return null;
  }
}

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await getSession();
  const access = importsAccess(session);
  const event = access === 'allowed' ? await loadEvent(eventId) : null;
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
          <>
            <EventSettings initialEvent={event} />
            <EventWorkspace eventId={event.id} eventName={event.name} />
          </>
        )}
      </AdminContent>
    </>
  );
}
