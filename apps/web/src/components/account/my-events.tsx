'use client';

import type { MyEvent, MyEventsResponse } from '@mbc/shared';
import { CalendarDaysIcon, Loader2Icon, MapPinIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ParticipationBadge } from '@/components/badges/participation-badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: MyEvent[] }
  | { kind: 'error'; message: string; requestId?: string };

function formatDates(startsOn: string, endsOn: string): string {
  const start = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  };
  if (startsOn === endsOn) return start.toLocaleDateString(undefined, opts);
  const sameMonth = startsOn.slice(0, 7) === endsOn.slice(0, 7);
  if (sameMonth) {
    return `${start.getUTCDate()}-${end.toLocaleDateString(undefined, opts)}`;
  }
  return `${start.toLocaleDateString(undefined, opts)} to ${end.toLocaleDateString(undefined, opts)}`;
}

const formatLabel = { physical: 'In person', virtual: 'Online', hybrid: 'Hybrid' } as const;

/**
 * My Events (E3-10, D7): every event with a registration linked to the signed-in identity, read
 * from the API which authorises the request; nothing is filtered in the browser.
 */
export function MyEvents({ contactEmail }: { contactEmail: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<MyEventsResponse>('/me/events').then(
      (result) => {
        if (!cancelled) setState({ kind: 'ready', events: result.events });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError) {
          setState({
            kind: 'error',
            message:
              error.status === 401
                ? 'Your session has ended. Sign in again to see your events.'
                : error.status === 403
                  ? 'My Events is for registered delegates.'
                  : error.status >= 500
                    ? 'We could not load your events. Try again in a moment or quote the request id when asking for help.'
                    : error.message,
            requestId: error.requestId,
          });
        } else {
          setState({
            kind: 'error',
            message: 'We could not reach the platform. Check your connection and try again.',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading your events…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <ErrorState
        title="Events unavailable"
        description={
          <>
            {state.message}
            {state.requestId ? (
              <span className="block text-xs">Request id {state.requestId}</span>
            ) : null}
          </>
        }
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setState({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }
  if (state.events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description={
          <>
            No registration is linked to your account at the moment. If you registered for a
            conference and expected to see it here, write to{' '}
            <a href={`mailto:${contactEmail}`} className="font-medium text-brand-primary underline">
              {contactEmail}
            </a>
            .
          </>
        }
      />
    );
  }

  const upcoming = state.events.filter((e) => e.period === 'upcoming');
  const past = state.events.filter((e) => e.period === 'past');
  return (
    <div className="space-y-8">
      {upcoming.length > 0 ? <EventGroup title="Upcoming" events={upcoming} /> : null}
      {past.length > 0 ? <EventGroup title="Past events" events={past} /> : null}
    </div>
  );
}

function EventGroup({ title, events }: { title: string; events: MyEvent[] }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-h2">{title}</h2>
      <ul className="space-y-3">
        {events.map((event) => (
          <li key={event.id}>
            <EventCard event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventCard({ event }: { event: MyEvent }) {
  const upcoming = event.period === 'upcoming';
  return (
    <article
      className={cn(
        'space-y-4 rounded-lg border border-brand-line bg-card p-4 shadow-card md:p-5',
        upcoming ? 'border-l-4 border-l-brand-primary' : 'border-l-4 border-l-brand-line',
      )}
      aria-label={event.name}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={upcoming ? 'accent' : 'outline'}>
              {upcoming ? 'Upcoming' : 'Past'}
            </Badge>
            <ParticipationBadge mode={event.registration.attendanceFormat} />
          </div>
          <h3 className="text-h3">{event.name}</h3>
          {event.theme ? <p className="text-sm text-brand-muted">{event.theme}</p> : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
        <div className="flex items-start gap-2">
          <CalendarDaysIcon
            className="mt-0.5 size-4 shrink-0 text-brand-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <dt className="text-xs text-brand-muted uppercase">Dates</dt>
            <dd className="font-medium text-brand-text">
              {formatDates(event.startsOn, event.endsOn)}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-brand-primary" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="text-xs text-brand-muted uppercase">Where</dt>
            <dd className="font-medium text-brand-text">
              {event.location ?? formatLabel[event.format]}
            </dd>
          </div>
        </div>
        <div>
          <dt className="text-xs text-brand-muted uppercase">Registration</dt>
          <dd className="mt-0.5">
            <Badge variant={event.registration.status === 'active' ? 'success' : 'outline'}>
              {event.registration.status === 'active' ? 'Registered' : 'Test registration'}
            </Badge>
            {event.registration.organisation ? (
              <span className="block truncate text-xs text-brand-muted">
                {event.registration.organisation}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-brand-muted uppercase">Attendance</dt>
          <dd className="mt-0.5">
            <Badge variant="outline">Not recorded</Badge>
          </dd>
        </div>
      </dl>
    </article>
  );
}
