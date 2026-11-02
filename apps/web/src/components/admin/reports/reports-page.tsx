'use client';

import { reportKindMeta, reportKinds } from '@mbc/shared';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { consoleButton, Panel, StatePanel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatDateShort } from '@/lib/events';
import { describeError, type EventSummary } from '@/lib/imports';

import { ReportWorkspace } from './report-workspace';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * Every report in one place (task of 2026-11-02): choose an event, then any of the five reports
 * for it — the dashboard, the immediate conference report, the follow-up report, and the
 * organisation and sponsor reports that need M.Bryan's approval before they can be shared. The
 * same workspace is reachable from each event's own Reports tab; this page exists so the
 * organisers do not have to go through an event to find it.
 */
export function ReportsPage({ timezone }: { timezone: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [eventId, setEventId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ events: EventSummary[] }>('/events').then(
      (r) => {
        if (cancelled) return;
        setState({ kind: 'ready', events: r.events });
        // Open on the event most likely to be wanted: the latest one that is running.
        const first = r.events.find((e) => e.status === 'active') ?? r.events[0];
        setEventId((current) => current || (first?.id ?? ''));
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'The events could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === 'loading') return <StatePanel kind="loading" title="Loading events…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Reports unavailable"
        description={state.message}
        requestId={state.requestId}
        action={
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={consoleButton({ variant: 'secondary' })}
          >
            Try again
          </button>
        }
      />
    );
  }
  if (state.events.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No event to report on yet"
        description="Reports are built from an event's own records. Create an event and its delegates first."
        action={
          <Link href="/admin/events" className={consoleButton({ variant: 'secondary' })}>
            Go to events
          </Link>
        }
      />
    );
  }

  const chosen = state.events.find((e) => e.id === eventId) ?? null;

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`${id}-event`} className="text-sm font-semibold text-corp-ink">
              Event
            </label>
            <NativeSelect
              id={`${id}-event`}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="rounded-none border-corp-line"
            >
              {state.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {formatDateShort(e.startsOn)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {chosen ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={chosen.status === 'active' ? 'positive' : 'neutral'}>
                {chosen.status}
              </StatusPill>
              <Link
                href={`/admin/events/${chosen.id}/dashboard`}
                className={consoleButton({ variant: 'ghost', size: 'sm' })}
              >
                Open the event dashboard
              </Link>
            </div>
          ) : null}
        </div>
        <dl className="mt-4 grid gap-2 border-t border-corp-line pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {reportKinds.map((kind) => (
            <div key={kind}>
              <dt className="font-semibold text-corp-ink">
                {reportKindMeta[kind].label}
                {reportKindMeta[kind].audience === 'external' ? (
                  <span className="ml-2 font-normal text-brand-danger">approval required</span>
                ) : null}
              </dt>
              <dd className="text-corp-muted">{reportKindMeta[kind].description}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {chosen ? (
        <ReportWorkspace
          key={chosen.id}
          eventId={chosen.id}
          timezone={chosen.timezone || timezone}
          kinds={reportKinds}
          readOnly={chosen.status === 'archived'}
        />
      ) : null}
    </div>
  );
}
