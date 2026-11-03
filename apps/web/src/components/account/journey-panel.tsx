'use client';

import {
  actionProgressLabels,
  dataStateLabels,
  overallAttendanceLabels,
  reminderFrequencyLabels,
  type Journey,
} from '@mbc/shared';
import { useEffect, useState } from 'react';

import { consoleButton, StatePanel, StatTile, StatusPill } from '@/components/console/page';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant, stageLabels } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface Props {
  eventId: string;
  timezone: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; journey: Journey }
  | { kind: 'error'; message: string; requestId?: string };

const stageStateLabels: Record<Journey['assessments'][number]['state'], string> = {
  not_configured: 'Not part of this event',
  not_yet_open: 'Opens later',
  open: 'Open to answer',
  draft: 'Saved as a draft',
  submitted: 'Submitted',
  closed: 'Closed',
};
const dayLabels: Record<Journey['attendance']['dates'][number]['status'], string> = {
  not_checked_in: 'Not checked in',
  attended: 'Attended',
  partial: 'Partly attended',
  absent: 'Absent',
};

/**
 * The delegate's own journey through this event (task of 2026-10-31, §3): what they have given
 * and where they stand, in one place, from the records they already own. Only ever their own:
 * the API resolves it from the signed-in session and takes no delegate id.
 */
export function JourneyPanel({ eventId, timezone }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ journey: Journey }>(`/me/events/${eventId}/journey`).then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', journey: r.journey });
      },
      (e: unknown) => {
        if (!cancelled) {
          // A refusal here means the session is not this delegate's, so the server's own
          // wording is the right one; the shared helper speaks of registration imports.
          const failure =
            e instanceof ApiError && e.status === 403
              ? { message: e.message, requestId: e.requestId }
              : describeError(e, 'Your journey could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading') return <StatePanel kind="loading" title="Loading your journey…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Journey unavailable"
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
  const j = state.journey;
  const answered = j.assessments.filter((a) => a.state === 'submitted').length;

  return (
    <div className="space-y-6">
      <section
        aria-label="Your journey at a glance"
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <StatTile
          label="Attendance"
          value={overallAttendanceLabels[j.attendance.status]}
          hint="Recorded by the organisers"
          tone={
            j.attendance.status === 'attended' || j.attendance.status === 'partial'
              ? 'positive'
              : 'neutral'
          }
        />
        <StatTile
          label="Assessments submitted"
          value={answered}
          hint={`of ${j.assessments.filter((a) => a.state !== 'not_configured').length} in this event`}
        />
        <StatTile
          label="Reflections"
          value={`${j.reflections.submitted} of ${j.reflections.available}`}
          hint="Daily reflections you answered"
        />
        <StatTile
          label="Session feedback"
          value={`${j.feedback.submitted} of ${j.feedback.sessions}`}
          hint="Sessions open for feedback"
        />
      </section>

      <section aria-labelledby="journey-attendance" className="space-y-2">
        <h3 id="journey-attendance" className="font-semibold text-corp-ink">
          Your attendance
        </h3>
        {j.attendance.dates.length === 0 ? (
          <p className="text-sm text-corp-muted">This event has no dates yet.</p>
        ) : (
          <dl className="divide-y divide-corp-line border border-corp-line bg-white text-sm">
            {j.attendance.dates.map((d) => (
              <div key={d.date} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <dt className="text-corp-text">{formatDateShort(d.date)}</dt>
                <dd>
                  <StatusPill
                    tone={
                      d.status === 'attended' || d.status === 'partial'
                        ? 'positive'
                        : d.status === 'absent'
                          ? 'attention'
                          : 'neutral'
                    }
                  >
                    {dayLabels[d.status]}
                  </StatusPill>
                  {!d.closed && d.status === 'not_checked_in' ? (
                    <span className="ml-2 text-xs text-corp-muted">still open</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="journey-assessments" className="space-y-2">
        <h3 id="journey-assessments" className="font-semibold text-corp-ink">
          Your assessment responses
        </h3>
        <dl className="divide-y divide-corp-line border border-corp-line bg-white text-sm">
          {j.assessments.map((a) => (
            <div key={a.stage} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <dt className="text-corp-text">{a.waveLabel || stageLabels[a.stage]}</dt>
              <dd className="text-right">
                <StatusPill tone={a.state === 'submitted' ? 'positive' : 'neutral'}>
                  {stageStateLabels[a.state]}
                </StatusPill>
                {a.submittedAt ? (
                  <span className="mt-1 block text-xs text-corp-muted">
                    {formatInstant(a.submittedAt, timezone)}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-corp-muted">
          Your answers are under Assessments; what you wrote stays yours and the organisers see it
          with your name only where the question is not anonymous.
        </p>
      </section>

      <section aria-labelledby="journey-plan" className="space-y-2">
        <h3 id="journey-plan" className="font-semibold text-corp-ink">
          Your transfer plan
        </h3>
        {!j.plan ? (
          <p className="text-sm text-corp-muted">
            You have not started a plan yet. Open the Transfer plan tab to begin one.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={j.plan.status === 'submitted' ? 'positive' : 'neutral'}>
                {j.plan.status === 'submitted' ? 'Submitted' : 'Draft'}
              </StatusPill>
              <span className="text-xs text-corp-muted">
                Last changed {formatInstant(j.plan.updatedAt, timezone)}
              </span>
            </div>
            <dl className="divide-y divide-corp-line border border-corp-line bg-white text-sm">
              {(
                [
                  ['First priority', j.plan.priority ?? 'Not written yet'],
                  ['Planned actions', String(j.plan.actions)],
                  [
                    'Actions you have applied',
                    `${j.plan.applied} (${actionProgressLabels.applied.toLowerCase()} or ${actionProgressLabels.applied_consistently.toLowerCase()})`,
                  ],
                  ['Measures recorded', `${j.plan.measures}, ${j.plan.withResult} with a result`],
                  ['Evidence records', String(j.plan.evidence)],
                  [
                    'Reminders',
                    `${reminderFrequencyLabels[j.plan.reminder]}${
                      j.plan.nextReminderAt
                        ? `; next ${formatInstant(j.plan.nextReminderAt, timezone)}`
                        : ''
                    }`,
                  ],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-baseline justify-between gap-2 p-3"
                >
                  <dt className="text-corp-text">{label}</dt>
                  <dd className="text-right font-semibold text-corp-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      <section aria-labelledby="journey-support" className="space-y-1">
        <h3 id="journey-support" className="font-semibold text-corp-ink">
          Your support requests
        </h3>
        <p className="text-sm text-corp-muted">
          {dataStateLabels[j.supportRequests.state]}. Ask for support in your plan, under the action
          it belongs to, or write to the organisers.
        </p>
      </section>
    </div>
  );
}
