'use client';

import {
  supportRequestSourceLabels,
  supportRequestStatusLabels,
  type EventDetail,
  type SupportRequestStatus,
  type SupportRequestView,
  type SupportRequests,
} from '@mbc/shared';
import { CheckCircle2Icon, Loader2Icon, RotateCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, Panel, StatePanel, StatTile, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: SupportRequests }
  | { kind: 'error'; message: string; requestId?: string };

type Filter = 'open' | 'addressed' | 'all';

/**
 * Transfer support (brief 11.7; backlog E13-2 to E13-5): who asked for support, what for, the
 * barrier behind it, what M.Bryan did, and whether it is still open. Requests arrive from
 * follow-up answers and from the delegate's plan page; here they are read and answered.
 */
export function SupportManager({ event }: { event: EventDetail }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<SupportRequestView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timezone = event.timezone;

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<SupportRequests>(`/events/${event.id}/support-requests`).then(
      (data) => {
        if (!cancelled) setState({ kind: 'ready', data });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Support requests could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id]);
  useEffect(() => load(), [load, attempt]);

  if (state.kind === 'loading')
    return <StatePanel kind="loading" title="Loading support requests…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Support requests unavailable"
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
  const { data } = state;
  const shown = data.requests.filter((r) => filter === 'all' || r.status === filter);

  return (
    <div className="space-y-6">
      <p className="text-sm text-corp-text">
        Delegates ask for support in their follow-ups and from their transfer plan page. Record what
        was done and mark each request addressed; reopen it if it comes back. Barriers are listed as
        the delegates wrote them.
      </p>
      {notice ? (
        <p role="status" className="text-sm font-semibold text-corp-green-text">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Open requests"
          value={data.counts.open}
          tone={data.counts.open ? 'attention' : 'neutral'}
        />
        <StatTile label="Addressed" value={data.counts.addressed} tone="positive" />
        <StatTile label="Barriers named" value={data.barriers.length} />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-corporate text-base font-semibold text-corp-ink">Requests</h3>
          <div role="group" aria-label="Show" className="flex gap-1">
            {(['open', 'addressed', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={consoleButton({
                  variant: filter === f ? 'secondary' : 'ghost',
                  size: 'sm',
                })}
              >
                {f === 'all' ? 'All' : supportRequestStatusLabels[f]}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-corp-muted">
            {filter === 'open' ? 'No open request. ' : 'Nothing here yet. '}
            Requests appear as delegates submit their follow-ups or ask from their plan page.
          </p>
        ) : (
          <ul aria-label="Support requests" className="mt-3 divide-y divide-corp-line">
            {shown.map((r) => (
              <li key={r.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-corp-ink">
                      {r.delegate.name}
                      {r.delegate.organisation ? ` · ${r.delegate.organisation}` : ''}
                    </p>
                    <p className="text-xs text-corp-muted">
                      {r.context} · {supportRequestSourceLabels[r.source]} ·{' '}
                      {formatInstant(r.createdAt, timezone)}
                      {r.action ? ` · Action: ${r.action}` : ''}
                    </p>
                  </div>
                  <StatusPill tone={r.status === 'open' ? 'attention' : 'positive'}>
                    {supportRequestStatusLabels[r.status]}
                  </StatusPill>
                </div>
                <p className="text-sm text-corp-text">
                  <span className="font-semibold text-corp-ink">Support requested: </span>
                  {r.request}
                </p>
                {r.barrier ? (
                  <p className="text-sm text-corp-text">
                    <span className="font-semibold text-corp-ink">Barrier: </span>
                    {r.barrier}
                  </p>
                ) : null}
                {r.actionTaken ? (
                  <p className="text-sm text-corp-text">
                    <span className="font-semibold text-corp-ink">Action taken: </span>
                    {r.actionTaken}
                    {r.addressedAt
                      ? ` (addressed ${formatInstant(r.addressedAt, timezone)}${r.addressedBy ? ` by ${r.addressedBy}` : ''})`
                      : ''}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className={consoleButton({
                    variant: r.status === 'open' ? 'accent' : 'ghost',
                    size: 'sm',
                  })}
                >
                  {r.status === 'open' ? (
                    <CheckCircle2Icon aria-hidden="true" />
                  ) : (
                    <RotateCcwIcon aria-hidden="true" />
                  )}
                  {r.status === 'open' ? 'Record the action taken' : 'Update or reopen'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h3 className="font-corporate text-base font-semibold text-corp-ink">Common barriers</h3>
        {data.barriers.length === 0 ? (
          <p className="mt-2 text-sm text-corp-muted">No barrier named yet.</p>
        ) : (
          <ul aria-label="Barriers" className="mt-2 space-y-1 text-sm text-corp-text">
            {data.barriers.map((b) => (
              <li key={b.text} className="flex items-start justify-between gap-3">
                <span>{b.text}</span>
                <span className="shrink-0 font-semibold text-corp-ink">
                  {b.count} {b.count === 1 ? 'delegate' : 'delegates'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing ? (
        <ActionDialog
          eventId={event.id}
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function ActionDialog({
  eventId,
  request,
  onClose,
  onSaved,
}: {
  eventId: string;
  request: SupportRequestView;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [actionTaken, setActionTaken] = useState(request.actionTaken);
  const [status, setStatus] = useState<SupportRequestStatus>(
    request.status === 'open' ? 'addressed' : 'open',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/events/${eventId}/support-requests/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, actionTaken: actionTaken.trim() }),
      });
      onSaved(status === 'addressed' ? 'Request marked addressed.' : 'Request reopened.');
    } catch (e) {
      setError(describeError(e, 'The request could not be updated.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Support for ${request.delegate.name}`}
      description={request.request}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={consoleButton({ variant: 'ghost' })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {status === 'addressed' ? 'Mark addressed' : 'Reopen'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor={`${id}-action`} className="text-sm font-semibold text-corp-ink">
            Action taken
          </label>
          <textarea
            id={`${id}-action`}
            rows={4}
            maxLength={4000}
            value={actionTaken}
            disabled={busy}
            onChange={(e) => setActionTaken(e.target.value)}
            className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-corp-ink">Status</legend>
          {(['addressed', 'open'] as const).map((s) => (
            <label key={s} className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
              <input
                type="radio"
                name={`${id}-status`}
                value={s}
                checked={status === s}
                disabled={busy}
                onChange={() => setStatus(s)}
                className="size-5 accent-corp-accent"
              />
              {supportRequestStatusLabels[s]}
            </label>
          ))}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-brand-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
