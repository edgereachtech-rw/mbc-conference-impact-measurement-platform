'use client';

import type { MyEvent, MyEventsResponse } from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { apiFetch, ApiError } from '@/lib/api';

import { EventCardGrid } from './event-cards';

export type MyEventsState =
  | { kind: 'loading' }
  | { kind: 'ready'; events: MyEvent[] }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * My Events (E3-10, D7) from the API, which authorises the request; nothing is filtered in the
 * browser. The page passes the server-loaded list when it has one; `retry` reloads after an error.
 */
export function useMyEvents(initialEvents?: MyEvent[] | null): {
  state: MyEventsState;
  retry: () => void;
} {
  const [state, setState] = useState<MyEventsState>(
    initialEvents ? { kind: 'ready', events: initialEvents } : { kind: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);
  const serverLoaded = Boolean(initialEvents);

  useEffect(() => {
    // The page may have loaded the list on the server already; fetch only on a retry then.
    if (serverLoaded && attempt === 0) return;
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
  }, [attempt, serverLoaded]);

  return {
    state,
    retry: () => {
      setState({ kind: 'loading' });
      setAttempt((n) => n + 1);
    },
  };
}

/** Loading, error and empty states shared by the delegate screens; null when there is data. */
export function MyEventsStatus({
  state,
  contactEmail,
  onRetry,
}: {
  state: MyEventsState;
  contactEmail: string;
  onRetry: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading your events…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
        <p className="font-semibold text-corp-ink">Events unavailable</p>
        <p className="mt-1 text-sm text-corp-text">{state.message}</p>
        {state.requestId ? (
          <p className="mt-1 text-xs text-corp-muted">Request id {state.requestId}</p>
        ) : null}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-tap items-center rounded-none border border-corp-green px-5 text-sm font-semibold text-corp-green-text hover:bg-corp-green-soft"
        >
          Try again
        </button>
      </div>
    );
  }
  if (state.events.length === 0) {
    return (
      <div className="rounded-none border border-dashed border-corp-line bg-white p-5">
        <p className="font-semibold text-corp-ink">No events yet</p>
        <p className="mt-1 text-sm text-corp-text">
          No registration is linked to your account at the moment. If you registered for a
          conference and expected to see it here, write to{' '}
          <a
            href={`mailto:${contactEmail}`}
            className="font-semibold text-corp-green-text underline"
          >
            {contactEmail}
          </a>
          .
        </p>
      </div>
    );
  }
  return null;
}

/** The My events screen: every event as a card, upcoming first, then past. */
export function MyEventsScreen({
  initialEvents,
  contactEmail,
}: {
  initialEvents?: MyEvent[] | null;
  contactEmail: string;
}) {
  const { state, retry } = useMyEvents(initialEvents);
  if (state.kind !== 'ready' || state.events.length === 0) {
    return <MyEventsStatus state={state} contactEmail={contactEmail} onRetry={retry} />;
  }
  const upcoming = state.events.filter((e) => e.period === 'upcoming');
  const past = state.events.filter((e) => e.period === 'past');
  return (
    <div className="space-y-8">
      {upcoming.length > 0 ? (
        <section aria-labelledby="upcoming-title" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="upcoming-title" className="font-corporate text-h3 text-corp-ink">
              Upcoming
            </h2>
            <span className="text-xs text-corp-muted">{upcoming.length}</span>
          </div>
          <EventCardGrid events={upcoming} label="Upcoming events" />
        </section>
      ) : null}
      {past.length > 0 ? (
        <section aria-labelledby="past-title" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="past-title" className="font-corporate text-h3 text-corp-ink">
              Past events
            </h2>
            <span className="text-xs text-corp-muted">{past.length}</span>
          </div>
          <EventCardGrid events={past} label="Past events" />
        </section>
      ) : null}
    </div>
  );
}
