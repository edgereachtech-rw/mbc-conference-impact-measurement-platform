'use client';

import type { FeedbackInvitationResult, FeedbackInvitationState } from '@mbc/shared';
import { Loader2Icon, MailIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { consoleButton } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; state: FeedbackInvitationState }
  | { kind: 'error'; message: string };

/**
 * Emailing the session feedback form (task of 2026-11-03).
 *
 * The link and the QR code are already on this card; this sends them. Only the delegates recorded
 * checked in on the session's day can submit, so they are the only ones written to, and the counts here
 * say exactly who would receive what before anything goes out.
 */
export function FeedbackInvite({
  eventId,
  sessionId,
  sessionTitle,
}: {
  eventId: string;
  sessionId: string;
  sessionTitle: string;
}) {
  const base = `/events/${eventId}/feedback/sessions/${sessionId}/invitations`;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<FeedbackInvitationState>(base).then(
      (result) => setState({ kind: 'ready', state: result }),
      (e: unknown) =>
        setState({ kind: 'error', message: describeError(e, 'Could not be read.').message }),
    );
  }, [base]);

  useEffect(load, [load]);

  async function send(scope: 'not_sent' | 'not_submitted') {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await apiFetch<FeedbackInvitationResult>(`${base}/send`, {
        method: 'POST',
        body: JSON.stringify({ scope }),
      });
      setState({ kind: 'ready', state: result });
      setNotice(
        result.justSent === 0
          ? 'Nobody was waiting for the form.'
          : `Sent to ${result.justSent} delegate${result.justSent === 1 ? '' : 's'}${
              result.justFailed > 0 ? `, ${result.justFailed} could not be delivered` : ''
            }.`,
      );
    } catch (err) {
      setProblem(describeError(err, 'The form could not be sent.').message);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-xs text-corp-muted" role="status">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> Checking who attended…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="text-xs font-semibold text-brand-danger">
        {state.message}
      </p>
    );
  }

  const s = state.state;
  return (
    <div className="space-y-2 border-t border-corp-line pt-3">
      <p className="text-sm text-corp-text">
        <span className="font-semibold text-corp-ink">Email the form</span> to the {s.attended}{' '}
        delegate{s.attended === 1 ? '' : 's'} checked in on the day of this session.{' '}
        {s.invited > 0 ? `${s.invited} already sent. ` : ''}
        {s.submitted} answered so far.
      </p>

      {!s.sendable ? (
        <p role="note" className="text-xs text-corp-muted">
          {s.reason}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs font-semibold text-corp-green-text">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void send('not_sent')}
          disabled={busy || !s.sendable || s.notSent === 0}
          className={consoleButton({ variant: 'secondary', size: 'sm' })}
          aria-label={`Email the feedback form for ${sessionTitle} to delegates who have not been sent it`}
        >
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <MailIcon aria-hidden="true" />
          )}
          Send to {s.notSent} not yet sent
        </button>
        <button
          type="button"
          onClick={() => void send('not_submitted')}
          disabled={busy || !s.sendable || s.notSubmitted === 0}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
          aria-label={`Remind the delegates who have not answered for ${sessionTitle}`}
        >
          Remind {s.notSubmitted} who have not answered
        </button>
      </div>
    </div>
  );
}
