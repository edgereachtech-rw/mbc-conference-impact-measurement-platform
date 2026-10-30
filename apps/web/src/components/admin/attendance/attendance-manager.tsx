'use client';

import {
  attendanceMethodLabels,
  attendanceStatusLabels,
  overallAttendanceLabels,
  type AttendanceDateCounts,
  type AttendanceOverview,
  type AttendanceRecordView,
  type AttendanceRow,
  type DailyAttendanceStatus,
  type DelegateAttendanceProfile,
  type EventDetail,
  type SessionAttendanceList,
} from '@mbc/shared';
import {
  CameraIcon,
  CheckIcon,
  ClipboardCheckIcon,
  Loader2Icon,
  LockIcon,
  QrCodeIcon,
  SearchIcon,
  UserIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, Panel, StatePanel, StatTile, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface AttendanceManagerProps {
  event: EventDetail;
}

interface DateList {
  date: { id: string; date: string; closedAt: string | null };
  counts: AttendanceDateCounts;
  rows: AttendanceRow[];
}

type DialogState =
  | { kind: 'scan' }
  | { kind: 'mark'; row: AttendanceRow }
  | { kind: 'bulk' }
  | { kind: 'correct'; row: AttendanceRow; record: AttendanceRecordView }
  | { kind: 'close' }
  | { kind: 'profile'; delegateId: string; name: string }
  | { kind: 'session'; sessionId: string }
  | null;

const formatLabel = { physical: 'In person', virtual: 'Online' } as const;
const dailyTone = (s: DailyAttendanceStatus) =>
  s === 'attended' || s === 'partial' ? 'positive' : s === 'absent' ? 'attention' : 'neutral';

/** Minimal shape of the browser's BarcodeDetector, present on Android Chrome and recent desktops. */
interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = new (options: { formats: string[] }) => Detector;

/**
 * Attendance for one event, per event date (attendance requirements, 2026-10-30): the date's
 * list with QR check-in, manual marking, bulk marking for online delegates, corrections with a
 * reason, closure with absences, session attendance and each delegate's attendance profile.
 * Admins only; every action is recorded with the admin responsible.
 */
export function AttendanceManager({ event }: AttendanceManagerProps) {
  const [overview, setOverview] = useState<AttendanceOverview | null>(null);
  const [dateId, setDateId] = useState<string | null>(null);
  const [list, setList] = useState<DateList | null>(null);
  const [filters, setFilters] = useState<{ q: string; format: string; status: string }>({
    q: '',
    format: '',
    status: '',
  });
  const [applied, setApplied] = useState(filters);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const readOnly = event.status === 'archived';
  const id = useId();

  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ overview: AttendanceOverview }>(`/events/${event.id}/attendance`).then(
      (result) => {
        if (cancelled) return;
        setOverview(result.overview);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'Attendance could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, version]);

  const currentDateId = dateId ?? overview?.dates[0]?.id ?? null;

  useEffect(() => {
    if (!currentDateId) return undefined;
    let cancelled = false;
    const params = new URLSearchParams();
    if (applied.q) params.set('q', applied.q);
    if (applied.format) params.set('format', applied.format);
    if (applied.status) params.set('status', applied.status);
    const query = params.toString();
    apiFetch<DateList>(
      `/events/${event.id}/attendance/dates/${currentDateId}${query ? `?${query}` : ''}`,
    ).then(
      (result) => {
        if (!cancelled) setList(result);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The attendance list could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, currentDateId, applied, version]);

  function changeDate(next: string) {
    setDateId(next);
    setSelected(new Set());
    setNotice(null);
  }
  function done(message: string) {
    setDialog(null);
    setSelected(new Set());
    setNotice(message);
    refresh();
  }

  if (error && !overview) {
    return (
      <StatePanel
        kind="error"
        title="Attendance unavailable"
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
    );
  }
  if (!overview) return <StatePanel kind="loading" title="Loading attendance…" />;
  if (overview.dates.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No event dates yet"
        description="Attendance is recorded per event date. Add the dates under Event dates first."
      />
    );
  }
  const date = overview.dates.find((d) => d.id === currentDateId) ?? overview.dates[0]!;
  const closed = Boolean(date.closedAt);
  const counts = list?.counts ?? date.counts;
  const sessionsOfDate = overview.sessions.filter((s) => s.eventDateId === date.id);
  const selectable = (list?.rows ?? []).filter((r) => r.daily === 'not_checked_in');
  const canAct = !readOnly;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-corp-text">
        <span className="font-semibold text-corp-ink">Overall:</span>
        <span>
          {overview.overall.attendees} of {overview.overall.registered} registered attended at least
          one day
          {overview.overall.rate !== null ? ` (${overview.overall.rate}%)` : ''}
        </span>
        <span>
          · {overview.overall.attended} {overallAttendanceLabels.attended.toLowerCase()} every day ·{' '}
          {overview.overall.partial} {overallAttendanceLabels.partial.toLowerCase()} ·{' '}
          {overview.overall.absent} absent · {overview.overall.pending} pending
        </span>
      </div>

      <div role="tablist" aria-label="Event dates" className="flex flex-wrap gap-2">
        {overview.dates.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={d.id === date.id}
            onClick={() => changeDate(d.id)}
            className={
              d.id === date.id
                ? 'min-h-10 rounded-none bg-corp-ink px-3 text-sm font-semibold text-white'
                : 'min-h-10 rounded-none border border-corp-line bg-white px-3 text-sm font-medium text-corp-text hover:bg-corp-surface'
            }
          >
            {formatDateShort(d.date)}
            {d.closedAt ? ' · closed' : ''}
          </button>
        ))}
      </div>

      <section aria-label={`Attendance on ${formatDateShort(date.date)}`} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Registered" value={counts.registered} />
          <StatTile
            label="Attended"
            value={counts.attended + counts.partial}
            tone={counts.attended + counts.partial > 0 ? 'positive' : 'neutral'}
            hint={`${counts.partial} partial · ${counts.physical} in person · ${counts.virtual} online${counts.rate !== null ? ` · ${counts.rate}%` : ''}`}
          />
          <StatTile label="Not checked in" value={counts.notCheckedIn} />
          <StatTile
            label="Absent"
            value={counts.absent}
            tone={counts.absent > 0 ? 'attention' : 'neutral'}
            hint={
              closed
                ? `Closed ${formatInstant(date.closedAt, event.timezone)}`
                : 'Recorded at closure'
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAct ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: 'scan' })}
              className={consoleButton({ variant: 'accent' })}
            >
              <QrCodeIcon aria-hidden="true" /> Scan QR code
            </button>
          ) : null}
          {sessionsOfDate.length ? (
            <NativeSelect
              aria-label="Session attendance"
              value=""
              onChange={(e) => {
                if (e.target.value) setDialog({ kind: 'session', sessionId: e.target.value });
              }}
              className="rounded-none sm:max-w-xs"
            >
              <option value="">Session attendance…</option>
              {sessionsOfDate.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.startTime} {s.title} ({s.attended} recorded)
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {canAct && !closed ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: 'close' })}
              className={`${consoleButton({ variant: 'secondary' })} sm:ml-auto`}
            >
              <LockIcon aria-hidden="true" /> Close attendance for this date
            </button>
          ) : closed ? (
            <StatusPill tone="neutral">
              Closed {formatInstant(date.closedAt, event.timezone)}
            </StatusPill>
          ) : null}
        </div>

        <form
          role="search"
          aria-label="Find delegates"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(filters);
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1">
            <label htmlFor={`${id}-q`} className="text-xs font-semibold text-corp-ink">
              Name, email or organisation
            </label>
            <input
              id={`${id}-q`}
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              className="h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-format`} className="text-xs font-semibold text-corp-ink">
              Taking part
            </label>
            <NativeSelect
              id={`${id}-format`}
              value={filters.format}
              onChange={(e) => setFilters((f) => ({ ...f, format: e.target.value }))}
              className="rounded-none"
            >
              <option value="">All</option>
              <option value="physical">In person</option>
              <option value="virtual">Online</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-status`} className="text-xs font-semibold text-corp-ink">
              Status
            </label>
            <NativeSelect
              id={`${id}-status`}
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="rounded-none"
            >
              <option value="">All</option>
              {(Object.keys(attendanceStatusLabels) as DailyAttendanceStatus[]).map((s) => (
                <option key={s} value={s}>
                  {attendanceStatusLabels[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <button type="submit" className={consoleButton({ variant: 'secondary' })}>
            <SearchIcon aria-hidden="true" /> Search
          </button>
        </form>

        {notice ? (
          <p role="status" className="text-sm font-semibold text-corp-green-text">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error.message}
          </p>
        ) : null}

        {canAct && selected.size ? (
          <div className="flex flex-wrap items-center gap-2 rounded-none border border-corp-green bg-corp-green-soft px-3 py-2 text-sm">
            <span className="font-semibold text-corp-ink">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => setDialog({ kind: 'bulk' })}
              className={consoleButton({ variant: 'accent', size: 'sm' })}
            >
              <ClipboardCheckIcon aria-hidden="true" /> Mark selected as attended
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className={consoleButton({ variant: 'ghost', size: 'sm' })}
            >
              Clear
            </button>
          </div>
        ) : null}

        <Panel flush>
          {!list ? (
            <p className="px-4 py-3 text-sm text-corp-muted" role="status">
              Loading the list…
            </p>
          ) : list.rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-corp-muted">No delegates match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                aria-label={`Delegates on ${formatDateShort(date.date)}`}
              >
                <thead className="bg-corp-surface text-xs tracking-[0.08em] text-corp-muted uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      {canAct && selectable.length ? (
                        <input
                          type="checkbox"
                          aria-label="Select everyone not checked in on this page"
                          checked={selectable.every((r) => selected.has(r.delegate.id))}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? new Set(selectable.map((r) => r.delegate.id))
                                : new Set(),
                            )
                          }
                          className="size-5 accent-corp-green"
                        />
                      ) : null}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Delegate
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Taking part
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Recorded
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.delegate.id} className="border-t border-corp-line align-top">
                      <td className="px-3 py-2">
                        {canAct && r.daily === 'not_checked_in' ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.delegate.name}`}
                            checked={selected.has(r.delegate.id)}
                            onChange={(e) =>
                              setSelected((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(r.delegate.id);
                                else next.delete(r.delegate.id);
                                return next;
                              })
                            }
                            className="size-5 accent-corp-green"
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-corp-ink">{r.delegate.name}</span>
                        <span className="block text-xs text-corp-muted">
                          {r.delegate.email}
                          {r.delegate.organisation ? ` · ${r.delegate.organisation}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-corp-text">
                        {formatLabel[r.delegate.attendanceFormat]}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill tone={dailyTone(r.daily)}>
                          {attendanceStatusLabels[r.daily]}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2 text-xs text-corp-muted">
                        {r.record
                          ? `${attendanceMethodLabels[r.record.method]} · ${formatInstant(r.record.recordedAt, event.timezone)}${r.record.recordedBy ? ` · ${r.record.recordedBy}` : ''}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {canAct && !r.record ? (
                            <button
                              type="button"
                              aria-label={`Mark attended: ${r.delegate.name}`}
                              onClick={() => setDialog({ kind: 'mark', row: r })}
                              className={consoleButton({ variant: 'secondary', size: 'sm' })}
                            >
                              <CheckIcon aria-hidden="true" /> Mark attended
                            </button>
                          ) : null}
                          {canAct && r.record ? (
                            <button
                              type="button"
                              aria-label={`Correct: ${r.delegate.name}`}
                              onClick={() =>
                                setDialog({ kind: 'correct', row: r, record: r.record! })
                              }
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              Correct
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Attendance profile: ${r.delegate.name}`}
                            onClick={() =>
                              setDialog({
                                kind: 'profile',
                                delegateId: r.delegate.id,
                                name: r.delegate.name,
                              })
                            }
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            <UserIcon aria-hidden="true" /> Profile
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      {dialog?.kind === 'scan' ? (
        <ScanDialog
          eventId={event.id}
          date={date}
          timezone={event.timezone}
          onClose={() => setDialog(null)}
          onRecorded={(name) => done(`${name} checked in.`)}
        />
      ) : null}
      {dialog?.kind === 'mark' ? (
        <MarkDialog
          eventId={event.id}
          date={date}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onRecorded={() => done(`${dialog.row.delegate.name} recorded.`)}
        />
      ) : null}
      {dialog?.kind === 'bulk' && list ? (
        <BulkDialog
          eventId={event.id}
          date={date}
          rows={list.rows.filter((r) => selected.has(r.delegate.id))}
          onClose={() => setDialog(null)}
          onRecorded={(created, skipped) =>
            done(`${created} recorded${skipped ? `, ${skipped} skipped` : ''}.`)
          }
        />
      ) : null}
      {dialog?.kind === 'correct' ? (
        <CorrectionDialog
          eventId={event.id}
          row={dialog.row}
          record={dialog.record}
          onClose={() => setDialog(null)}
          onCorrected={() => done(`${dialog.row.delegate.name} corrected.`)}
        />
      ) : null}
      {dialog?.kind === 'close' ? (
        <CloseDialog
          eventId={event.id}
          date={date}
          notCheckedIn={counts.notCheckedIn}
          onClose={() => setDialog(null)}
          onClosed={(marked) => done(`Attendance closed; ${marked} marked absent.`)}
        />
      ) : null}
      {dialog?.kind === 'profile' ? (
        <ProfileDialog
          eventId={event.id}
          timezone={event.timezone}
          delegateId={dialog.delegateId}
          name={dialog.name}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'session' ? (
        <SessionDialog
          eventId={event.id}
          sessionId={dialog.sessionId}
          readOnly={!canAct}
          onClose={() => setDialog(null)}
          onSaved={(added, removed) =>
            done(`Session attendance saved: ${added} added, ${removed} removed.`)
          }
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

function failureText(e: unknown, fallback: string) {
  return describeError(e, fallback).message;
}

function ScanDialog({
  eventId,
  date,
  timezone,
  onClose,
  onRecorded,
}: {
  eventId: string;
  date: { id: string; date: string };
  timezone: string;
  onClose: () => void;
  onRecorded: (name: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{
    delegate: AttendanceRow['delegate'];
    record: AttendanceRecordView | null;
  } | null>(null);
  const [camera, setCamera] = useState<'off' | 'on' | 'unsupported'>('off');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const id = useId();

  const lookup = useCallback(
    async (token: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await apiFetch<{
          delegate: AttendanceRow['delegate'];
          record: AttendanceRecordView | null;
        }>(`/events/${eventId}/attendance/scan`, {
          method: 'POST',
          body: JSON.stringify({ token, eventDateId: date.id }),
        });
        setFound(result);
        setCode(token);
      } catch (e) {
        setFound(null);
        setError(
          e instanceof ApiError && e.code === 'wrong_date'
            ? e.message
            : failureText(e, 'The code could not be checked.'),
        );
      } finally {
        setBusy(false);
      }
    },
    [eventId, date.id],
  );

  useEffect(() => {
    if (camera !== 'on') return undefined;
    const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) return undefined; // checked on click
    let stopped = false;
    const detector = new Ctor({ formats: ['qr_code'] });
    let timer: ReturnType<typeof setInterval> | undefined;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        timer = setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes[0]?.rawValue;
            if (value) {
              clearInterval(timer);
              setCamera('off');
              void lookup(value);
            }
          } catch {
            // A frame that cannot be read is skipped; the next one is tried.
          }
        }, 500);
      })
      .catch(() => setCamera('unsupported'));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [camera, lookup]);

  async function confirm() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/events/${eventId}/attendance/check-in`, {
        method: 'POST',
        body: JSON.stringify({ token: code, eventDateId: date.id }),
      });
      onRecorded(found.delegate.name);
    } catch (e) {
      setError(failureText(e, 'The check-in could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Scan a code for ${formatDateShort(date.date)}`}
      description="Scan the delegate's code, check the name against the person in front of you, then confirm."
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        found ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setFound(null);
                setCode('');
              }}
              className={consoleButton({ variant: 'ghost' })}
            >
              Scan another
            </button>
            {found.record ? null : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirm()}
                className={consoleButton({ variant: 'accent' })}
              >
                {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Confirm attendance
              </button>
            )}
          </>
        ) : null
      }
    >
      {found ? (
        <div className="space-y-3" role="status">
          <p className="font-corporate text-lg font-semibold text-corp-ink">
            {found.delegate.name}
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-corp-muted uppercase">Email</dt>
              <dd className="text-corp-ink">{found.delegate.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-corp-muted uppercase">Organisation</dt>
              <dd className="text-corp-ink">{found.delegate.organisation ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-corp-muted uppercase">Taking part</dt>
              <dd className="text-corp-ink">{formatLabel[found.delegate.attendanceFormat]}</dd>
            </div>
          </dl>
          {found.record ? (
            <p className="rounded-none border border-corp-line bg-corp-surface px-3 py-2 text-sm text-corp-text">
              Already recorded as {attendanceStatusLabels[found.record.status].toLowerCase()} at{' '}
              {formatInstant(found.record.recordedAt, timezone)}
              {found.record.recordedBy ? ` by ${found.record.recordedBy}` : ''}. Use a correction to
              change it.
            </p>
          ) : (
            <p className="text-sm text-corp-text">
              Does the person match this registration? Only then confirm.
            </p>
          )}
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void lookup(code.trim());
          }}
        >
          {camera === 'on' ? (
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Camera preview"
              className="aspect-square w-full bg-corp-ink object-cover"
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || camera === 'on'}
              onClick={() =>
                setCamera(
                  (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector &&
                    typeof navigator.mediaDevices?.getUserMedia === 'function'
                    ? 'on'
                    : 'unsupported',
                )
              }
              className={consoleButton({ variant: 'secondary' })}
            >
              <CameraIcon aria-hidden="true" /> Use the camera
            </button>
            {camera === 'unsupported' ? (
              <span className="text-xs text-corp-muted">
                This browser cannot scan with the camera; type or paste the code instead.
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-code`} className="text-sm font-semibold text-corp-ink">
              Code
            </label>
            <input
              id={`${id}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              className="h-11 w-full rounded-none border border-corp-line bg-white px-3 font-mono text-base md:text-sm"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy || !code.trim()} className={consoleButton()}>
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Look up
          </button>
        </form>
      )}
    </Dialog>
  );
}

function MarkDialog({
  eventId,
  date,
  row,
  onClose,
  onRecorded,
}: {
  eventId: string;
  date: { id: string; date: string };
  row: AttendanceRow;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [status, setStatus] = useState<'attended' | 'partial'>('attended');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/events/${eventId}/attendance/dates/${date.id}/mark`, {
        method: 'POST',
        body: JSON.stringify({ delegateId: row.delegate.id, status, note }),
      });
      onRecorded();
    } catch (e) {
      setError(failureText(e, 'Attendance could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Record attendance: ${row.delegate.name}`}
      description={`${formatDateShort(date.date)} · ${row.delegate.email} · ${formatLabel[row.delegate.attendanceFormat]}. Check the person against this registration first.`}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={consoleButton({ variant: 'ghost' })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Confirm attendance
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
            Attendance
          </label>
          <NativeSelect
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as 'attended' | 'partial')}
            className="rounded-none"
          >
            <option value="attended">Attended</option>
            <option value="partial">Partially attended</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-note`} className="text-sm font-semibold text-corp-ink">
            Note (optional)
          </label>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function BulkDialog({
  eventId,
  date,
  rows,
  onClose,
  onRecorded,
}: {
  eventId: string;
  date: { id: string; date: string };
  rows: AttendanceRow[];
  onClose: () => void;
  onRecorded: (created: number, skipped: number) => void;
}) {
  const [status, setStatus] = useState<'attended' | 'partial'>('attended');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ created: number; skipped: Array<{ delegateId: string }> }>(
        `/events/${eventId}/attendance/dates/${date.id}/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({ delegateIds: rows.map((r) => r.delegate.id), status }),
        },
      );
      onRecorded(result.created, result.skipped.length);
    } catch (e) {
      setError(failureText(e, 'The attendance could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Mark ${rows.length} delegate${rows.length === 1 ? '' : 's'} on ${formatDateShort(date.date)}`}
      description="Review the list before saving. Delegates already recorded are skipped, never duplicated."
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={consoleButton({ variant: 'ghost' })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Save attendance
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
            Record as
          </label>
          <NativeSelect
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as 'attended' | 'partial')}
            className="rounded-none"
          >
            <option value="attended">Attended</option>
            <option value="partial">Partially attended</option>
          </NativeSelect>
        </div>
        <ul
          aria-label="Selected delegates"
          className="max-h-72 divide-y divide-corp-line overflow-y-auto text-sm"
        >
          {rows.map((r) => (
            <li key={r.delegate.id} className="flex justify-between gap-2 py-1.5">
              <span className="font-semibold text-corp-ink">{r.delegate.name}</span>
              <span className="text-corp-muted">{formatLabel[r.delegate.attendanceFormat]}</span>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function CorrectionDialog({
  eventId,
  row,
  record,
  onClose,
  onCorrected,
}: {
  eventId: string;
  row: AttendanceRow;
  record: AttendanceRecordView;
  onClose: () => void;
  onCorrected: () => void;
}) {
  const [status, setStatus] = useState(record.status);
  const [mode, setMode] = useState(record.mode);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function save() {
    if (reason.trim().length < 3) {
      setError('Give the reason for the correction.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/events/${eventId}/attendance/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, mode, reason: reason.trim() }),
      });
      onCorrected();
    } catch (e) {
      setError(failureText(e, 'The correction could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Correct attendance: ${row.delegate.name}`}
      description={`Currently ${attendanceStatusLabels[record.status].toLowerCase()} (${attendanceMethodLabels[record.method].toLowerCase()}). The original value stays in the audit history.`}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={consoleButton({ variant: 'ghost' })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Save correction
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
              Attendance
            </label>
            <NativeSelect
              id={`${id}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="rounded-none"
            >
              <option value="attended">Attended</option>
              <option value="partial">Partially attended</option>
              <option value="absent">Absent</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-mode`} className="text-sm font-semibold text-corp-ink">
              Took part
            </label>
            <NativeSelect
              id={`${id}-mode`}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="rounded-none"
            >
              <option value="physical">In person</option>
              <option value="virtual">Online</option>
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-reason`} className="text-sm font-semibold text-corp-ink">
            Reason
          </label>
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function CloseDialog({
  eventId,
  date,
  notCheckedIn,
  onClose,
  onClosed,
}: {
  eventId: string;
  date: { id: string; date: string };
  notCheckedIn: number;
  onClose: () => void;
  onClosed: (markedAbsent: number) => void;
}) {
  const [markAbsent, setMarkAbsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ markedAbsent: number }>(
        `/events/${eventId}/attendance/dates/${date.id}/close`,
        { method: 'POST', body: JSON.stringify({ markAbsent }) },
      );
      onClosed(result.markedAbsent);
    } catch (e) {
      setError(failureText(e, 'Attendance could not be closed.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Close attendance for ${formatDateShort(date.date)}`}
      description="Closing ends the attendance period for this date. Later changes go through corrections, which are audited."
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={consoleButton({ variant: 'ghost' })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Close attendance
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-corp-text">
        <p>
          <span className="font-semibold text-corp-ink">{notCheckedIn}</span> registered delegate
          {notCheckedIn === 1 ? ' has' : 's have'} no attendance record for this date.
        </p>
        <label className="flex min-h-tap items-center gap-2 text-corp-ink">
          <input
            type="checkbox"
            checked={markAbsent}
            onChange={(e) => setMarkAbsent(e.target.checked)}
            className="size-5 accent-corp-green"
          />
          Mark them absent now
        </label>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function ProfileDialog({
  eventId,
  timezone,
  delegateId,
  name,
  onClose,
}: {
  eventId: string;
  timezone: string;
  delegateId: string;
  name: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; profile: DelegateAttendanceProfile }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ profile: DelegateAttendanceProfile }>(
      `/events/${eventId}/attendance/delegates/${delegateId}`,
    ).then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', profile: r.profile });
      },
      (e: unknown) => {
        if (!cancelled)
          setState({ kind: 'error', message: failureText(e, 'The profile could not be loaded.') });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, delegateId]);
  return (
    <Dialog
      title={`Attendance profile: ${name}`}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className={consoleButton({ variant: 'secondary' })}>
          Close
        </button>
      }
    >
      {state.kind === 'loading' ? (
        <p role="status" className="text-sm text-corp-muted">
          Loading…
        </p>
      ) : state.kind === 'error' ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={
                state.profile.overall === 'attended' || state.profile.overall === 'partial'
                  ? 'positive'
                  : state.profile.overall === 'absent'
                    ? 'attention'
                    : 'neutral'
              }
            >
              {overallAttendanceLabels[state.profile.overall]}
            </StatusPill>
            <span className="text-corp-text">
              {state.profile.delegate.email} ·{' '}
              {formatLabel[state.profile.delegate.attendanceFormat]} · registration{' '}
              {state.profile.delegate.registrationStatus}
            </span>
          </div>
          <section aria-label="Dates" className="space-y-2">
            <h3 className="font-corporate text-sm font-semibold text-corp-ink">Event dates</h3>
            <ul className="divide-y divide-corp-line">
              {state.profile.dates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-corp-ink">{formatDateShort(d.date)}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={dailyTone(d.daily)}>
                      {attendanceStatusLabels[d.daily]}
                    </StatusPill>
                    <span className="text-xs text-corp-muted">
                      {d.record
                        ? `${attendanceMethodLabels[d.record.method]} · ${formatInstant(d.record.recordedAt, timezone)}${d.record.recordedBy ? ` · ${d.record.recordedBy}` : ''}`
                        : d.closedAt
                          ? 'closed'
                          : 'open'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Sessions" className="space-y-2">
            <h3 className="font-corporate text-sm font-semibold text-corp-ink">
              Sessions: {state.profile.sessionsAttended} of {state.profile.sessionsTotal} recorded
            </h3>
            {state.profile.sessions.length ? (
              <ul className="divide-y divide-corp-line">
                {state.profile.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <span className="text-corp-ink">
                      {formatDateShort(s.date)} {s.startTime} · {s.title}
                    </span>
                    <StatusPill tone={s.attended ? 'positive' : 'neutral'}>
                      {s.attended ? 'Attended' : 'Not recorded'}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-corp-muted">No sessions scheduled.</p>
            )}
          </section>
          <section aria-label="History" className="space-y-2">
            <h3 className="font-corporate text-sm font-semibold text-corp-ink">History</h3>
            {state.profile.history.length ? (
              <ul className="divide-y divide-corp-line text-xs text-corp-text">
                {state.profile.history.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="py-1.5">
                    <span className="font-semibold text-corp-ink">
                      {h.action === 'attendance.corrected' ? 'Correction' : 'Recorded'}
                    </span>{' '}
                    · {formatInstant(h.at, timezone)}
                    {h.by ? ` · ${h.by}` : ''}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-corp-muted">Nothing recorded yet.</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function SessionDialog({
  eventId,
  sessionId,
  readOnly,
  onClose,
  onSaved,
}: {
  eventId: string;
  sessionId: string;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (added: number, removed: number) => void;
}) {
  const [list, setList] = useState<SessionAttendanceList | null>(null);
  const [present, setPresent] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    let cancelled = false;
    apiFetch<SessionAttendanceList>(`/events/${eventId}/attendance/sessions/${sessionId}`).then(
      (r) => {
        if (cancelled) return;
        setList(r);
        setPresent(new Set(r.rows.filter((x) => x.attended).map((x) => x.delegate.id)));
      },
      (e: unknown) => {
        if (!cancelled) setError(failureText(e, 'The session could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, sessionId]);
  const original = new Set(list?.rows.filter((x) => x.attended).map((x) => x.delegate.id) ?? []);
  const add = [...present].filter((x) => !original.has(x));
  const remove = [...original].filter((x) => !present.has(x));
  async function save() {
    if (remove.length && reason.trim().length < 3) {
      setError('Give the reason for removing a recorded presence.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ added: number; removed: number }>(
        `/events/${eventId}/attendance/sessions/${sessionId}`,
        { method: 'POST', body: JSON.stringify({ add, remove, reason: reason.trim() }) },
      );
      onSaved(result.added, result.removed);
    } catch (e) {
      setError(failureText(e, 'Session attendance could not be saved.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={list ? `Session attendance: ${list.session.title}` : 'Session attendance'}
      description={
        list
          ? `${formatDateShort(list.session.date)} ${list.session.startTime}–${list.session.endTime} · ${list.counts.attended} of ${list.counts.registered} recorded${list.counts.rate !== null ? ` (${list.counts.rate}%)` : ''}`
          : undefined
      }
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={consoleButton({ variant: 'ghost' })}
          >
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly ? (
            <button
              type="button"
              disabled={busy || !list || (add.length === 0 && remove.length === 0)}
              onClick={() => void save()}
              className={consoleButton({ variant: 'accent' })}
            >
              {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              Save session attendance
            </button>
          ) : null}
        </>
      }
    >
      {!list ? (
        <p role="status" className="text-sm text-corp-muted">
          Loading…
        </p>
      ) : (
        <div className="space-y-3">
          <ul
            aria-label="Delegates"
            className="max-h-96 divide-y divide-corp-line overflow-y-auto text-sm"
          >
            {list.rows.map((r) => (
              <li key={r.delegate.id} className="py-1">
                <label className="flex min-h-tap items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={readOnly || busy}
                    checked={present.has(r.delegate.id)}
                    onChange={(e) =>
                      setPresent((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(r.delegate.id);
                        else next.delete(r.delegate.id);
                        return next;
                      })
                    }
                    className="size-5 accent-corp-green"
                  />
                  <span className="font-semibold text-corp-ink">{r.delegate.name}</span>
                  <span className="text-xs text-corp-muted">
                    {formatLabel[r.delegate.attendanceFormat]}
                    {r.recordedAt ? ` · recorded${r.recordedBy ? ` by ${r.recordedBy}` : ''}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {remove.length ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-reason`} className="text-sm font-semibold text-corp-ink">
                Reason for removing {remove.length} recorded presence
                {remove.length === 1 ? '' : 's'}
              </label>
              <input
                id={`${id}-reason`}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
