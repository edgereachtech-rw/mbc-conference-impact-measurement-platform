'use client';

import {
  followUpResponseStateLabels,
  type EventDetail,
  type FollowUpOverview,
  type FollowUpWaveView,
} from '@mbc/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { FollowUpSchedule } from '@/components/admin/event-setup/follow-up-schedule';
import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant, isoToZonedLocal, zonedLocalToIso } from '@/lib/events';
import { describeError } from '@/lib/imports';

/**
 * The Transfer Plan post-conference follow-ups, on the organisers' Transfer plans tab (decision
 * 2026-11-09: they are follow-ups of the plan, not a further assessment; card design agreed the
 * same day). One card per follow-up: its name, where it stands, its questions, and its sending.
 * Sending is what opens a follow-up to delegates; there are no dates or status to set by hand.
 * Below the cards, every delegate's responses in one place.
 */
export function FollowUpsSection({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const [data, setData] = useState<FollowUpOverview | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<FollowUpOverview>(`/events/${event.id}/follow-up-responses`).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The follow-ups could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, event.updatedAt, attempt]);

  const waves = data ? [...data.waves].sort((a, b) => a.wave - b.wave) : [];

  return (
    <section aria-labelledby="follow-ups-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="follow-ups-heading" className="font-corporate text-lg font-semibold text-corp-ink">
          Post-conference follow-ups
        </h2>
        <p className="text-sm text-corp-text">
          Delegates see a follow-up only once it has been sent to them. Send it by hand, or set a
          time and it is sent then by itself. Each follow-up asks where every action of the Transfer
          Plan stands, then its own questions.
        </p>
      </div>
      <FollowUpSchedule
        event={event}
        onSaved={(saved) => {
          onSaved(saved);
          refresh();
        }}
      />
      {notice ? (
        <p role="status" className="text-sm font-semibold text-corp-green-text">
          {notice}
        </p>
      ) : null}
      {error ? (
        <StatePanel
          kind="error"
          title="Follow-ups unavailable"
          description={error.message}
          requestId={error.requestId}
          action={
            <button
              type="button"
              onClick={refresh}
              className={consoleButton({ variant: 'secondary' })}
            >
              Try again
            </button>
          }
        />
      ) : !data ? (
        <StatePanel kind="loading" title="Loading the follow-ups…" />
      ) : (
        <>
          {waves.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-3">
              {waves.map((w) => (
                <FollowUpCard
                  key={w.id}
                  event={event}
                  wave={w}
                  eligible={data.eligible}
                  onNotice={setNotice}
                  onChanged={refresh}
                />
              ))}
            </div>
          ) : null}
          <ResponsesTable event={event} data={data} waves={waves} />
        </>
      )}
    </section>
  );
}

/** One line, in plain words, saying where a follow-up stands. */
function stateOf(
  w: FollowUpWaveView,
  timezone: string,
): { text: string; tone: 'positive' | 'neutral' | 'attention' } {
  if (w.questions === 0) return { text: 'Still being prepared', tone: 'neutral' };
  if (w.status === 'closed') return { text: 'Closed to delegates', tone: 'neutral' };
  if (w.invitesSentAt) {
    return {
      text: `Open to delegates · sent ${formatInstant(w.invitesSentAt, timezone)}`,
      tone: 'positive',
    };
  }
  if (w.inviteAt) {
    return {
      text: `Sends automatically on ${formatInstant(w.inviteAt, timezone)}`,
      tone: 'neutral',
    };
  }
  return { text: 'Not sent yet', tone: 'neutral' };
}

function FollowUpCard({
  event,
  wave: w,
  eligible,
  onNotice,
  onChanged,
}: {
  event: EventDetail;
  wave: FollowUpWaveView;
  eligible: number;
  onNotice: (text: string | null) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const ready = w.questions > 0;
  const sent = Boolean(w.invitesSentAt);
  const closed = w.status === 'closed';
  const notAnswered = Math.max(0, w.invited - w.submitted);
  const newDelegates = Math.max(0, eligible - w.invited);
  const state = stateOf(w, event.timezone);
  const page = `/admin/events/${event.id}/assessments/follow_up?wave=${w.wave}`;
  const name = w.label || 'Post-conference follow-up';
  const band = closed
    ? 'border-t-corp-line'
    : sent
      ? 'border-t-corp-accent'
      : w.inviteAt
        ? 'border-t-corp-green'
        : 'border-t-corp-line';

  async function act(key: string, run: () => Promise<string>) {
    setBusy(key);
    onNotice(null);
    try {
      onNotice(await run());
      setScheduling(null);
      onChanged();
    } catch (e) {
      onNotice(describeError(e, 'That could not be done.').message);
    } finally {
      setBusy(null);
    }
  }
  const send = (mode: 'invitations' | 'reminders') =>
    act(mode, async () => {
      const r = await apiFetch<{ sent: number; failed: number }>(
        `/events/${event.id}/assessments/follow-ups/${w.wave}/${mode}`,
        { method: 'POST' },
      );
      return `${name}: ${mode === 'invitations' ? 'invitation' : 'reminder'} sent to ${r.sent} delegate${r.sent === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}.`;
    });
  const schedule = (at: string | null) =>
    act('schedule', async () => {
      const inviteAt = at ? zonedLocalToIso(at, event.timezone) : null;
      if (at && !inviteAt) throw new Error('Enter a complete date and time.');
      await apiFetch(`/events/${event.id}/assessments/follow-ups/${w.wave}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ inviteAt }),
      });
      return inviteAt
        ? `${name} will be sent on ${formatInstant(inviteAt, event.timezone)}.`
        : `${name}: automatic sending cleared.`;
    });
  const toggleClosed = () =>
    act('close', async () => {
      await apiFetch(
        `/events/${event.id}/assessments/follow-ups/${w.wave}/${closed ? 'reopen' : 'close'}`,
        { method: 'POST' },
      );
      return closed ? `${name} is open to delegates again.` : `${name} is closed to delegates.`;
    });

  const button = (variant: 'accent' | 'secondary' | 'ghost') =>
    consoleButton({ variant, size: 'sm' });

  return (
    <section
      aria-label={name}
      className={`flex flex-col gap-3 border border-corp-line border-t-4 bg-white p-4 ${band}`}
    >
      <div className="space-y-1.5">
        <h3 className="font-corporate text-base font-semibold text-corp-ink">{name}</h3>
        <StatusPill tone={state.tone}>{state.text}</StatusPill>
      </div>
      {ready ? (
        <p className="text-sm text-corp-text">
          {w.questions} question{w.questions === 1 ? '' : 's'} ·{' '}
          <Link href={page} className="font-semibold text-corp-green-text hover:underline">
            Edit questions
          </Link>{' '}
          ·{' '}
          <Link
            href={`${page}#submissions`}
            className="font-semibold text-corp-green-text hover:underline"
          >
            See answers
          </Link>
        </p>
      ) : (
        <p className="text-sm font-semibold text-brand-danger">
          No questions yet. Add questions before sending.{' '}
          <Link href={page} className="text-corp-green-text hover:underline">
            Edit questions
          </Link>
        </p>
      )}
      <div className="space-y-2 border-t border-corp-line pt-3">
        {ready ? (
          <p className="text-sm text-corp-ink">
            <span className="font-semibold">{w.invited} invited</span> ·{' '}
            <span className="font-semibold">{w.submitted} submitted</span>
            {sent && notAnswered > 0 ? ` · ${notAnswered} have not answered` : ''}
          </p>
        ) : null}
        <p className="text-xs text-corp-muted">
          {sent
            ? `Invitation sent on ${formatInstant(w.invitesSentAt, event.timezone)}.`
            : w.inviteAt
              ? `Sends automatically on ${formatInstant(w.inviteAt, event.timezone)}${ready ? '' : ' once it has questions'}.`
              : 'Not scheduled: sent by hand.'}
        </p>
        {scheduling !== null ? (
          <div className="space-y-2 border border-corp-line bg-corp-surface p-3">
            <label htmlFor={`${w.id}-when`} className="block text-sm font-semibold text-corp-ink">
              Send the invitation automatically on{' '}
              <span className="font-normal text-corp-muted">({event.timezone})</span>
            </label>
            <input
              id={`${w.id}-when`}
              type="datetime-local"
              value={scheduling}
              onChange={(e) => setScheduling(e.target.value)}
              className="h-10 w-full rounded-none border border-corp-line bg-white px-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void schedule(scheduling)}
                className={button('accent')}
              >
                Save time
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setScheduling(null)}
                className={button('ghost')}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {sent ? (
            <>
              {newDelegates > 0 ? (
                <button
                  type="button"
                  disabled={busy !== null || closed}
                  onClick={() => void send('invitations')}
                  className={button('secondary')}
                >
                  Send the invitation to {newDelegates} new delegate{newDelegates === 1 ? '' : 's'}
                </button>
              ) : null}
              {notAnswered > 0 ? (
                <button
                  type="button"
                  disabled={busy !== null || closed}
                  onClick={() => void send('reminders')}
                  className={button('accent')}
                >
                  Remind the {notAnswered} who {notAnswered === 1 ? 'has' : 'have'} not answered
                </button>
              ) : null}
            </>
          ) : (
            <>
              {scheduling === null ? (
                <button
                  type="button"
                  disabled={!ready || busy !== null}
                  onClick={() =>
                    setScheduling(isoToZonedLocal(w.inviteAt ?? w.opensAt, event.timezone))
                  }
                  className={button(w.inviteAt ? 'secondary' : 'ghost')}
                >
                  {w.inviteAt ? 'Change the time' : 'Schedule the sending'}
                </button>
              ) : null}
              {w.inviteAt && scheduling === null ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void schedule(null)}
                  className={button('ghost')}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                disabled={!ready || busy !== null}
                onClick={() => void send('invitations')}
                className={button(w.inviteAt ? 'accent' : 'secondary')}
              >
                Send the invitation now
              </button>
            </>
          )}
        </div>
        {sent ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void toggleClosed()}
            className="text-sm font-semibold text-corp-green-text hover:underline"
          >
            {closed ? 'Reopen to delegates' : 'Close to delegates'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Every delegate's follow-up responses, one row each, one column per follow-up. */
function ResponsesTable({
  event,
  data,
  waves,
}: {
  event: EventDetail;
  data: FollowUpOverview;
  waves: FollowUpWaveView[];
}) {
  if (waves.length === 0) return null;
  const submittedPer = (wave: number) =>
    data.rows.filter((r) => r.responses[String(wave)]?.state === 'submitted').length;
  return (
    <section aria-labelledby="follow-up-responses-heading" className="space-y-3">
      <div>
        <h3 id="follow-up-responses-heading" className="font-semibold text-corp-ink">
          Who has answered what
        </h3>
        <p className="text-xs text-corp-muted">
          {data.rows.length} delegate{data.rows.length === 1 ? '' : 's'} counted. The statuses a
          follow-up recorded appear under each action in the delegate&apos;s plan.
        </p>
      </div>
      <div className="-mx-gutter overflow-x-auto md:mx-0">
        <table className="min-w-full border-collapse text-sm">
          <caption className="sr-only">Follow-up responses by delegate</caption>
          <thead>
            <tr className="border-b border-corp-line text-left text-xs text-corp-muted">
              <th scope="col" className="px-gutter py-2 font-semibold md:px-2">
                Delegate
              </th>
              {waves.map((w) => (
                <th key={w.id} scope="col" className="px-2 py-2 font-semibold">
                  <span className="block text-corp-ink">{w.label || 'Follow-up'}</span>
                  <span className="block font-normal">
                    {w.invitesSentAt
                      ? `${submittedPer(w.wave)} of ${w.invited} submitted`
                      : 'Not sent yet'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.delegateId} className="border-b border-corp-line align-top">
                <th scope="row" className="px-gutter py-2 text-left font-medium md:px-2">
                  <span className="block text-corp-ink">{row.name}</span>
                  {row.organisation ? (
                    <span className="block text-xs font-normal text-corp-muted">
                      {row.organisation}
                    </span>
                  ) : null}
                </th>
                {waves.map((w) => {
                  const r = row.responses[String(w.wave)];
                  return (
                    <td key={w.id} className="px-2 py-2 text-corp-text">
                      {!r ? (
                        <span className="text-corp-muted">
                          {w.invitesSentAt ? followUpResponseStateLabels.none : 'Not sent yet'}
                        </span>
                      ) : r.state === 'submitted' ? (
                        <>
                          <span className="block font-semibold text-corp-green-text">
                            {followUpResponseStateLabels.submitted}
                          </span>
                          <span className="block text-xs text-corp-muted">
                            {formatInstant(r.submittedAt, event.timezone)}
                            {r.statuses > 0
                              ? ` · ${r.statuses} action status${r.statuses === 1 ? '' : 'es'}`
                              : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block">{followUpResponseStateLabels.started}</span>
                          <span className="block text-xs text-corp-muted">
                            last saved {formatInstant(r.updatedAt, event.timezone)}
                          </span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
