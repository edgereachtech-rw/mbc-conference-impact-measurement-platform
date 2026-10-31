'use client';

import {
  sessionCreateSchema,
  sessionTypes,
  type EventDetail,
  type EventSessionView,
} from '@mbc/shared';
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { consoleButton, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatDateLong, scheduleOf, sessionTypeLabels } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface SessionsEditorProps {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}

interface SessionDraft {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  sessionType: string;
  description: string;
  venue: string;
  speaker: string;
  capacity: string;
  feedbackEnabled: boolean;
  transferPlanningFinal: boolean;
}

function draftOf(session: EventSessionView | null, defaultDate: string): SessionDraft {
  return {
    title: session?.title ?? '',
    date: session?.date ?? defaultDate,
    startTime: session?.startTime ?? '09:00',
    endTime: session?.endTime ?? '10:00',
    sessionType: session?.sessionType ?? 'plenary',
    description: session?.description ?? '',
    venue: session?.venue ?? '',
    speaker: session?.speaker ?? '',
    capacity: session?.capacity ? String(session.capacity) : '',
    feedbackEnabled: session?.feedbackEnabled ?? false,
    transferPlanningFinal: session?.transferPlanningFinal ?? false,
  };
}

/**
 * Sessions and schedule (brief section 5): optional, each on one of the selected dates, grouped
 * by date in time order; dates without sessions still appear. Add, edit and delete go through
 * the admin-only API, which validates again.
 */
export function SessionsEditor({ event, onSaved }: SessionsEditorProps) {
  const [editing, setEditing] = useState<null | { id: string | null; draft: SessionDraft }>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const id = useId();
  const schedule = scheduleOf(event);
  const readOnly = event.status === 'archived';

  function startAdd(date?: string) {
    setFailure(null);
    setErrors({});
    setEditing({ id: null, draft: draftOf(null, date ?? event.dates[0]?.date ?? '') });
  }
  function startEdit(session: EventSessionView) {
    setFailure(null);
    setErrors({});
    setEditing({ id: session.id, draft: draftOf(session, session.date) });
  }
  function set<K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) {
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e));
    setErrors((errs) => {
      if (!errs[key]) return errs;
      const copy = { ...errs };
      delete copy[key];
      return copy;
    });
  }

  async function save() {
    if (!editing) return;
    const payload = {
      ...editing.draft,
      capacity: editing.draft.capacity.trim() === '' ? null : Number(editing.draft.capacity),
    };
    const parsed = sessionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0] ?? 'form')] ??= issue.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const path = editing.id
        ? `/events/${event.id}/sessions/${editing.id}`
        : `/events/${event.id}/sessions`;
      const result = await apiFetch<{ event: EventDetail }>(path, {
        method: editing.id ? 'PATCH' : 'POST',
        body: JSON.stringify(parsed.data),
      });
      onSaved(result.event);
      setEditing(null);
    } catch (e) {
      setFailure(describeError(e, 'The session could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(sessionId: string) {
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(
        `/events/${event.id}/sessions/${sessionId}`,
        { method: 'DELETE' },
      );
      onSaved(result.event);
      setConfirmDelete(null);
    } catch (e) {
      setFailure(describeError(e, 'The session could not be deleted.'));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p role="alert" className="text-xs text-brand-danger">
        {errors[key]}
      </p>
    ) : null;
  const inputClass =
    'h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-corp-text">
          Sessions are optional. {event.sessions.length} scheduled across {event.dates.length}{' '}
          {event.dates.length === 1 ? 'date' : 'dates'}.
        </p>
        {!readOnly && event.dates.length > 0 ? (
          <button
            type="button"
            onClick={() => startAdd()}
            disabled={busy || editing !== null}
            className={consoleButton({ variant: 'accent' })}
          >
            <PlusIcon aria-hidden="true" /> Add session
          </button>
        ) : null}
      </div>

      {failure ? (
        <div
          role="alert"
          className="rounded-none border border-brand-danger/40 bg-white p-3 text-sm"
        >
          <p className="font-semibold text-brand-danger">{failure.message}</p>
          {failure.requestId ? (
            <p className="mt-1 text-xs text-corp-muted">Request id {failure.requestId}</p>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <form
          noValidate
          aria-label={editing.id ? 'Edit session' : 'New session'}
          className="space-y-4 rounded-none border border-corp-green bg-white p-4 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3 className="font-corporate text-base font-semibold text-corp-ink">
            {editing.id ? 'Edit session' : 'New session'}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <label htmlFor={`${id}-title`} className="text-sm font-semibold text-corp-ink">
                Session title
              </label>
              <input
                id={`${id}-title`}
                value={editing.draft.title}
                maxLength={200}
                onChange={(e) => set('title', e.target.value)}
                className={inputClass}
              />
              {fieldError('title')}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-date`} className="text-sm font-semibold text-corp-ink">
                Session date
              </label>
              <NativeSelect
                id={`${id}-date`}
                value={editing.draft.date}
                onChange={(e) => set('date', e.target.value)}
                className="rounded-none"
              >
                {event.dates.map((d) => (
                  <option key={d.id} value={d.date}>
                    {formatDateLong(d.date)}
                  </option>
                ))}
              </NativeSelect>
              {fieldError('date')}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-type`} className="text-sm font-semibold text-corp-ink">
                Session type
              </label>
              <NativeSelect
                id={`${id}-type`}
                value={editing.draft.sessionType}
                onChange={(e) => set('sessionType', e.target.value)}
                className="rounded-none"
              >
                {sessionTypes.map((t) => (
                  <option key={t} value={t}>
                    {sessionTypeLabels[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-start`} className="text-sm font-semibold text-corp-ink">
                Start time
              </label>
              <input
                id={`${id}-start`}
                type="time"
                value={editing.draft.startTime}
                onChange={(e) => set('startTime', e.target.value)}
                className={inputClass}
              />
              {fieldError('startTime')}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-end`} className="text-sm font-semibold text-corp-ink">
                End time
              </label>
              <input
                id={`${id}-end`}
                type="time"
                value={editing.draft.endTime}
                onChange={(e) => set('endTime', e.target.value)}
                className={inputClass}
              />
              {fieldError('endTime')}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-speaker`} className="text-sm font-semibold text-corp-ink">
                Speaker or facilitator (optional)
              </label>
              <input
                id={`${id}-speaker`}
                value={editing.draft.speaker}
                maxLength={200}
                onChange={(e) => set('speaker', e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-venue`} className="text-sm font-semibold text-corp-ink">
                Venue or room (optional)
              </label>
              <input
                id={`${id}-venue`}
                value={editing.draft.venue}
                maxLength={200}
                onChange={(e) => set('venue', e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-capacity`} className="text-sm font-semibold text-corp-ink">
                Capacity (optional)
              </label>
              <input
                id={`${id}-capacity`}
                type="number"
                min={1}
                inputMode="numeric"
                value={editing.draft.capacity}
                onChange={(e) => set('capacity', e.target.value)}
                className={inputClass}
              />
              {fieldError('capacity')}
            </div>
            <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
              <input
                type="checkbox"
                checked={editing.draft.feedbackEnabled}
                onChange={(e) => set('feedbackEnabled', e.target.checked)}
                className="size-5 accent-corp-green"
              />
              Collect session-specific feedback
            </label>
            {editing.draft.sessionType === 'transfer_planning' ? (
              <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink md:col-span-2">
                <input
                  type="checkbox"
                  checked={editing.draft.transferPlanningFinal}
                  onChange={(e) => set('transferPlanningFinal', e.target.checked)}
                  className="size-5 accent-corp-green"
                />
                Final Transfer Planning session: delegates submit their plan from the start of this
                session (otherwise the last planning session counts)
              </label>
            ) : null}
            <div className="space-y-1 md:col-span-2">
              <label htmlFor={`${id}-description`} className="text-sm font-semibold text-corp-ink">
                Description (optional)
              </label>
              <textarea
                id={`${id}-description`}
                rows={3}
                value={editing.draft.description}
                onChange={(e) => set('description', e.target.value)}
                className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
              className={consoleButton({ variant: 'ghost' })}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className={consoleButton({ variant: 'accent' })}>
              {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {editing.id ? 'Save session' : 'Add session'}
            </button>
          </div>
        </form>
      ) : null}

      <ol className="space-y-4" aria-label="Schedule">
        {schedule.map((day) => (
          <li key={day.eventDateId} className="rounded-none border border-corp-line bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-corp-line bg-corp-surface px-4 py-2">
              <h3 className="text-sm font-semibold text-corp-ink">{formatDateLong(day.date)}</h3>
              <span className="text-xs text-corp-muted">
                {day.sessions.length === 0
                  ? 'No sessions'
                  : `${day.sessions.length} session${day.sessions.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {day.sessions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-corp-muted">
                No sessions on this date yet.
                {!readOnly ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => startAdd(day.date)}
                      disabled={busy || editing !== null}
                      className="font-semibold text-corp-green-text hover:underline"
                    >
                      Add one
                    </button>
                  </>
                ) : null}
              </p>
            ) : (
              <ul className="divide-y divide-corp-line">
                {day.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start"
                  >
                    <p className="w-28 shrink-0 text-sm font-semibold text-corp-ink tabular-nums">
                      {s.startTime}–{s.endTime}
                    </p>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-corp-ink">{s.title}</p>
                        <StatusPill tone="neutral">{sessionTypeLabels[s.sessionType]}</StatusPill>
                        {s.feedbackEnabled ? (
                          <StatusPill tone="positive">Feedback</StatusPill>
                        ) : null}
                        {s.transferPlanningFinal ? (
                          <StatusPill tone="positive">Final planning session</StatusPill>
                        ) : null}
                      </div>
                      <p className="text-xs text-corp-muted">
                        {[s.speaker, s.venue, s.capacity ? `Capacity ${s.capacity}` : null]
                          .filter(Boolean)
                          .join(' · ') || 'No speaker, venue or capacity set'}
                      </p>
                      {s.description ? (
                        <p className="mt-1 text-sm text-corp-text">{s.description}</p>
                      ) : null}
                    </div>
                    {!readOnly ? (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(s)}
                          disabled={busy || editing !== null}
                          aria-label={`Edit ${s.title}`}
                          className={consoleButton({ variant: 'ghost', size: 'sm' })}
                        >
                          <PencilIcon aria-hidden="true" /> Edit
                        </button>
                        {confirmDelete === s.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void remove(s.id)}
                              disabled={busy}
                              className={consoleButton({ variant: 'danger', size: 'sm' })}
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(s.id)}
                            disabled={busy || editing !== null}
                            aria-label={`Delete ${s.title}`}
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            <Trash2Icon aria-hidden="true" /> Delete
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
