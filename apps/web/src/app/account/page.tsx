import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DelegateHero, JourneyStrip } from '@/components/account/delegate-hero';
import { MyEvents } from '@/components/account/my-events';
import { buttonVariants } from '@/components/ui/button';
import { event } from '@/config/event';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'My events' };

/**
 * `/account` is the delegate home: My Events (backlog D7) under the conference identity. The API
 * decides what the session may see; this page only renders it. Staff accounts are pointed to the
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
        <JourneyStrip />
        <section aria-labelledby="my-events-title" className="space-y-3">
          <div className="space-y-1">
            <h2 id="my-events-title" className="text-h2">
              My events
            </h2>
            <p className="text-sm text-brand-muted">
              Your registrations and attendance are shown separately: attendance is recorded during
              the conference, never from a registration.
            </p>
          </div>
          <MyEvents contactEmail={event.contactEmail} />
        </section>
        <p className="text-sm text-brand-muted">
          Need a correction to your registration?{' '}
          <Link
            href={`mailto:${event.contactEmail}`}
            className={buttonVariants({ variant: 'link', size: 'sm' })}
          >
            Write to {event.contactEmail}
          </Link>
        </p>
      </div>
    </main>
  );
}
