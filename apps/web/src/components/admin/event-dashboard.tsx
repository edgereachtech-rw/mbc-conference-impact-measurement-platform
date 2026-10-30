'use client';

import type { EventDashboard as Dashboard } from '@mbc/shared';
import { RefreshCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { consoleButton, Panel, StatePanel, StatTile, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant, stageLabels, stageStatusLabels, stageWhen } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface EventDashboardProps {
  eventId: string;
  timezone: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; dashboard: Dashboard }
  | { kind: 'error'; message: string; requestId?: string };

const statusLabels: Record<keyof Dashboard['delegates']['byStatus'], string> = {
  active: 'Active',
  pending: 'Pending',
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
  test: 'Test',
};

const windowText: Record<Dashboard['stages'][number]['window'], string> = {
  hidden: 'Not shown to delegates',
  upcoming: 'Opens later',
  open: 'Open to delegates',
  closed: 'Closed',
};

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 1000) / 10}%` : null;

/**
 * The event's summary page: delegates, each assessment stage with its response counts, and the
 * messages sent, in one admin-only call. Counts only; names and answers live on their own pages.
 */
export function EventDashboard({ eventId, timezone }: EventDashboardProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ dashboard: Dashboard }>(`/events/${eventId}/dashboard`).then(
      (result) => {
        if (!cancelled) setState({ kind: 'ready', dashboard: result.dashboard });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'The dashboard could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading') {
    return <StatePanel kind="loading" title="Loading the dashboard…" />;
  }
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Dashboard unavailable"
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
  const { event, delegates, stages, messages, generatedAt } = state.dashboard;

  return (
    <div className="space-y-6">
      <section aria-label="Delegates" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Registered delegates"
          value={delegates.registered}
          hint={
            delegates.registered
              ? `${delegates.signedUp} signed up (${percent(delegates.signedUp, delegates.registered)})`
              : 'No registrations yet'
          }
          tone={delegates.registered ? 'positive' : 'neutral'}
        />
        <StatTile
          label="Invited"
          value={delegates.invited}
          hint={
            delegates.registered
              ? `${percent(delegates.invited, delegates.registered)} of registered`
              : undefined
          }
        />
        <StatTile
          label="In person · Online"
          value={`${delegates.physical} · ${delegates.virtual}`}
          hint="Attendance format from the registrations"
        />
        <StatTile
          label="Sessions"
          value={event.sessions}
          hint={`${event.days} event day${event.days === 1 ? '' : 's'} · ${event.timezone}`}
        />
      </section>

      <section aria-label="Assessment stages" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-corporate text-h3 text-corp-ink">Assessment stages</h2>
          <Link
            href={`/admin/events/${event.id}`}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            Configure stages
          </Link>
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          {stages.map((s) => (
            <Panel key={s.stage}>
              <article aria-label={stageLabels[s.stage]} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="neutral">{stageWhen[s.stage]}</StatusPill>
                  <StatusPill tone={s.enabled ? 'positive' : 'neutral'}>
                    {s.enabled ? stageStatusLabels[s.status] : 'Disabled'}
                  </StatusPill>
                  {s.enabled ? (
                    <StatusPill tone={s.window === 'open' ? 'positive' : 'attention'}>
                      {windowText[s.window]}
                    </StatusPill>
                  ) : null}
                </div>
                <h3 className="font-corporate text-base font-semibold text-corp-ink">
                  {stageLabels[s.stage]}
                </h3>
                <p className="text-xs text-corp-muted">
                  {s.enabled
                    ? `${formatInstant(s.opensAt, timezone)} to ${formatInstant(s.closesAt, timezone)} · ${s.questions} question${s.questions === 1 ? '' : 's'}`
                    : 'Not used for this event'}
                </p>
                {s.summary ? (
                  <dl
                    aria-label={`Responses: ${stageLabels[s.stage]}`}
                    className="grid grid-cols-3 gap-2 rounded-none border border-corp-line bg-corp-surface p-2 text-center"
                  >
                    {(
                      [
                        ['Invited', String(s.summary.invited)],
                        ['Started', String(s.summary.started)],
                        [
                          'Submitted',
                          s.summary.responseRate === null
                            ? String(s.summary.submitted)
                            : `${s.summary.submitted} (${s.summary.responseRate}%)`,
                        ],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[0.65rem] font-semibold tracking-[0.08em] text-corp-muted uppercase">
                          {label}
                        </dt>
                        <dd className="text-base font-semibold text-corp-ink tabular-nums">
                          {value}
                        </dd>
                      </div>
                    ))}
                    <div className="col-span-3 border-t border-corp-line pt-1 text-left text-xs text-corp-text">
                      {s.summary.knowledge
                        ? s.summary.knowledge.averageScore === null
                          ? `Knowledge: ${s.summary.knowledge.questions} questions, no complete answers yet.`
                          : `Knowledge: average ${s.summary.knowledge.averageScore} of ${s.summary.knowledge.questions} (${s.summary.knowledge.averagePercent}%) from ${s.summary.knowledge.respondents}.`
                        : 'No knowledge questions.'}{' '}
                      {s.nonCompleters} not yet submitted.
                    </div>
                  </dl>
                ) : s.enabled ? (
                  <p className="text-sm text-corp-muted">No questions yet, so nothing to count.</p>
                ) : null}
                <Link
                  href={`/admin/events/${event.id}/assessments/${s.stage}`}
                  className={consoleButton({ variant: 'secondary', size: 'sm' })}
                >
                  Questions and submissions
                </Link>
              </article>
            </Panel>
          ))}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <h2 className="font-corporate text-sm font-semibold text-corp-ink">
            Registrations by status
          </h2>
          <dl
            aria-label="Registrations by status"
            className="mt-2 divide-y divide-corp-line text-sm"
          >
            {(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((key) => (
              <div key={key} className="flex items-center justify-between py-1.5">
                <dt className="text-corp-text">{statusLabels[key]}</dt>
                <dd className="font-semibold text-corp-ink tabular-nums">
                  {delegates.byStatus[key] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-corp-muted">
            Active registrations are the ones delegates can sign in with; test ones only where the
            platform allows them.
          </p>
        </Panel>
        <Panel>
          <h2 className="font-corporate text-sm font-semibold text-corp-ink">Messages</h2>
          <dl aria-label="Messages" className="mt-2 divide-y divide-corp-line text-sm">
            {(
              [
                ['Messages sent', messages.sent],
                ['Recipients', messages.recipients],
                ['Delivered', messages.delivered],
                ['Failed', messages.failed],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-1.5">
                <dt className="text-corp-text">{label}</dt>
                <dd className="font-semibold text-corp-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-corp-muted">
            {messages.last
              ? `Last: “${messages.last.subject}”, ${formatInstant(messages.last.createdAt, timezone)}.`
              : 'No message sent yet.'}
          </p>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-corp-muted">
        <span>Figures as of {formatInstant(generatedAt, timezone)}.</span>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
        >
          <RefreshCwIcon aria-hidden="true" /> Refresh
        </button>
      </div>
    </div>
  );
}
