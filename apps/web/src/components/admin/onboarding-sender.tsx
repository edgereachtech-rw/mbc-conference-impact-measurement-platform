'use client';

import type { OnboardingSendResult, OnboardingState } from '@mbc/shared';
import { Loader2Icon, SendIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { consoleButton, Panel, StatTile } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; state: OnboardingState }
  | { kind: 'error'; message: string };

/**
 * Sending the onboarding pack (task of 2026-11-03).
 *
 * The pack carries the welcome, what happens when, the delegate's attendance codes and their
 * card. Sending is deliberate — an admin presses the button — because nothing should email real
 * people as a side effect of an import. The default is to send only to delegates who have never
 * had one, so pressing it twice does not email anybody twice.
 */
export function OnboardingSender({ eventId, timezone }: { eventId: string; timezone: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<OnboardingState>(`/events/${eventId}/onboarding`).then(
      (result) => setState({ kind: 'ready', state: result }),
      (e: unknown) =>
        setState({
          kind: 'error',
          message: describeError(e, 'The onboarding state could not be read.').message,
        }),
    );
  }, [eventId]);

  useEffect(load, [load]);

  async function send(scope: 'not_yet_sent' | 'all') {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await apiFetch<OnboardingSendResult>(`/events/${eventId}/onboarding/send`, {
        method: 'POST',
        body: JSON.stringify({ scope }),
      });
      setState({ kind: 'ready', state: result });
      setNotice(
        result.justSent === 0 && result.justFailed === 0
          ? 'Nobody was waiting for a pack.'
          : `Sent ${result.justSent} pack${result.justSent === 1 ? '' : 's'}${
              result.justFailed > 0 ? `, ${result.justFailed} could not be delivered` : ''
            }.`,
      );
    } catch (err) {
      setProblem(describeError(err, 'The packs could not be sent.').message);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <Panel>
        <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      </Panel>
    );
  }
  if (state.kind === 'error') {
    return (
      <Panel>
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {state.message}
        </p>
      </Panel>
    );
  }

  const s = state.state;
  return (
    <Panel>
      <h3 className="font-corporate text-base font-semibold text-corp-ink">Onboarding pack</h3>
      <p className="mt-1 text-sm text-corp-muted">
        One email per delegate: what the platform is for, what happens before, during and after,
        their check-in codes for each day as images they can show at the door, and the card with
        their name on it. Nothing is sent until you press the button.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Delegates" value={s.eligible} hint="active registrations" />
        <StatTile
          label="Packs sent"
          value={s.sent}
          tone={s.sent > 0 ? 'positive' : 'neutral'}
          hint={s.lastSentAt ? `last ${formatInstant(s.lastSentAt, timezone)}` : 'none yet'}
        />
        <StatTile
          label="Waiting"
          value={s.pending}
          tone={s.pending > 0 ? 'attention' : 'positive'}
          hint="no pack yet"
        />
        <StatTile
          label="Failed"
          value={s.failed}
          tone={s.failed > 0 ? 'attention' : 'neutral'}
          hint="not delivered"
        />
      </div>

      {problem ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-semibold text-corp-green-text">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void send('not_yet_sent')}
          disabled={busy || s.pending === 0}
          className={consoleButton({ variant: 'accent' })}
        >
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <SendIcon aria-hidden="true" />
          )}
          Send to the {s.pending} waiting
        </button>
        <button
          type="button"
          onClick={() => void send('all')}
          disabled={busy || s.eligible === 0}
          className={consoleButton({ variant: 'secondary' })}
        >
          Send again to everyone
        </button>
      </div>
      <p className="mt-2 text-xs text-corp-muted">
        Sending again emails delegates who already have a pack. The codes never change, so a second
        pack carries the same ones.
      </p>
    </Panel>
  );
}
