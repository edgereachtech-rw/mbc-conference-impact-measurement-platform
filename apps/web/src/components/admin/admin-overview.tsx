'use client';

import { Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { describeError, type EventSummary, type ImportFeatureStatus } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[]; imports: ImportFeatureStatus }
  | { kind: 'error'; message: string };

const statusLabel: Record<EventSummary['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

/**
 * Live panels of the admin console: the events the admin can act on and the state of the import
 * release gates. Everything comes from admin-only API routes; the console shows what the API answers.
 */
export function AdminOverview() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ events: EventSummary[] }>('/events'),
      apiFetch<ImportFeatureStatus>('/imports/status'),
    ]).then(
      ([{ events }, imports]) => {
        if (!cancelled) setState({ kind: 'ready', events, imports });
      },
      (error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: describeError(error).message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading the console…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-corp-line bg-white p-5">
        <p className="font-semibold text-corp-ink">The console could not load</p>
        <p className="mt-1 text-sm text-corp-text">{state.message}</p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
          className="mt-4 inline-flex min-h-tap items-center rounded-full border border-corp-green px-5 text-sm font-semibold text-corp-green-text hover:bg-corp-green-soft"
        >
          Try again
        </button>
      </div>
    );
  }

  const { events, imports } = state;
  const gates: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: 'Uploads enabled in this environment',
      ok: imports.uploadsEnabled,
      detail: imports.uploadsEnabled
        ? 'IMPORT_UPLOADS_ENABLED is set'
        : 'IMPORT_UPLOADS_ENABLED is not set',
    },
    {
      label: 'Identity migration gate',
      ok: imports.migrationGatePassed,
      detail: imports.migrationGatePassed
        ? 'Latest durable report is a pass'
        : (imports.blockers[0] ?? 'No passing report yet'),
    },
    {
      label: 'Production imports',
      ok: false,
      detail: 'Disabled until the retention policy (OQ-22) and release gates are approved',
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="admin-events-title" className="space-y-3">
        <h2 id="admin-events-title" className="font-corporate text-h3 text-corp-ink">
          Events
        </h2>
        {events.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-corp-line bg-white p-5 text-sm text-corp-text">
            No events exist yet. Conference setup arrives with Increment 2; the seed creates ITTEC
            2026.
          </p>
        ) : (
          <ul
            className="divide-y divide-corp-line rounded-2xl border border-corp-line bg-white"
            aria-label="Events"
          >
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-corp-ink">{ev.name}</p>
                  <p className="text-sm text-corp-muted">
                    {ev.startsOn.slice(0, 10)} to {ev.endsOn.slice(0, 10)} · {ev.format}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={
                      ev.status === 'active'
                        ? 'rounded-full bg-corp-green-soft px-3 py-1 text-xs font-semibold text-corp-green-text'
                        : 'rounded-full bg-corp-surface px-3 py-1 text-xs font-semibold text-corp-muted'
                    }
                  >
                    {statusLabel[ev.status]}
                  </span>
                  {ev.status !== 'archived' ? (
                    <Link
                      href="/admin/imports"
                      className="inline-flex min-h-tap items-center rounded-full bg-corp-green px-4 text-sm font-semibold text-white hover:bg-corp-ink"
                    >
                      Import registrations
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-gates-title" className="space-y-3">
        <h2 id="admin-gates-title" className="font-corporate text-h3 text-corp-ink">
          Release gates
        </h2>
        <ul className="space-y-2" aria-label="Release gates">
          {gates.map((gate) => (
            <li
              key={gate.label}
              className="flex items-start gap-3 rounded-2xl border border-corp-line bg-white p-4"
            >
              <span
                aria-hidden="true"
                className={
                  gate.ok
                    ? 'mt-1 size-2.5 shrink-0 rounded-full bg-corp-green-bright'
                    : 'mt-1 size-2.5 shrink-0 rounded-full bg-corp-muted'
                }
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-corp-ink">
                  {gate.label}
                  <span className="sr-only">{gate.ok ? ' (passed)' : ' (not passed)'}</span>
                </p>
                <p className="text-sm text-corp-text">{gate.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
