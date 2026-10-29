'use client';

import { Loader2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import {
  describeError,
  formatDateTime,
  runStatusLabels,
  type ImportRunSummary,
  type RunDetail,
  type StoredRow,
} from '@/lib/imports';

import { ConflictQueue } from './conflict-queue';
import { CountSummary, RowTable } from './preview-panel';

interface RunHistoryProps {
  eventId: string;
  /** Bumped by the parent after a commit so the list refreshes. */
  refreshKey: number;
}

/** Past runs of the event (D3 step 7): who, when, file, counts, outcome, rows and report. */
export function RunHistory({ eventId, refreshKey }: RunHistoryProps) {
  const [runs, setRuns] = useState<ImportRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<StoredRow[] | null>(null);

  // The effect only starts the request; state is written when the API answers.
  // The effect subscribes to the request and writes state when the API answers.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ runs: ImportRunSummary[] }>(`/events/${eventId}/imports`),
      apiFetch<{ conflicts: StoredRow[] }>(`/events/${eventId}/imports/conflicts`),
    ]).then(
      ([{ runs }, { conflicts }]) => {
        if (cancelled) return;
        setRuns(runs);
        setConflicts(conflicts);
      },
      (e: unknown) => {
        if (cancelled) return;
        setRuns(null);
        setError(describeError(e, 'We could not load the import history.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, refreshKey, attempt]);
  const load = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  async function openRun(id: string) {
    setLoadingRun(id);
    try {
      setOpen(await apiFetch<RunDetail>(`/imports/${id}`));
    } catch (e) {
      setError(describeError(e, 'We could not load that run.').message);
    } finally {
      setLoadingRun(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="History unavailable"
        description={error}
        action={
          <Button type="button" variant="outline" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!runs) {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading history…
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No imports yet"
        description="Runs for this event will be listed here with their counts and outcome."
      />
    );
  }

  return (
    <div className="space-y-6">
      <ul
        className="divide-y divide-brand-line rounded-lg border border-brand-line bg-card"
        aria-label="Import runs"
      >
        {runs.map((run) => (
          <li
            key={run.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="truncate font-medium text-brand-text">{run.fileName}</p>
              <p className="text-sm text-brand-muted">
                {formatDateTime(run.createdAt)} · source “{run.source}” · {run.rowCount} rows
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  variant={
                    run.status === 'committed'
                      ? 'success'
                      : run.status === 'discarded'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {runStatusLabels[run.status]}
                </Badge>
                {run.counts ? (
                  <span className="text-brand-muted">
                    {run.counts.accepted} new · {run.counts.updated} updated · {run.counts.linked}{' '}
                    linked · {run.counts.rejected} rejected · {run.counts.conflict} conflicts
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void openRun(run.id)}
                disabled={loadingRun === run.id}
              >
                {loadingRun === run.id ? 'Loading…' : 'View rows'}
              </Button>
              <a
                className="inline-flex h-11 items-center rounded-md border border-brand-primary/40 px-4 text-sm font-medium text-brand-primary"
                href={`/api/v1/imports/${run.id}/report.csv`}
                download
              >
                Report (CSV)
              </a>
            </div>
          </li>
        ))}
      </ul>

      {open ? (
        <section className="space-y-4" aria-label={`Rows of ${open.run.fileName}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-h3">{open.run.fileName}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
          {open.run.counts ? <CountSummary counts={open.run.counts} /> : null}
          <RowTable rows={open.rows} caption={`Rows of ${open.run.fileName}`} />
        </section>
      ) : null}

      <section className="space-y-3" aria-label="Open conflicts">
        <h3 className="text-h3">Open conflicts</h3>
        <p className="text-sm text-brand-muted">
          Quarantined rows from committed runs. Each decision is validated on the server against the
          unique-email and reservation rules and recorded in the audit log.
        </p>
        <ConflictQueue
          conflicts={conflicts ?? []}
          onResolved={(result) => {
            load();
            if (open && open.run.id === result.row.runId) void openRun(open.run.id);
          }}
        />
      </section>
    </div>
  );
}
