'use client';

import type { OnboardingScope, OnboardingSendResult, OnboardingState } from '@mbc/shared';
import { Loader2Icon, RotateCwIcon, SendIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { batchLabel, useEventBatches } from '@/components/admin/use-batches';
import { consoleButton, Panel, StatTile } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
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
 * people as a side effect of an import. The first button sends only to delegates who have never
 * had one, so pressing it twice does not email anybody twice. The second sends again to those who
 * have not signed in even once (2026-11-23); there is no "everyone". On an event in batches both
 * can be narrowed to one batch.
 */
export function OnboardingSender({ eventId, timezone }: { eventId: string; timezone: string }) {
  const batches = useEventBatches(eventId);
  const batchId = useId();
  const [chosen, setChosen] = useState('');
  // A batch that no longer exists reads as "All batches".
  const batch = batches.some((b) => b.id === chosen) ? chosen : '';
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = batch ? `?batch=${encodeURIComponent(batch)}` : '';
    apiFetch<OnboardingState>(`/events/${eventId}/onboarding${query}`).then(
      (result) => setState({ kind: 'ready', state: result }),
      (e: unknown) =>
        setState({
          kind: 'error',
          message: describeError(e, 'The onboarding state could not be read.').message,
        }),
    );
  }, [eventId, batch]);

  useEffect(load, [load]);

  async function send(scope: Exclude<OnboardingScope, 'selected'>) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await apiFetch<OnboardingSendResult>(`/events/${eventId}/onboarding/send`, {
        method: 'POST',
        body: JSON.stringify(batch ? { scope, batch } : { scope }),
      });
      setState({ kind: 'ready', state: result });
      setNotice(
        result.justSent === 0 && result.justFailed === 0
          ? scope === 'not_signed_in'
            ? 'Everyone has signed in; nothing was sent.'
            : 'Nobody was waiting for a pack.'
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
  const chosenBatch = batches.find((b) => b.id === batch);
  return (
    <Panel>
      <h3 className="font-corporate text-base font-semibold text-corp-ink">Onboarding pack</h3>
      <p className="mt-1 text-sm text-corp-muted">
        One email per delegate: what the platform is for, what happens before, during and after,
        their check-in codes for each day as images they can show at the door, and the card with
        their name on it. Nothing is sent until you press the button. The wording is yours to set
        under the Emails tab (&ldquo;Welcome pack&rdquo;); a delegate who already took part in an
        earlier event is told their account carries over.
      </p>

      {batches.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label htmlFor={batchId} className="text-sm font-semibold text-corp-ink">
            Send to
          </label>
          <NativeSelect
            id={batchId}
            value={batch}
            onChange={(e) => {
              setChosen(e.target.value);
              setNotice(null);
              setProblem(null);
            }}
            disabled={busy}
            className="w-auto rounded-none border-corp-line"
          >
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {batchLabel(b)}
              </option>
            ))}
          </NativeSelect>
          <span className="text-xs text-corp-muted">
            The figures and both buttons cover the batch chosen here.
          </span>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Delegates"
          value={s.eligible}
          hint={chosenBatch ? chosenBatch.name : 'active registrations'}
        />
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
          label="Not signed in"
          value={s.notSignedIn}
          tone={s.notSignedIn > 0 ? 'attention' : 'positive'}
          hint="not even once"
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
          onClick={() => void send('not_signed_in')}
          disabled={busy || s.notSignedIn === 0}
          className={consoleButton({ variant: 'secondary' })}
        >
          <RotateCwIcon aria-hidden="true" />
          Send again to the {s.notSignedIn} not signed in
        </button>
      </div>
      <p className="mt-2 text-xs text-corp-muted">
        Sending again reaches only delegates who have not signed in even once, whether or not they
        already had a pack; nobody already using the platform is emailed. The codes never change, so
        a second pack carries the same ones.
      </p>
    </Panel>
  );
}
