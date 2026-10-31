'use client';

import type { MyFeedbackListItem } from '@mbc/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: MyFeedbackListItem[] }
  | { kind: 'error'; message: string; requestId?: string };

/** The delegate's sessions with feedback, each a link to its form; the QR code opens the same page. */
export function SessionFeedbackList({ eventId, timezone }: { eventId: string; timezone: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ sessions: MyFeedbackListItem[] }>(`/me/events/${eventId}/feedback`).then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', sessions: r.sessions });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Session feedback could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading')
    return <StatePanel kind="loading" title="Loading session feedback…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Session feedback unavailable"
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
  if (state.sessions.length === 0) {
    return (
      <p className="text-sm text-corp-muted">
        No session feedback is open yet. At the end of a session the organisers share its link or QR
        code.
      </p>
    );
  }
  return (
    <ul
      aria-label="Session feedback"
      className="divide-y divide-corp-line rounded-none border border-corp-line bg-white"
    >
      {state.sessions.map((s) => (
        <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-semibold text-corp-ink">{s.title}</p>
            <p className="text-xs text-corp-muted">
              {formatDateShort(s.date)}
              {s.speaker ? ` · ${s.speaker}` : ''}
              {s.submittedAt ? ` · submitted ${formatInstant(s.submittedAt, timezone)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={s.submittedAt ? 'positive' : s.window === 'open' ? 'attention' : 'neutral'}
            >
              {s.submittedAt ? 'Submitted' : s.window === 'open' ? 'Open' : 'Closed'}
            </StatusPill>
            {!s.attended ? <StatusPill tone="neutral">Attendance not recorded</StatusPill> : null}
            <Link
              href={s.path}
              className={consoleButton({
                variant: s.submittedAt ? 'secondary' : 'accent',
                size: 'sm',
              })}
            >
              {s.submittedAt ? 'View or update' : 'Give feedback'}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
