import type { MyEvent } from '@mbc/shared';
import { ArrowRightIcon, CalendarDaysIcon, MapPinIcon } from 'lucide-react';
import Link from 'next/link';

import { consoleButton, StatusPill } from '@/components/console/page';
import { attendanceFormatLabel, formatEventDates, formatWhereLabel } from '@/lib/my-events';
import { cn } from '@/lib/utils';

/** One event as a card: the facts at a glance and a button to the full view. */
export function EventCard({ event }: { event: MyEvent }) {
  const upcoming = event.period === 'upcoming';
  return (
    <article
      aria-label={event.name}
      className={cn(
        'flex w-full flex-col gap-4 rounded-none border border-corp-line bg-white p-4 shadow-panel transition-shadow hover:shadow-elevated md:p-5',
        upcoming ? 'border-l-4 border-l-corp-accent' : 'border-l-4 border-l-corp-line',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={upcoming ? 'positive' : 'neutral'}>
          {upcoming ? 'Upcoming' : 'Past'}
        </StatusPill>
        <StatusPill tone="neutral">
          {attendanceFormatLabel[event.registration.attendanceFormat]}
        </StatusPill>
        {event.registration.status === 'test' ? (
          <StatusPill tone="attention">Test registration</StatusPill>
        ) : null}
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="font-corporate text-base font-semibold text-corp-ink md:text-lg">
          {event.name}
        </h3>
        {event.theme ? <p className="text-sm text-corp-muted">{event.theme}</p> : null}
      </div>
      <dl className="grid gap-2 text-sm">
        <div className="flex items-start gap-2">
          <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-corp-muted" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="sr-only">Dates</dt>
            <dd className="text-corp-text">{formatEventDates(event.startsOn, event.endsOn)}</dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-corp-muted" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="sr-only">Where</dt>
            <dd className="truncate text-corp-text">
              {event.location ?? formatWhereLabel[event.format]}
            </dd>
          </div>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-corp-line pt-3 text-xs text-corp-muted">
        <span>
          Attendance: <span className="font-semibold text-corp-ink">not recorded</span>
        </span>
        <Link
          href={`/account/events/${event.id}`}
          className={consoleButton({ variant: 'secondary', size: 'sm' })}
        >
          View more <ArrowRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

/** Cards in a responsive grid: one column on phones, two from `md`, three from `xl`. */
export function EventCardGrid({ events, label }: { events: MyEvent[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {events.map((event) => (
        <li key={event.id} className="flex">
          <div className="flex w-full">
            <EventCard event={event} />
          </div>
        </li>
      ))}
    </ul>
  );
}
