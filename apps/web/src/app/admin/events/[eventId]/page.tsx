import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DelegateTable } from '@/components/admin/delegate-table';
import { AdminContent, AdminPageHeader, StatusPill } from '@/components/admin/page-header';
import { apiInternalUrl } from '@/lib/api';
import { importsAccess } from '@/lib/imports-access';
import type { EventSummary } from '@/lib/imports';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Event' };

interface EventDetail extends EventSummary {
  theme: string | null;
  location: string | null;
}

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

const statusLabel = { draft: 'Draft', active: 'Active', archived: 'Archived' } as const;
const formatLabel = { physical: 'In person', virtual: 'Online', hybrid: 'Hybrid' } as const;

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
        title={event?.name ?? 'Event'}
        description={event?.theme ?? undefined}
        actions={
          event && event.status !== 'archived' ? (
            <Link
              href="/admin/imports"
              className="inline-flex min-h-tap items-center justify-center rounded-none bg-corp-green px-5 text-sm font-semibold text-white hover:bg-corp-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-green"
            >
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
            <section aria-label="Event details" className="border border-corp-line bg-white">
              <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
                <div>
                  <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    Dates
                  </dt>
                  <dd className="mt-1 text-sm text-corp-ink">
                    {event.startsOn.slice(0, 10)} to {event.endsOn.slice(0, 10)}
                  </dd>
                  <dd className="text-xs text-corp-muted">{event.timezone}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    Venue
                  </dt>
                  <dd className="mt-1 text-sm text-corp-ink">{event.location ?? 'Not set'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    Format
                  </dt>
                  <dd className="mt-1 text-sm text-corp-ink">{formatLabel[event.format]}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    Status
                  </dt>
                  <dd className="mt-1">
                    <StatusPill tone={event.status === 'active' ? 'positive' : 'neutral'}>
                      {statusLabel[event.status]}
                    </StatusPill>
                  </dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="event-delegates-title" className="space-y-3">
              <h2 id="event-delegates-title" className="font-corporate text-h3 text-corp-ink">
                Delegates
              </h2>
              <DelegateTable eventId={event.id} />
            </section>
          </>
        )}
      </AdminContent>
    </>
  );
}
