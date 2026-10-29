'use client';

import type { MyEvent } from '@mbc/shared';
import Link from 'next/link';

import { StatTile } from '@/components/admin/page-header';
import { formatEventDates, shortEventName } from '@/lib/my-events';

import { EventCardGrid } from './event-cards';
import { MyEventsStatus, useMyEvents } from './my-events';

interface Props {
  contactEmail: string;
  /** The list as the page loaded it on the server; null when that failed (the browser retries). */
  initialEvents?: MyEvent[] | null;
}

/**
 * Dashboard content (`/account`): key figures, every event as a card with its View more button,
 * and the help note. Everything about events comes from `GET /me/events`; the page holds no
 * event facts of its own.
 */
export function DelegateDashboard({ contactEmail, initialEvents }: Props) {
  const { state, retry } = useMyEvents(initialEvents);
  const events = state.kind === 'ready' ? state.events : [];
  const upcoming = events.filter((e) => e.period === 'upcoming');
  const past = events.filter((e) => e.period === 'past');
  const nextEvent = upcoming[0] ?? null;
  const ordered = [...upcoming, ...past];

  return (
    <div className="space-y-8">
      {state.kind === 'ready' ? (
        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Next event"
            value={nextEvent ? shortEventName(nextEvent.name) : '–'}
            hint={
              nextEvent ? formatEventDates(nextEvent.startsOn, nextEvent.endsOn) : 'none upcoming'
            }
            tone={nextEvent ? 'positive' : 'neutral'}
          />
          <StatTile label="Upcoming" value={upcoming.length} hint="events you are registered for" />
          <StatTile label="Past" value={past.length} hint="events you took part in" />
          <StatTile label="Attendance" value="–" hint="recorded at the conference" />
        </section>
      ) : null}

      <section aria-labelledby="dashboard-events-title" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="dashboard-events-title" className="font-corporate text-h3 text-corp-ink">
            Your events
          </h2>
          <Link
            href="/account/events"
            className="text-sm font-semibold text-corp-green-text hover:underline"
          >
            All my events
          </Link>
        </div>
        {state.kind !== 'ready' || events.length === 0 ? (
          <MyEventsStatus state={state} contactEmail={contactEmail} onRetry={retry} />
        ) : (
          <EventCardGrid events={ordered} label="Your events" />
        )}
      </section>

      <aside
        className="rounded-none border border-corp-green-line bg-corp-accent-soft p-4 text-sm text-corp-ink"
        aria-label="Help"
      >
        Need a correction to your registration or a different email? Write to{' '}
        <a href={`mailto:${contactEmail}`} className="font-semibold text-corp-green-text underline">
          {contactEmail}
        </a>
        . Nothing changes on your account without the organiser team.
      </aside>
    </div>
  );
}
