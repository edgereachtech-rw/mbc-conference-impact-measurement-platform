'use client';

import {
  supportRequestStatusLabels,
  type MySupportRequest,
  type PlanActionView,
} from '@mbc/shared';
import { CheckCircle2Icon, LifeBuoyIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, Panel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatDateShort } from '@/lib/events';
import { describeError } from '@/lib/imports';

/**
 * "Need support?" on the delegate's plan page (brief 11.7; backlog E13-1): the delegate says
 * what help they need from M.Bryan or another stakeholder, what stands in the way, and which
 * planned action it concerns. Their earlier requests are listed with their status, so they can
 * see what was done.
 */
export function SupportRequestPanel({
  eventId,
  actions,
}: {
  eventId: string;
  actions: readonly Pick<PlanActionView, 'id' | 'action'>[];
}) {
  const [requests, setRequests] = useState<MySupportRequest[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ requests: MySupportRequest[] }>(`/me/events/${eventId}/support-requests`).then(
      (r) => {
        if (!cancelled) setRequests(r.requests);
      },
      // The box still offers the form when the list cannot be read; nothing is lost.
      () => {
        if (!cancelled) setRequests([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <Panel>
      <section aria-labelledby="support-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="support-title" className="font-corporate text-base font-semibold text-corp-ink">
              Need support to apply your plan?
            </h3>
            <p className="text-sm text-corp-muted">
              Ask M.Bryan for an introduction, advice or a resource. They see every request and
              record what they did about it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className={consoleButton({ variant: 'secondary', size: 'sm' })}
          >
            <LifeBuoyIcon aria-hidden="true" /> Request support
          </button>
        </div>
        {requests && requests.length > 0 ? (
          <ul aria-label="Your support requests" className="divide-y divide-corp-line text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-corp-text">{r.request}</p>
                  <p className="text-xs text-corp-muted">
                    {formatDateShort(r.createdAt.slice(0, 10))}
                    {r.action ? ` · ${r.action}` : ''}
                    {r.actionTaken ? ` · M.Bryan: ${r.actionTaken}` : ''}
                  </p>
                </div>
                <StatusPill tone={r.status === 'open' ? 'attention' : 'positive'}>
                  {supportRequestStatusLabels[r.status]}
                </StatusPill>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {asking ? (
        <AskDialog
          eventId={eventId}
          actions={actions}
          onClose={() => setAsking(false)}
          onSent={(created) => {
            setAsking(false);
            setRequests((list) => [created, ...(list ?? [])]);
            setDone(true);
          }}
        />
      ) : null}
      {done ? (
        <Dialog
          title="Request sent"
          onClose={() => setDone(false)}
          size="md"
          footer={
            <button
              type="button"
              onClick={() => setDone(false)}
              className={consoleButton({ variant: 'accent' })}
            >
              Close
            </button>
          }
        >
          <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
            <CheckCircle2Icon className="size-14 text-corp-green-text" aria-hidden="true" />
            <p className="text-sm text-corp-text">
              Thank you. M.Bryan has your request and will record what they do about it here.
            </p>
          </div>
        </Dialog>
      ) : null}
    </Panel>
  );
}

function AskDialog({
  eventId,
  actions,
  onClose,
  onSent,
}: {
  eventId: string;
  actions: readonly Pick<PlanActionView, 'id' | 'action'>[];
  onClose: () => void;
  onSent: (created: MySupportRequest) => void;
}) {
  const [request, setRequest] = useState('');
  const [barrier, setBarrier] = useState('');
  const [actionId, setActionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const named = actions.filter((a) => a.action.trim());

  async function send() {
    if (!request.trim()) {
      setError('Say what support you need.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ request: MySupportRequest }>(
        `/me/events/${eventId}/support-requests`,
        {
          method: 'POST',
          body: JSON.stringify({
            request: request.trim(),
            barrier: barrier.trim(),
            actionId: actionId || null,
          }),
        },
      );
      onSent(result.request);
    } catch (e) {
      setError(describeError(e, 'Your request could not be sent.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Request support"
      description="Say what would help you apply your plan. Do not include confidential organisational information."
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
            onClick={() => void send()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Send request
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor={`${id}-request`} className="text-sm font-semibold text-corp-ink">
            What support do you need? (required)
          </label>
          <textarea
            id={`${id}-request`}
            rows={4}
            maxLength={2000}
            value={request}
            disabled={busy}
            onChange={(e) => setRequest(e.target.value)}
            className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-barrier`} className="text-sm font-semibold text-corp-ink">
            What is standing in the way? (optional)
          </label>
          <textarea
            id={`${id}-barrier`}
            rows={3}
            maxLength={2000}
            value={barrier}
            disabled={busy}
            onChange={(e) => setBarrier(e.target.value)}
            className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
          />
        </div>
        {named.length > 0 ? (
          <div className="space-y-1">
            <label htmlFor={`${id}-action`} className="text-sm font-semibold text-corp-ink">
              Which planned action is it about? (optional)
            </label>
            <NativeSelect
              id={`${id}-action`}
              value={actionId}
              disabled={busy}
              onChange={(e) => setActionId(e.target.value)}
            >
              <option value="">Not about one action</option>
              {named.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.action}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-brand-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
