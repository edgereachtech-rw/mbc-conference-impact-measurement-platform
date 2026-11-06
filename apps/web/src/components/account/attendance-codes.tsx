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

/** Today's calendar date (YYYY-MM-DD) in the event's timezone, so "today" is the venue's today. */
function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The day shown until the delegate picks one: today if it is an event day, else the first day
 * still open for check-in, else the first day.
 */
function defaultDay(dates: MyAttendance['dates'], today: string): string | undefined {
  return (
    dates.find((d) => d.date === today)?.id ??
    dates.find((d) => d.daily === 'not_checked_in' && !d.closed)?.id ??
    dates[0]?.id
  );
}

/**
 * The delegate's attendance: one QR code per event date to show at the entrance, and the status
 * the organisers recorded. The code carries a random-looking token, never personal data, and
 * holding it is not attendance: an admin verifies the person and confirms the check-in.
 *
 * One day at a time (2026-11-06): the days are tabs and only the chosen day's code is on screen,
 * so the delegate at the door is never holding up the wrong day's code beside the right one.
 */
export function AttendanceCodes({ eventId, timezone }: { eventId: string; timezone: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  /** The day the delegate chose; until then the default for today. */
  const [chosen, setChosen] = useState<string | null>(null);

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
  const today = todayIn(timezone);
  const dayId =
    chosen && attendance.dates.some((d) => d.id === chosen)
      ? chosen
      : defaultDay(attendance.dates, today);
  const day = attendance.dates.find((d) => d.id === dayId)!;
  const dayLabel = (d: MyAttendance['dates'][number], index: number) =>
    `Day ${index + 1} · ${formatDateShort(d.date)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-corp-text">
        <StatusPill tone={tone(attendance.overall)}>
          {overallAttendanceLabels[attendance.overall]}
        </StatusPill>
        <span>
          Pick the day, then show its code at the entrance. The organisers check it against your
          registration before recording your attendance.
        </span>
      </div>

      {attendance.dates.length > 1 ? (
        <div
          role="tablist"
          aria-label="Event days"
          className="-mx-gutter flex gap-1 overflow-x-auto border-b border-corp-line px-gutter md:mx-0 md:px-0"
        >
          {attendance.dates.map((d, index) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              id={`day-tab-${d.id}`}
              aria-selected={d.id === day.id}
              aria-controls={`day-panel-${d.id}`}
              onClick={() => setChosen(d.id)}
              className={
                d.id === day.id
                  ? '-mb-px flex min-h-tap shrink-0 flex-col items-start justify-center border-b-2 border-corp-accent px-3 py-2 text-left text-sm font-semibold whitespace-nowrap text-corp-ink'
                  : 'flex min-h-tap shrink-0 flex-col items-start justify-center border-b-2 border-transparent px-3 py-2 text-left text-sm font-medium whitespace-nowrap text-corp-muted hover:text-corp-ink'
              }
            >
              <span>{dayLabel(d, index)}</span>
              <span className="text-xs font-normal">
                {d.date === today ? 'Today' : attendanceStatusLabels[d.daily]}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <section
        role={attendance.dates.length > 1 ? 'tabpanel' : undefined}
        id={`day-panel-${day.id}`}
        aria-labelledby={attendance.dates.length > 1 ? `day-tab-${day.id}` : undefined}
        aria-label={attendance.dates.length > 1 ? undefined : 'Your attendance code'}
        className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-none border border-corp-line bg-white p-5 text-center"
      >
        <p className="font-corporate text-base font-semibold text-corp-ink">
          {formatDateShort(day.date)}
          {day.date === today ? (
            <span className="ml-2 text-xs font-semibold tracking-[0.08em] text-corp-accent-deep uppercase">
              Today
            </span>
          ) : null}
        </p>
        <StatusPill tone={tone(day.daily)}>{attendanceStatusLabels[day.daily]}</StatusPill>
        {day.daily === 'not_checked_in' && !day.closed ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[day.id]}
              alt={`Your check-in code for ${formatDateShort(day.date)}`}
              width={240}
              height={240}
              className="size-60 max-w-full"
            />
            <p className="text-xs text-corp-muted">
              Show this code at the entrance on {formatDateShort(day.date)}.
            </p>
          </>
        ) : (
          <p className="text-xs text-corp-muted">
            {day.daily === 'not_checked_in'
              ? 'Attendance for this day is closed.'
              : day.recordedAt
                ? 'Recorded by the organisers.'
                : 'Recorded when the day closed.'}
          </p>
        )}
        <p className="font-mono text-[0.65rem] break-all text-corp-muted">{day.token}</p>
      </section>
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
