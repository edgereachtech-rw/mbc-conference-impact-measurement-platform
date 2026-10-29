'use client';

import { Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import {
  describeError,
  formatDateTime,
  runStatusLabels,
  type EventSummary,
  type ImportFeatureStatus,
  type ImportRunSummary,
} from '@/lib/imports';

import { StatTile, StatusPill } from './page-header';

type State =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      events: EventSummary[];
      imports: ImportFeatureStatus;
      recent: ImportRunSummary[];
      recentEvent: EventSummary | null;
    }
  | { kind: 'error'; message: string };

const statusLabel: Record<EventSummary['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

/**
 * Overview panels: KPIs, events, the most recent imports of the current active event, and the
 * import release gates. Everything comes from admin-only routes; the console shows what the API
 * answers and decides nothing itself.
 */
export function AdminOverview() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ events }, imports] = await Promise.all([
        apiFetch<{ events: EventSummary[] }>('/events'),
        apiFetch<ImportFeatureStatus>('/imports/status'),
      ]);
      const recentEvent = events.find((e) => e.status === 'active') ?? events[0] ?? null;
      const recent = recentEvent
        ? (
            await apiFetch<{ runs: ImportRunSummary[] }>(`/events/${recentEvent.id}/imports`)
          ).runs.slice(0, 5)
        : [];
      return { events, imports, recent, recentEvent };
    })().then(
      (data) => {
        if (!cancelled) setState({ kind: 'ready', ...data });
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
      <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
        <p className="font-semibold text-corp-ink">The console could not load</p>
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

  const { events, imports, recent, recentEvent } = state;
  const active = events.filter((e) => e.status === 'active').length;
  const committed = recent.filter((r) => r.status === 'committed').length;
  const openConflicts = recent.reduce(
    (sum, r) => sum + (r.status === 'committed' ? (r.counts?.conflict ?? 0) : 0),
    0,
  );
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
    <div className="space-y-8">
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Events" value={events.length} hint={`${active} active`} />
        <StatTile
          label="Imports committed"
          value={committed}
          hint={recentEvent ? `latest 5 runs of ${recentEvent.name}` : 'no event yet'}
        />
        <StatTile
          label="Conflicts quarantined"
          value={openConflicts}
          tone={openConflicts > 0 ? 'attention' : 'neutral'}
          hint="in those runs"
        />
        <StatTile
          label="Uploads"
          value={imports.uploadsEnabled ? 'On' : 'Off'}
          tone={imports.uploadsEnabled ? 'positive' : 'neutral'}
          hint={imports.migrationGatePassed ? 'gate passed' : 'gate not passed'}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="admin-events-title" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="admin-events-title" className="font-corporate text-h3 text-corp-ink">
              Events
            </h2>
            <span className="text-xs text-corp-muted">{events.length} total</span>
          </div>
          {events.length === 0 ? (
            <p className="rounded-none border border-dashed border-corp-line bg-white p-5 text-sm text-corp-text">
              No events exist yet. Conference setup arrives with Increment 2; the seed creates ITTEC
              2026.
            </p>
          ) : (
            <div className="overflow-hidden rounded-none border border-corp-line bg-white">
              <table className="w-full text-sm" aria-label="Events">
                <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2">
                      Event
                    </th>
                    <th scope="col" className="hidden px-4 py-2 sm:table-cell">
                      Dates
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-corp-line">
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-corp-ink">{ev.name}</p>
                        <p className="text-xs text-corp-muted sm:hidden">
                          {ev.startsOn.slice(0, 10)} to {ev.endsOn.slice(0, 10)}
                        </p>
                      </td>
                      <td className="hidden px-4 py-3 text-corp-text sm:table-cell">
                        {ev.startsOn.slice(0, 10)} to {ev.endsOn.slice(0, 10)} · {ev.format}
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
                          Open event
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="admin-gates-title" className="space-y-3">
          <h2 id="admin-gates-title" className="font-corporate text-h3 text-corp-ink">
            Release gates
          </h2>
          <ul
            className="divide-y divide-corp-line rounded-none border border-corp-line bg-white"
            aria-label="Release gates"
          >
            {gates.map((gate) => (
              <li key={gate.label} className="flex items-start gap-3 p-4">
                <span
                  aria-hidden="true"
                  className={
                    gate.ok
                      ? 'mt-1.5 size-2.5 shrink-0 rounded-full bg-corp-green-bright'
                      : 'mt-1.5 size-2.5 shrink-0 rounded-full bg-corp-muted'
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

      <section aria-labelledby="admin-recent-title" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="admin-recent-title" className="font-corporate text-h3 text-corp-ink">
            Recent imports{recentEvent ? ` · ${recentEvent.name}` : ''}
          </h2>
          <Link
            href="/admin/imports"
            className="text-sm font-semibold text-corp-green-text hover:underline"
          >
            All imports
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="rounded-none border border-dashed border-corp-line bg-white p-5 text-sm text-corp-text">
            No import runs yet for this event.
          </p>
        ) : (
          <div className="overflow-hidden rounded-none border border-corp-line bg-white">
            <table className="w-full text-sm" aria-label="Recent imports">
              <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    File
                  </th>
                  <th scope="col" className="hidden px-4 py-2 md:table-cell">
                    When
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                  <th scope="col" className="hidden px-4 py-2 text-right sm:table-cell">
                    New
                  </th>
                  <th scope="col" className="hidden px-4 py-2 text-right sm:table-cell">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Conflicts
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-corp-line">
                {recent.map((run) => (
                  <tr key={run.id}>
                    <td className="max-w-[12rem] truncate px-4 py-3 font-medium text-corp-ink">
                      {run.fileName}
                    </td>
                    <td className="hidden px-4 py-3 text-corp-text md:table-cell">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        tone={
                          run.status === 'committed'
                            ? 'positive'
                            : run.status === 'discarded'
                              ? 'neutral'
                              : 'attention'
                        }
                      >
                        {runStatusLabels[run.status]}
                      </StatusPill>
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                      {run.counts?.accepted ?? '–'}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                      {run.counts?.updated ?? '–'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {run.counts?.conflict ?? '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
