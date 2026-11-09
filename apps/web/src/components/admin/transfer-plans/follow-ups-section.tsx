'use client';

import { followUpResponseStateLabels, type EventDetail, type FollowUpOverview } from '@mbc/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { StageCard } from '@/components/admin/event-setup/assessment-config';
import { FollowUpSchedule } from '@/components/admin/event-setup/follow-up-schedule';
import { consoleButton, StatePanel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant, isoToZonedLocal, zonedLocalToIso } from '@/lib/events';
import { describeError } from '@/lib/imports';

/**
 * The Transfer Plan post-conference follow-ups, on the organisers' Transfer plans tab (decision
 * 2026-11-09: they are follow-ups of the plan, not a further assessment). The schedule offer,
 * one card per follow-up to set its window, questions and status, and every delegate's responses
 * in one place.
 */
export function FollowUpsSection({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const waves = event.assessmentStages
    .filter((s) => s.stage === 'follow_up')
    .sort((a, b) => a.wave - b.wave);
  return (
    <section aria-labelledby="follow-ups-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="follow-ups-heading" className="font-corporate text-lg font-semibold text-corp-ink">
          Post-conference follow-ups
        </h2>
        <p className="text-sm text-corp-text">
          Each follow-up asks every delegate where the actions of their Transfer Plan stand and what
          they have applied, then its own questions. Each covers a stretch of days after the event
          (by default days 1 to 30, 31 to 60, 61 to 90, then day 91 onwards); set when each one
          starts and ends on its card. A follow-up reaches delegates only when you send it below;
          their own plan reminders ask them to keep their action statuses up to date.
        </p>
      </div>
      <FollowUpSchedule event={event} onSaved={onSaved} />
      {waves.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {waves.map((stage) => (
            <StageCard
              key={`${stage.stage}:${stage.wave}`}
              event={event}
              stage={stage}
              onSaved={onSaved}
            />
          ))}
        </div>
      ) : null}
      <FollowUpsOverview event={event} refreshKey={event.updatedAt} />
    </section>
  );
}

/** Every delegate's follow-up responses, one row each, one column per follow-up. */
function FollowUpsOverview({ event, refreshKey }: { event: EventDetail; refreshKey: string }) {
  const [data, setData] = useState<FollowUpOverview | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The wave whose automatic send time is being edited, and the draft time in the event zone. */
  const [scheduling, setScheduling] = useState<{ wave: number; at: string } | null>(null);

  /** When a wave's invitation goes out by itself; null clears it (2026-11-09). */
  async function schedule(wave: number, at: string | null) {
    const inviteAt = at ? zonedLocalToIso(at, event.timezone) : null;
    if (at && !inviteAt) {
      setNotice('Enter a complete date and time.');
      return;
    }
    setSending(`${wave}:schedule`);
    setNotice(null);
    try {
      await apiFetch(`/events/${event.id}/assessments/follow-ups/${wave}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ inviteAt }),
      });
      setNotice(
        inviteAt
          ? `The invitation will be sent on ${formatInstant(inviteAt, event.timezone)}.`
          : 'Automatic sending cleared; send it by hand when ready.',
      );
      setScheduling(null);
      setAttempt((n) => n + 1);
    } catch (e) {
      setNotice(describeError(e, 'The sending time could not be saved.').message);
    } finally {
      setSending(null);
    }
  }

  /** The organisers send a follow-up's invitation or reminder; nothing goes out otherwise. */
  async function send(wave: number, mode: 'invitations' | 'reminders') {
    setSending(`${wave}:${mode}`);
    setNotice(null);
    try {
      const result = await apiFetch<{ sent: number; failed: number; skipped: number }>(
        `/events/${event.id}/assessments/follow-ups/${wave}/${mode}`,
        { method: 'POST' },
      );
      setNotice(
        `${mode === 'invitations' ? 'Invitation' : 'Reminder'} sent to ${result.sent} delegate${result.sent === 1 ? '' : 's'}${result.failed ? `, ${result.failed} failed` : ''}.`,
      );
      setAttempt((n) => n + 1);
    } catch (e) {
      setNotice(describeError(e, 'The follow-up could not be sent.').message);
    } finally {
      setSending(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<FollowUpOverview>(`/events/${event.id}/follow-up-responses`).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The follow-up responses could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, refreshKey, attempt]);

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Follow-up responses unavailable"
        description={error.message}
        requestId={error.requestId}
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
  if (!data) return <StatePanel kind="loading" title="Loading follow-up responses…" />;
  const waves = [...data.waves].sort((a, b) => a.wave - b.wave);
  if (waves.length === 0) return null;
  const submittedPer = (wave: number) =>
    data.rows.filter((r) => r.responses[String(wave)]?.state === 'submitted').length;

  return (
    <section aria-labelledby="follow-up-responses-heading" className="space-y-3">
      <div className="space-y-2">
        <h3 className="font-semibold text-corp-ink">Send a follow-up</h3>
        <p className="text-xs text-corp-muted">
          Send the invitation when a follow-up is ready, or set a time and it is sent then by
          itself. Delegates see a follow-up, and can answer it, only once they have been sent it.
          Send a reminder to those who have not answered. Each send reaches only those not yet
          reached.
        </p>
        {notice ? (
          <p role="status" className="text-sm font-semibold text-corp-green-text">
            {notice}
          </p>
        ) : null}
        <ul aria-label="Follow-ups to send" className="divide-y divide-corp-line">
          {waves.map((w) => {
            const ready = w.enabled && w.status !== 'draft' && w.questions > 0;
            return (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-semibold text-corp-ink">{w.label || 'Follow-up'}</span>
                  <span className="block text-xs text-corp-muted">
                    {ready
                      ? `${w.invited} invited · ${w.submitted} submitted`
                      : 'Enable it, add questions and schedule it before sending.'}
                  </span>
                  <span className="block text-xs text-corp-muted">
                    {w.invitesSentAt
                      ? `Invitation sent ${formatInstant(w.invitesSentAt, event.timezone)}.`
                      : w.inviteAt
                        ? `Sends automatically on ${formatInstant(w.inviteAt, event.timezone)}${ready ? '' : ' once it is ready'}.`
                        : 'Not scheduled: sent by hand.'}
                  </span>
                  {scheduling?.wave === w.wave ? (
                    <span className="mt-1 flex flex-wrap items-end gap-2">
                      <label className="text-xs font-semibold text-corp-ink">
                        Send automatically on ({event.timezone})
                        <input
                          type="datetime-local"
                          value={scheduling.at}
                          onChange={(e) => setScheduling({ wave: w.wave, at: e.target.value })}
                          className="mt-1 block h-10 rounded-none border border-corp-line bg-white px-2 text-sm font-normal"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={sending !== null}
                        onClick={() => void schedule(w.wave, scheduling.at)}
                        className={consoleButton({ variant: 'accent', size: 'sm' })}
                      >
                        Save time
                      </button>
                      <button
                        type="button"
                        disabled={sending !== null}
                        onClick={() => setScheduling(null)}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1">
                  {!w.invitesSentAt && scheduling?.wave !== w.wave ? (
                    <button
                      type="button"
                      disabled={sending !== null}
                      onClick={() =>
                        setScheduling({
                          wave: w.wave,
                          at: isoToZonedLocal(w.inviteAt ?? w.opensAt, event.timezone),
                        })
                      }
                      className={consoleButton({ variant: 'secondary', size: 'sm' })}
                    >
                      {w.inviteAt ? 'Change the time' : 'Schedule the sending'}
                    </button>
                  ) : null}
                  {w.inviteAt && !w.invitesSentAt && scheduling?.wave !== w.wave ? (
                    <button
                      type="button"
                      disabled={sending !== null}
                      onClick={() => void schedule(w.wave, null)}
                      className={consoleButton({ variant: 'ghost', size: 'sm' })}
                    >
                      Clear
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!ready || sending !== null}
                    onClick={() => void send(w.wave, 'invitations')}
                    className={consoleButton({ variant: 'accent', size: 'sm' })}
                  >
                    {sending === `${w.wave}:invitations` ? 'Sending…' : 'Send the invitation'}
                  </button>
                  <button
                    type="button"
                    disabled={!ready || sending !== null || w.invited === 0}
                    onClick={() => void send(w.wave, 'reminders')}
                    className={consoleButton({ variant: 'secondary', size: 'sm' })}
                  >
                    {sending === `${w.wave}:reminders`
                      ? 'Sending…'
                      : 'Remind those who have not answered'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="follow-up-responses-heading" className="font-semibold text-corp-ink">
            Responses, every delegate in one place
          </h3>
          <p className="text-xs text-corp-muted">
            {data.rows.length} delegate{data.rows.length === 1 ? '' : 's'} counted. The statuses a
            follow-up recorded appear under each action in the delegate&apos;s plan; the answers to
            its questions are on the follow-up&apos;s own page.
          </p>
        </div>
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
                    {w.opensAt ? formatInstant(w.opensAt, event.timezone) : 'No start'}
                    {' – '}
                    {w.closesAt ? formatInstant(w.closesAt, event.timezone) : 'no end'}
                  </span>
                  <span className="block font-normal">
                    {submittedPer(w.wave)} of {data.rows.length} submitted ·{' '}
                    <Link
                      href={`/admin/events/${event.id}/assessments/follow_up?wave=${w.wave}`}
                      className="underline"
                    >
                      answers
                    </Link>
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
                        <span className="text-corp-muted">{followUpResponseStateLabels.none}</span>
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
