'use client';

import {
  reflectionActivityFieldsSchema,
  reflectionQuestionTypeLabels,
  reflectionQuestionTypes,
  reflectionStatusLabels,
  reflectionWindowState,
  type EventDetail,
  type ReflectionActivityView,
  type ReflectionConcern,
  type ReflectionDateView,
  type ReflectionQuestionView,
  type ReflectionResponses,
} from '@mbc/shared';
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, Panel, StatePanel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant, isoToZonedLocal, zonedLocalToIso } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface ReflectionsManagerProps {
  event: EventDetail;
}

type DialogState =
  | { kind: 'question'; activity: ReflectionActivityView; question: ReflectionQuestionView | null }
  | { kind: 'preview'; activity: ReflectionActivityView }
  | { kind: 'responses'; activity: ReflectionActivityView }
  | null;

const windowText = {
  hidden: 'Not shown to delegates',
  upcoming: 'Opens later',
  open: 'Open to delegates',
  closed: 'Closed',
} as const;

/**
 * Daily Learning Reflections (task of 2026-10-31): one optional questionnaire per event date.
 * Enable a date, write its questions, set the window, preview, publish, then read the responses
 * by delegate or by question. Answers to concern questions are listed first so the organisers
 * see them without searching. Admins only.
 */
export function ReflectionsManager({ event }: ReflectionsManagerProps) {
  const [dates, setDates] = useState<ReflectionDateView[] | null>(null);
  const [concerns, setConcerns] = useState<ReflectionConcern[]>([]);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [version, setVersion] = useState(0);
  const readOnly = event.status === 'archived';
  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ dates: ReflectionDateView[]; concerns: ReflectionConcern[] }>(
      `/events/${event.id}/reflections`,
    ).then(
      (r) => {
        if (cancelled) return;
        setDates(r.dates);
        setConcerns(r.concerns);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The reflections could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, version]);

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    refresh();
  }

  if (error && !dates) {
    return (
      <StatePanel
        kind="error"
        title="Reflections unavailable"
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
  if (!dates) return <StatePanel kind="loading" title="Loading reflections…" />;
  if (dates.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No event dates yet"
        description="A daily reflection belongs to an event date. Add the dates under Event dates first."
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-corp-text">
        A short questionnaire delegates answer at the end of a conference day. Enable it per date,
        write that day’s questions, set when it opens and closes, then publish. Reflections are
        separate from attendance, session feedback, the Transfer Plan and the assessments.
      </p>

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangleIcon className="size-4 text-corp-accent" aria-hidden="true" />
          <h3 className="font-corporate text-sm font-semibold text-corp-ink">
            Participant concerns ({concerns.length})
          </h3>
          <span className="text-xs text-corp-muted">
            Answers to questions marked as concerns, newest first, for the team to address.
          </span>
        </div>
        {concerns.length === 0 ? (
          <p className="mt-2 text-sm text-corp-muted">No concerns submitted yet.</p>
        ) : (
          <ul aria-label="Participant concerns" className="mt-3 divide-y divide-corp-line text-sm">
            {concerns.map((c, i) => (
              <li
                key={`${c.activityId}-${c.delegate.id}-${c.questionId}-${i}`}
                className="space-y-1 py-2"
              >
                <p className="text-corp-ink">{c.value}</p>
                <p className="text-xs text-corp-muted">
                  {c.delegate.name}
                  {c.delegate.organisation ? ` · ${c.delegate.organisation}` : ''} ·{' '}
                  {formatDateShort(c.date)} · {c.activityTitle} ·{' '}
                  {formatInstant(c.submittedAt, event.timezone)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

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

      <div className="grid gap-4 xl:grid-cols-2">
        {dates.map((d) => (
          <DateCard
            key={d.date.id}
            event={event}
            view={d}
            readOnly={readOnly}
            onChanged={done}
            onError={(message) => setError({ message })}
            onDialog={setDialog}
          />
        ))}
      </div>

      {dialog?.kind === 'question' ? (
        <QuestionDialog
          eventId={event.id}
          activity={dialog.activity}
          question={dialog.question}
          onClose={() => setDialog(null)}
          onSaved={() => done(dialog.question ? 'Question saved.' : 'Question added.')}
        />
      ) : null}
      {dialog?.kind === 'preview' ? (
        <Dialog
          title={`Preview: ${dialog.activity.title}`}
          description={`As delegates see it on ${formatDateShort(dialog.activity.date)}.`}
          onClose={() => setDialog(null)}
          footer={
            <button
              type="button"
              onClick={() => setDialog(null)}
              className={consoleButton({ variant: 'secondary' })}
            >
              Close
            </button>
          }
        >
          <ol className="space-y-4">
            {dialog.activity.questions.map((q, i) => (
              <li key={q.id} className="space-y-1">
                <p className="text-sm font-semibold text-corp-ink">
                  {i + 1}. {q.prompt}
                  {q.required ? <span className="text-danger"> *</span> : null}
                </p>
                {q.type === 'long_text' ? (
                  <textarea
                    disabled
                    rows={3}
                    className="w-full rounded-none border border-corp-line bg-corp-surface px-3 py-2 text-sm"
                  />
                ) : (
                  <input
                    disabled
                    className="h-11 w-full rounded-none border border-corp-line bg-corp-surface px-3 text-sm"
                  />
                )}
              </li>
            ))}
          </ol>
        </Dialog>
      ) : null}
      {dialog?.kind === 'responses' ? (
        <ResponsesDialog
          eventId={event.id}
          timezone={event.timezone}
          activity={dialog.activity}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function DateCard({
  event,
  view,
  readOnly,
  onChanged,
  onError,
  onDialog,
}: {
  event: EventDetail;
  view: ReflectionDateView;
  readOnly: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onDialog: (d: DialogState) => void;
}) {
  const activity = view.activity;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: activity?.title ?? '',
    opensAt: isoToZonedLocal(activity?.opensAt ?? null, event.timezone),
    closesAt: isoToZonedLocal(activity?.closesAt ?? null, event.timezone),
  });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const id = useId();
  const base = activity ? `/events/${event.id}/reflections/${activity.id}` : null;
  const seen = activity ? reflectionWindowState(activity, new Date()) : null;

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await work();
      onChanged(message);
    } catch (e) {
      onError(describeError(e, 'The change could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }
  function saveWindow() {
    if (!base) return;
    const opensAt = draft.opensAt ? zonedLocalToIso(draft.opensAt, event.timezone) : null;
    const closesAt = draft.closesAt ? zonedLocalToIso(draft.closesAt, event.timezone) : null;
    const parsed = reflectionActivityFieldsSchema.safeParse({
      title: draft.title,
      opensAt,
      closesAt,
    });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Check the fields.');
      return;
    }
    setFieldError(null);
    void run(
      () => apiFetch(base, { method: 'PATCH', body: JSON.stringify(parsed.data) }),
      'Reflection saved.',
    );
  }

  return (
    <Panel>
      <article
        aria-label={`Reflection for ${formatDateShort(view.date.date)}`}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-corporate text-base font-semibold text-corp-ink">
            {formatDateShort(view.date.date)}
          </h3>
          {activity ? (
            <span className="flex flex-wrap gap-2">
              <StatusPill tone={activity.status === 'published' ? 'positive' : 'neutral'}>
                {reflectionStatusLabels[activity.status]}
              </StatusPill>
              {seen && seen !== 'hidden' ? (
                <StatusPill tone={seen === 'open' ? 'positive' : 'attention'}>
                  {windowText[seen]}
                </StatusPill>
              ) : null}
            </span>
          ) : (
            <StatusPill tone="neutral">Disabled</StatusPill>
          )}
        </div>

        {!activity ? (
          <div className="space-y-2">
            <p className="text-sm text-corp-muted">No reflection for this date.</p>
            {!readOnly ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      apiFetch(`/events/${event.id}/reflections/dates/${view.date.id}`, {
                        method: 'POST',
                        body: JSON.stringify({
                          title: `Reflection for ${formatDateShort(view.date.date)}`,
                        }),
                      }),
                    'Reflection enabled as a draft.',
                  )
                }
                className={consoleButton({ variant: 'accent' })}
              >
                <PlusIcon aria-hidden="true" /> Enable a daily reflection
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <form
              noValidate
              aria-label={`Settings: ${formatDateShort(view.date.date)}`}
              onSubmit={(e) => {
                e.preventDefault();
                saveWindow();
              }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={`${id}-title`} className="text-sm font-semibold text-corp-ink">
                  Title
                </label>
                <input
                  id={`${id}-title`}
                  value={draft.title}
                  maxLength={200}
                  disabled={readOnly || busy}
                  onChange={(e) => setDraft((x) => ({ ...x, title: e.target.value }))}
                  className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-opens`} className="text-sm font-semibold text-corp-ink">
                  Opens
                </label>
                <input
                  id={`${id}-opens`}
                  type="datetime-local"
                  value={draft.opensAt}
                  disabled={readOnly || busy}
                  onChange={(e) => setDraft((x) => ({ ...x, opensAt: e.target.value }))}
                  className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-closes`} className="text-sm font-semibold text-corp-ink">
                  Deadline
                </label>
                <input
                  id={`${id}-closes`}
                  type="datetime-local"
                  value={draft.closesAt}
                  disabled={readOnly || busy}
                  onChange={(e) => setDraft((x) => ({ ...x, closesAt: e.target.value }))}
                  className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
                />
              </div>
              {fieldError ? (
                <p role="alert" className="text-xs text-danger sm:col-span-2">
                  {fieldError}
                </p>
              ) : null}
              <p className="text-xs text-corp-muted sm:col-span-2">
                Times in {event.timezone}. Without an opening time a published reflection is open at
                once; without a deadline it stays open until closed. {activity.submitted} of{' '}
                {activity.registered} submitted.
              </p>
              {!readOnly ? (
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className={consoleButton({ variant: 'secondary', size: 'sm' })}
                  >
                    Save settings
                  </button>
                  {activity.status === 'draft' ? (
                    <button
                      type="button"
                      disabled={busy || activity.questions.length === 0}
                      onClick={() =>
                        void run(
                          () => apiFetch(`${base}/publish`, { method: 'POST', body: '{}' }),
                          'Reflection published.',
                        )
                      }
                      className={consoleButton({ variant: 'accent', size: 'sm' })}
                    >
                      Publish
                    </button>
                  ) : null}
                  {activity.status === 'published' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => apiFetch(`${base}/close`, { method: 'POST', body: '{}' }),
                          'Reflection closed.',
                        )
                      }
                      className={consoleButton({ variant: 'secondary', size: 'sm' })}
                    >
                      Close
                    </button>
                  ) : null}
                  {activity.submitted === 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => apiFetch(base!, { method: 'DELETE' }),
                          'Reflection disabled for this date.',
                        )
                      }
                      className={consoleButton({ variant: 'ghost', size: 'sm' })}
                    >
                      <Trash2Icon aria-hidden="true" /> Disable
                    </button>
                  ) : null}
                </div>
              ) : null}
            </form>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-corp-ink">
                  Questions ({activity.questions.length})
                </h4>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => onDialog({ kind: 'preview', activity })}
                    className={consoleButton({ variant: 'ghost', size: 'sm' })}
                  >
                    <EyeIcon aria-hidden="true" /> Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => onDialog({ kind: 'responses', activity })}
                    className={consoleButton({ variant: 'secondary', size: 'sm' })}
                  >
                    Responses ({activity.submitted})
                  </button>
                  {!readOnly ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDialog({ kind: 'question', activity, question: null })}
                      className={consoleButton({ variant: 'accent', size: 'sm' })}
                    >
                      <PlusIcon aria-hidden="true" /> Add question
                    </button>
                  ) : null}
                </div>
              </div>
              {activity.questions.length === 0 ? (
                <p className="text-sm text-corp-muted">
                  Add at least one question before publishing.
                </p>
              ) : (
                <ol
                  aria-label={`Questions for ${formatDateShort(view.date.date)}`}
                  className="divide-y divide-corp-line text-sm"
                >
                  {activity.questions.map((q, i) => (
                    <li
                      key={q.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-corp-ink">
                          {i + 1}. {q.prompt}
                        </p>
                        <p className="flex flex-wrap gap-2 text-xs text-corp-muted">
                          <span>{reflectionQuestionTypeLabels[q.type]}</span>
                          <span>{q.required ? 'Required' : 'Optional'}</span>
                          {q.concern ? <StatusPill tone="attention">Concern</StatusPill> : null}
                          {q.version > 1 ? <span>version {q.version}</span> : null}
                          {q.responseCount ? <span>{q.responseCount} answers</span> : null}
                        </p>
                      </div>
                      {!readOnly ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            aria-label={`Move up: ${q.prompt}`}
                            disabled={busy || i === 0}
                            onClick={() => {
                              const ids = activity.questions.map((x) => x.id);
                              [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
                              void run(
                                () =>
                                  apiFetch(`${base}/questions/order`, {
                                    method: 'PUT',
                                    body: JSON.stringify({ questionIds: ids }),
                                  }),
                                'Order saved.',
                              );
                            }}
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            <ArrowUpIcon aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move down: ${q.prompt}`}
                            disabled={busy || i === activity.questions.length - 1}
                            onClick={() => {
                              const ids = activity.questions.map((x) => x.id);
                              [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!];
                              void run(
                                () =>
                                  apiFetch(`${base}/questions/order`, {
                                    method: 'PUT',
                                    body: JSON.stringify({ questionIds: ids }),
                                  }),
                                'Order saved.',
                              );
                            }}
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            <ArrowDownIcon aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Edit: ${q.prompt}`}
                            disabled={busy}
                            onClick={() => onDialog({ kind: 'question', activity, question: q })}
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            <PencilIcon aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove: ${q.prompt}`}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => apiFetch(`${base}/questions/${q.id}`, { method: 'DELETE' }),
                                q.responseCount
                                  ? 'Question retired; its answers are kept.'
                                  : 'Question removed.',
                              )
                            }
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            <Trash2Icon aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </article>
    </Panel>
  );
}

function QuestionDialog({
  eventId,
  activity,
  question,
  onClose,
  onSaved,
}: {
  eventId: string;
  activity: ReflectionActivityView;
  question: ReflectionQuestionView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    prompt: question?.prompt ?? '',
    type: question?.type ?? ('long_text' as const),
    required: question?.required ?? true,
    concern: question?.concern ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function save() {
    if (!draft.prompt.trim()) {
      setError('Write the question.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = `/events/${eventId}/reflections/${activity.id}/questions`;
      await apiFetch(question ? `${base}/${question.id}` : base, {
        method: question ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...draft, prompt: draft.prompt.trim() }),
      });
      onSaved();
    } catch (e) {
      setError(describeError(e, 'The question could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={question ? 'Edit question' : 'New question'}
      description={
        question?.responseCount
          ? `${question.responseCount} delegates answered this wording; changing it creates a new version and keeps their answers on the old one.`
          : `${activity.title} · ${formatDateShort(activity.date)}`
      }
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
            {question ? 'Save question' : 'Add question'}
          </button>
        </>
      }
    >
      <form
        noValidate
        aria-label={question ? 'Edit reflection question' : 'New reflection question'}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-3"
      >
        <div className="space-y-1">
          <label htmlFor={`${id}-prompt`} className="text-sm font-semibold text-corp-ink">
            Question
          </label>
          <textarea
            id={`${id}-prompt`}
            rows={3}
            maxLength={500}
            value={draft.prompt}
            onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-type`} className="text-sm font-semibold text-corp-ink">
            Response type
          </label>
          <NativeSelect
            id={`${id}-type`}
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as typeof d.type }))}
            className="rounded-none"
          >
            {reflectionQuestionTypes.map((t) => (
              <option key={t} value={t}>
                {reflectionQuestionTypeLabels[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))}
            className="size-5 accent-corp-green"
          />
          Required
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
          <input
            type="checkbox"
            checked={draft.concern}
            onChange={(e) => setDraft((d) => ({ ...d, concern: e.target.checked }))}
            className="size-5 accent-corp-green"
          />
          Answers are participant concerns the team must see promptly
        </label>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function ResponsesDialog({
  eventId,
  timezone,
  activity,
  onClose,
}: {
  eventId: string;
  timezone: string;
  activity: ReflectionActivityView;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReflectionResponses | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'delegates' | 'questions'>('delegates');
  const [questionId, setQuestionId] = useState<string>(activity.questions[0]?.id ?? '');
  useEffect(() => {
    let cancelled = false;
    apiFetch<ReflectionResponses>(`/events/${eventId}/reflections/${activity.id}/responses`).then(
      (r) => {
        if (!cancelled) setData(r);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The responses could not be loaded.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, activity.id]);
  const questions = data?.activity.questions ?? activity.questions;
  const current = questions.find((q) => q.id === questionId) ?? questions[0];
  return (
    <Dialog
      title={`Responses: ${activity.title}`}
      description={
        data
          ? `${formatDateShort(activity.date)} · ${data.rows.length} submitted · ${data.notSubmitted.length} not yet`
          : formatDateShort(activity.date)
      }
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className={consoleButton({ variant: 'secondary' })}>
          Close
        </button>
      }
    >
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : !data ? (
        <p role="status" className="text-sm text-corp-muted">
          Loading…
        </p>
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label="Response views" className="flex gap-2">
            {(
              [
                ['delegates', 'By delegate'],
                ['questions', 'By question'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={
                  view === key
                    ? 'min-h-9 rounded-none bg-corp-ink px-3 text-xs font-semibold text-white'
                    : 'min-h-9 rounded-none border border-corp-line bg-white px-3 text-xs font-medium text-corp-text'
                }
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'delegates' ? (
            data.rows.length === 0 ? (
              <p className="text-sm text-corp-muted">Nobody has submitted yet.</p>
            ) : (
              <div className="space-y-5">
                {data.rows.map((r) => (
                  <section
                    key={r.delegate.id}
                    aria-label={`Response: ${r.delegate.name}`}
                    className="space-y-2"
                  >
                    <p className="border-b border-corp-line pb-1 text-sm font-semibold text-corp-ink">
                      {r.delegate.name}
                      {r.delegate.organisation ? ` · ${r.delegate.organisation}` : ''}{' '}
                      <span className="font-normal text-corp-muted">
                        · {formatInstant(r.submittedAt, timezone)}
                      </span>
                    </p>
                    <dl className="space-y-2">
                      {questions.map((q) => (
                        <div key={q.id}>
                          <dt className="text-xs text-corp-muted">
                            {q.prompt}
                            {q.concern ? ' · concern' : ''}
                          </dt>
                          <dd
                            className={
                              r.answers[q.id] ? 'text-sm text-corp-ink' : 'text-sm text-corp-muted'
                            }
                          >
                            {r.answers[q.id] || 'No answer'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <NativeSelect
                aria-label="Question"
                value={current?.id ?? ''}
                onChange={(e) => setQuestionId(e.target.value)}
                className="rounded-none"
              >
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.prompt}
                  </option>
                ))}
              </NativeSelect>
              {current ? (
                <ul
                  aria-label={`Answers: ${current.prompt}`}
                  className="divide-y divide-corp-line text-sm"
                >
                  {data.rows
                    .filter((r) => r.answers[current.id])
                    .map((r) => (
                      <li key={r.delegate.id} className="py-2">
                        <p className="text-corp-ink">{r.answers[current.id]}</p>
                        <p className="text-xs text-corp-muted">{r.delegate.name}</p>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          )}
          <section aria-label="Not yet submitted" className="space-y-1">
            <h4 className="text-sm font-semibold text-corp-ink">
              Not yet submitted ({data.notSubmitted.length})
            </h4>
            {data.notSubmitted.length ? (
              <p className="text-xs text-corp-muted">
                {data.notSubmitted.map((d) => d.name).join(', ')}
              </p>
            ) : (
              <p className="text-xs text-corp-muted">Everyone registered has submitted.</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
