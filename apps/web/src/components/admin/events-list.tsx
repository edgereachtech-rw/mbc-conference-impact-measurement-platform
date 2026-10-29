'use client';

import { Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { describeError, type EventSummary } from '@/lib/imports';

import { StatusPill } from './page-header';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'error'; message: string };

const statusLabel: Record<EventSummary['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};
const formatLabel: Record<EventSummary['format'], string> = {
  physical: 'In person',
  virtual: 'Online',
  hybrid: 'Hybrid',
};

/** Every event the admin can work on, each opening its own page with details and delegates. */
export function EventsList() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ events: EventSummary[] }>('/events').then(
      ({ events }) => {
        if (!cancelled) setState({ kind: 'ready', events });
      },
      (e: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: describeError(e).message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading events…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
        <p className="font-semibold text-corp-ink">Events unavailable</p>
        <p className="mt-1 text-sm text-corp-text">{state.message}</p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
          className="mt-4 inline-flex min-h-tap items-center rounded-none border border-corp-green px-5 text-sm font-semibold text-corp-green-text hover:bg-corp-green-soft"
        >
          Try again
        </button>
      </div>
    );
  }
  if (state.events.length === 0) {
    return (
      <p className="rounded-none border border-dashed border-corp-line bg-white p-5 text-sm text-corp-text">
        No events exist yet. Conference setup arrives with Increment 2; the seed creates ITTEC 2026.
      </p>
    );
  }

  return (
    <div className="overflow-hidden border border-corp-line bg-white">
      <table className="w-full text-sm" aria-label="Events">
        <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2">
              Event
            </th>
            <th scope="col" className="hidden px-4 py-2 sm:table-cell">
              Dates
            </th>
            <th scope="col" className="hidden px-4 py-2 md:table-cell">
              Format
            </th>
            <th scope="col" className="px-4 py-2">
              Status
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-corp-line">
          {state.events.map((ev) => (
            <tr key={ev.id}>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/events/${ev.id}`}
                  className="font-semibold text-corp-ink hover:underline"
                >
                  {ev.name}
                </Link>
                <p className="text-xs text-corp-muted sm:hidden">
                  {ev.startsOn.slice(0, 10)} to {ev.endsOn.slice(0, 10)}
                </p>
              </td>
              <td className="hidden px-4 py-3 text-corp-text sm:table-cell">
                {ev.startsOn.slice(0, 10)} to {ev.endsOn.slice(0, 10)}
              </td>
              <td className="hidden px-4 py-3 text-corp-text md:table-cell">
                {formatLabel[ev.format]}
              </td>
              <td className="px-4 py-3">
                <StatusPill tone={ev.status === 'active' ? 'positive' : 'neutral'}>
                  {statusLabel[ev.status]}
                </StatusPill>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/admin/events/${ev.id}`}
                  className="text-sm font-semibold text-corp-green-text hover:underline"
                >
                  View details →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
