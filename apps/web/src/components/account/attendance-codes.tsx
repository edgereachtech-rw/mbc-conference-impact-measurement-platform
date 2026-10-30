'use client';

import { attendanceStatusLabels, overallAttendanceLabels, type MyAttendance } from '@mbc/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatDateShort } from '@/lib/events';
import { describeError } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; attendance: MyAttendance; images: Record<string, string> }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * The delegate's attendance: one QR code per event date to show at the entrance, and the status
 * the organisers recorded. The code carries a random-looking token, never personal data, and
 * holding it is not attendance: an admin verifies the person and confirms the check-in.
 */
export function AttendanceCodes({ eventId }: { eventId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await apiFetch<{ attendance: MyAttendance }>(
        `/me/events/${eventId}/attendance`,
      );
      const images: Record<string, string> = {};
      for (const d of result.attendance.dates) {
        images[d.id] = await QRCode.toDataURL(d.token, { margin: 1, width: 240 });
      }
      return { attendance: result.attendance, images };
    })().then(
      (data) => {
        if (!cancelled) setState({ kind: 'ready', ...data });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Your attendance codes could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading') {
    return <StatePanel kind="loading" title="Loading your attendance codes…" />;
  }
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Attendance codes unavailable"
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
  const { attendance, images } = state;
  if (attendance.dates.length === 0) {
    return (
      <p className="text-sm text-corp-muted">
        The organisers have not set the event dates yet; your codes appear here when they do.
      </p>
    );
  }
  const tone = (s: MyAttendance['dates'][number]['daily'] | MyAttendance['overall']) =>
    s === 'attended' || s === 'partial' ? 'positive' : s === 'absent' ? 'attention' : 'neutral';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-corp-text">
        <StatusPill tone={tone(attendance.overall)}>
          {overallAttendanceLabels[attendance.overall]}
        </StatusPill>
        <span>
          Show the code for the day at the entrance. The organisers check it against your
          registration before recording your attendance.
        </span>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your attendance codes">
        {attendance.dates.map((d) => (
          <li
            key={d.id}
            className="flex flex-col items-center gap-2 rounded-none border border-corp-line bg-white p-4 text-center"
          >
            <p className="font-corporate text-sm font-semibold text-corp-ink">
              {formatDateShort(d.date)}
            </p>
            <StatusPill tone={tone(d.daily)}>{attendanceStatusLabels[d.daily]}</StatusPill>
            {d.daily === 'not_checked_in' && !d.closed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={images[d.id]}
                alt={`Your check-in code for ${formatDateShort(d.date)}`}
                width={240}
                height={240}
                className="size-60 max-w-full"
              />
            ) : (
              <p className="text-xs text-corp-muted">
                {d.daily === 'not_checked_in'
                  ? 'Attendance for this day is closed.'
                  : d.recordedAt
                    ? 'Recorded by the organisers.'
                    : 'Recorded when the day closed.'}
              </p>
            )}
            <p className="font-mono text-[0.65rem] break-all text-corp-muted">{d.token}</p>
          </li>
        ))}
      </ul>
      {attendance.sessionsAttended.length ? (
        <p className="text-sm text-corp-text">
          Sessions recorded:{' '}
          {attendance.sessionsAttended
            .map((s) => `${s.title} (${formatDateShort(s.date)})`)
            .join(', ')}
          .
        </p>
      ) : null}
    </div>
  );
}
