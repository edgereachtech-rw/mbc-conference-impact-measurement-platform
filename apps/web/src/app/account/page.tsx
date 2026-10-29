import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DelegateDashboard } from '@/components/account/delegate-dashboard';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { event } from '@/config/event';
import { countdownLine } from '@/lib/my-events';
import { loadMyEvents } from '@/lib/my-events-server';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * `/account` is the delegate dashboard: key figures, every event as a card, and where to go
 * next. The API decides what the session may see; this page only renders it.
 */
export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/signin?next=/account');
  const initialEvents = await loadMyEvents();
  const nextEvent = initialEvents?.find((e) => e.period === 'upcoming') ?? null;

  return (
    <>
      <AdminPageHeader
        title={`Welcome, ${session.displayName}`}
        description={
          nextEvent
            ? `${countdownLine(nextEvent)} This is your space to record what you take back to work.`
            : 'Your conference journey, in one place: check-ins, your transfer plan and follow-ups.'
        }
        actions={
          nextEvent ? (
            <Link
              href={`/account/events/${nextEvent.id}`}
              className="inline-flex min-h-tap items-center justify-center rounded-none bg-corp-green px-5 text-sm font-semibold text-white hover:bg-corp-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-green"
            >
              Open next event
            </Link>
          ) : null
        }
      />
      <AdminContent>
        <DelegateDashboard contactEmail={event.contactEmail} initialEvents={initialEvents} />
      </AdminContent>
    </>
  );
}
