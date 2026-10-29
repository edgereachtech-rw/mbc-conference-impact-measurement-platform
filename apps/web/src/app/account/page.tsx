import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DelegateHero, JourneyStrip } from '@/components/account/delegate-hero';
import { MyEvents } from '@/components/account/my-events';
import { event } from '@/config/event';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'My events' };

/**
 * `/account` is the delegate home: My Events (backlog D7) under the conference identity. The API
 * decides what the session may see; this page only renders it. Staff accounts are sent to the
 * admin console, which has its own identity.
 */
export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/signin?next=/account');
  if (session.role !== 'delegate') redirect('/admin');

  return (
    <main className="flex flex-1 flex-col">
      <DelegateHero
        displayName={session.displayName}
        participationMode={session.participationMode}
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-gutter py-6 md:px-6 md:py-10">
        <section aria-labelledby="my-events-title" className="space-y-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
            <h2 id="my-events-title" className="text-h2">
              My events
            </h2>
            <p className="text-sm text-brand-muted">
              Registration and attendance are shown separately; attendance is recorded at the
              conference.
            </p>
          </div>
          <MyEvents contactEmail={event.contactEmail} />
        </section>
        <JourneyStrip />
        <aside
          className="rounded-lg border border-brand-line bg-surface-tint p-4 text-sm text-brand-muted"
          aria-label="Help"
        >
          Need a correction to your registration or a different email? Write to{' '}
          <a
            href={`mailto:${event.contactEmail}`}
            className="font-medium text-brand-primary underline"
          >
            {event.contactEmail}
          </a>
          . Nothing changes on your account without the organiser team.
        </aside>
      </div>
    </main>
  );
}
