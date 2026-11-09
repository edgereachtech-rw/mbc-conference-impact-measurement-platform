'use client';

import { followUpResponseStateLabels, type EventDetail, type FollowUpOverview } from '@mbc/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { StageCard } from '@/components/admin/event-setup/assessment-config';
import { FollowUpSchedule } from '@/components/admin/event-setup/follow-up-schedule';
import { consoleButton, StatePanel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
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
          starts and ends on its card. Delegates hear about the open follow-up through the reminders
          they chose on their plan, plus one email from the platform when it opens.
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
