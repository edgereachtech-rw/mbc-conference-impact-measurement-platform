'use client';

import {
  FEEDBACK_ENCOURAGED_MINUTES,
  feedbackQuestionTypeLabels,
  feedbackQuestionTypes,
  feedbackRatingLabels,
  feedbackWindowLabels,
  type EventDetail,
  type FeedbackDashboard,
  type FeedbackQuestionView,
  type FeedbackSessionView,
} from '@mbc/shared';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  DownloadIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  QrCodeIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, Panel, StatePanel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch, apiUrl } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

import { FeedbackInvite } from './feedback-invite';

interface FeedbackManagerProps {
  event: EventDetail;
}

type DialogState =
  | { kind: 'question'; question: FeedbackQuestionView | null }
  | { kind: 'link'; session: FeedbackSessionView }
  | { kind: 'dashboard'; session: FeedbackSessionView }
  | null;

/**
 * Session feedback (task of 2026-10-31): per session, enable the form (which creates its link and
 * QR code), start it when the session ends, close it when the organisers decide (2026-11-07: the
 * form opens and closes by hand, never on the clock), edit the event's questions, and read the
 * dashboard (rating distributions with question-specific percentages, written answers, an
 * anonymised view for the speaker) or export it. Admins only.
 */
export function FeedbackManager({ event }: FeedbackManagerProps) {
  const [sessions, setSessions] = useState<FeedbackSessionView[] | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [version, setVersion] = useState(0);
  /** The event's feedback questions, recorded once; every session's form follows them (2026-11-07). */
  const [questions, setQuestions] = useState<FeedbackQuestionView[] | null>(null);
  const readOnly = event.status === 'archived';
  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ questions: FeedbackQuestionView[]; sessions: FeedbackSessionView[] }>(
      `/events/${event.id}/feedback`,
    ).then(
      (r) => {
        if (cancelled) return;
        setQuestions(r.questions);
        setSessions(r.sessions);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'Session feedback could not be loaded.'));
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

  if (error && !sessions) {
    return (
      <StatePanel
        kind="error"
        title="Session feedback unavailable"
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
  if (!sessions) return <StatePanel kind="loading" title="Loading session feedback…" />;
  if (sessions.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No sessions yet"
        description="Session feedback belongs to a session. Add sessions under Sessions and schedule first."
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-corp-text">
        The feedback questions are recorded once, below, and every session&rsquo;s form follows
        them. Enabling a session creates its link and QR code, which you can show or print right
        away. Delegates can answer only once you press Start, at the end of the session, for the{' '}
        {FEEDBACK_ENCOURAGED_MINUTES}-minute feedback period; the form then stays open until you
        close it. Only delegates checked in on the day of the session can answer, and feedback never
        records attendance.
      </p>
      <QuestionsPanel
        eventId={event.id}
        questions={questions ?? []}
        readOnly={readOnly}
        onChanged={done}
        onError={(message) => setError({ message })}
        onDialog={setDialog}
      />
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
        {sessions.map((s) => (
          <SessionCard
            key={s.id}
            event={event}
            session={s}
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
          question={dialog.question}
          onClose={() => setDialog(null)}
          onSaved={() => done(dialog.question ? 'Question saved.' : 'Question added.')}
        />
      ) : null}
      {dialog?.kind === 'link' ? (
        <LinkDialog session={dialog.session} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'dashboard' ? (
        <DashboardDialog
          eventId={event.id}
          timezone={event.timezone}
          session={dialog.session}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** The event's feedback questions: one set, edited here, asked on every session's form. */
function QuestionsPanel({
  eventId,
  questions,
  readOnly,
  onChanged,
  onError,
  onDialog,
}: {
  eventId: string;
  questions: FeedbackQuestionView[];
  readOnly: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onDialog: (d: DialogState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const base = `/events/${eventId}/feedback/questions`;
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
  function reorder(ids: string[]) {
    void run(
      () =>
        apiFetch(`${base}/order`, { method: 'PUT', body: JSON.stringify({ questionIds: ids }) }),
      'Order saved.',
    );
  }
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-corporate text-base font-semibold text-corp-ink">
            Feedback questions ({questions.length})
          </h3>
          <p className="text-xs text-corp-muted">
            Asked on every session&rsquo;s feedback form. The standard five appear when the first
            session&rsquo;s feedback is enabled; edit them here once.
          </p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDialog({ kind: 'question', question: null })}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            <PlusIcon aria-hidden="true" /> Add question
          </button>
        ) : null}
      </div>
      {questions.length === 0 ? (
        <p className="mt-3 text-sm text-corp-muted">
          No questions yet. Enable feedback on a session to start with the standard five, or add
          your own.
        </p>
      ) : (
        <ol aria-label="Feedback questions" className="mt-3 divide-y divide-corp-line text-sm">
          {questions.map((q, i) => (
            <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-corp-ink">
                  {i + 1}. {q.prompt}
                </p>
                <p className="text-xs text-corp-muted">
                  {feedbackQuestionTypeLabels[q.type]} · {q.required ? 'Required' : 'Optional'}
                  {q.version > 1 ? ` · version ${q.version}` : ''}
                  {q.responseCount ? ` · ${q.responseCount} answers` : ''}
                </p>
              </div>
              {!readOnly ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Move up: ${q.prompt}`}
                    disabled={busy || i === 0}
                    onClick={() => {
                      const ids = questions.map((x) => x.id);
                      [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
                      reorder(ids);
                    }}
                    className={consoleButton({ variant: 'ghost', size: 'sm' })}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move down: ${q.prompt}`}
                    disabled={busy || i === questions.length - 1}
                    onClick={() => {
                      const ids = questions.map((x) => x.id);
                      [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!];
                      reorder(ids);
                    }}
                    className={consoleButton({ variant: 'ghost', size: 'sm' })}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit: ${q.prompt}`}
                    disabled={busy}
                    onClick={() => onDialog({ kind: 'question', question: q })}
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
                        () => apiFetch(`${base}/${q.id}`, { method: 'DELETE' }),
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
    </Panel>
  );
}

function SessionCard({
  event,
  session,
  readOnly,
  onChanged,
  onError,
  onDialog,
}: {
  event: EventDetail;
  session: FeedbackSessionView;
  readOnly: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onDialog: (d: DialogState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const base = `/events/${event.id}/feedback/sessions/${session.id}`;

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
  function settings(enabled: boolean) {
    void run(
      () => apiFetch(base, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
      enabled ? 'Feedback enabled. Press Start when the session ends.' : 'Feedback disabled.',
    );
  }
  const open = () =>
    void run(
      () => apiFetch(`${base}/open`, { method: 'POST', body: '{}' }),
      session.window === 'closed'
        ? 'Feedback reopened.'
        : `Feedback open: the ${FEEDBACK_ENCOURAGED_MINUTES}-minute period has started.`,
    );
  const close = () =>
    void run(() => apiFetch(`${base}/close`, { method: 'POST', body: '{}' }), 'Feedback closed.');

  return (
    <Panel>
      <article aria-label={`Feedback: ${session.title}`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-corporate text-base font-semibold text-corp-ink">
              {session.title}
            </h3>
            <p className="text-xs text-corp-muted">
              {formatDateShort(session.date)} {session.startTime}-{session.endTime}
              {session.speaker ? ` · ${session.speaker}` : ' · no speaker recorded'}
            </p>
          </div>
          <StatusPill
            tone={
              session.window === 'open'
                ? 'positive'
                : session.window === 'closed'
                  ? 'attention'
                  : 'neutral'
            }
          >
            {feedbackWindowLabels[session.window]}
          </StatusPill>
        </div>
        <p className="text-sm text-corp-text">
          {session.attended} checked in that day · {session.submitted} submitted
          {session.openedAt && session.window !== 'disabled'
            ? ` · opened ${formatInstant(session.openedAt, event.timezone)}`
            : ''}
          {session.closedAt && session.window === 'closed'
            ? ` · closed ${formatInstant(session.closedAt, event.timezone)}`
            : ''}
        </p>

        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            {!session.enabled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => settings(true)}
                className={consoleButton({ variant: 'accent' })}
              >
                Enable feedback
              </button>
            ) : null}
            {session.window === 'pending' ? (
              <button
                type="button"
                disabled={busy}
                onClick={open}
                className={consoleButton({ variant: 'accent' })}
              >
                <PlayIcon aria-hidden="true" /> Start feedback
              </button>
            ) : null}
            {session.window === 'open' ? (
              <button
                type="button"
                disabled={busy}
                onClick={close}
                className={consoleButton({ variant: 'secondary' })}
              >
                <SquareIcon aria-hidden="true" /> Close feedback
              </button>
            ) : null}
            {session.window === 'closed' ? (
              <button
                type="button"
                disabled={busy}
                onClick={open}
                className={consoleButton({ variant: 'secondary' })}
              >
                <PlayIcon aria-hidden="true" /> Reopen feedback
              </button>
            ) : null}
            {session.enabled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => settings(false)}
                className={consoleButton({ variant: 'ghost' })}
              >
                Disable
              </button>
            ) : null}
          </div>
        ) : null}
        {session.window === 'pending' ? (
          <p className="text-sm text-corp-muted">
            The link and QR code are ready to show. Delegates can answer once you press Start, at
            the end of the session.
          </p>
        ) : null}

        {session.enabled ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onDialog({ kind: 'link', session })}
                className={consoleButton({ variant: 'secondary', size: 'sm' })}
              >
                <QrCodeIcon aria-hidden="true" /> Link and QR code
              </button>
              <button
                type="button"
                onClick={() => onDialog({ kind: 'dashboard', session })}
                className={consoleButton({ variant: 'secondary', size: 'sm' })}
              >
                <BarChart3Icon aria-hidden="true" /> Dashboard ({session.submitted})
              </button>
              <a
                href={apiUrl(`${base}/export.xlsx`)}
                download
                className={consoleButton({ variant: 'ghost', size: 'sm' })}
              >
                <DownloadIcon aria-hidden="true" /> Export to Excel
              </a>
            </div>
            <FeedbackInvite
              eventId={event.id}
              sessionId={session.id}
              sessionTitle={session.title}
            />
          </>
        ) : (
          <p className="text-sm text-corp-muted">
            Enabling creates the link and QR code; the form asks the event&rsquo;s questions above.
          </p>
        )}
      </article>
    </Panel>
  );
}

function LinkDialog({ session, onClose }: { session: FeedbackSessionView; onClose: () => void }) {
  const [image, setImage] = useState<string | null>(null);
  const url =
    typeof window === 'undefined' || !session.path
      ? (session.path ?? '')
      : `${window.location.origin}${session.path}`;
  useEffect(() => {
    let cancelled = false;
    if (!url) return undefined;
    QRCode.toDataURL(url, { margin: 1, width: 320 }).then((data) => {
      if (!cancelled) setImage(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <Dialog
      title={`Feedback link: ${session.title}`}
      description="Show the QR code in the room or share the link with online delegates. Delegates sign in, see the session automatically and answer."
      onClose={onClose}
      size="md"
      footer={
        <button type="button" onClick={onClose} className={consoleButton({ variant: 'secondary' })}>
          Close
        </button>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={`QR code for ${session.title} feedback`}
            width={320}
            height={320}
            className="max-w-full"
          />
        ) : null}
        <p className="font-mono text-sm break-all text-corp-ink">{url}</p>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(url)}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
        >
          Copy link
        </button>
      </div>
    </Dialog>
  );
}

function QuestionDialog({
  eventId,
  question,
  onClose,
  onSaved,
}: {
  eventId: string;
  question: FeedbackQuestionView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    prompt: question?.prompt ?? '',
    type: question?.type ?? ('rating' as const),
    required: question?.required ?? true,
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
      const base = `/events/${eventId}/feedback/questions`;
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
          : 'Asked on every session’s feedback form of this event.'
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
        aria-label={question ? 'Edit feedback question' : 'New feedback question'}
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
            {feedbackQuestionTypes.map((t) => (
              <option key={t} value={t}>
                {feedbackQuestionTypeLabels[t]}
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
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function DashboardDialog({
  eventId,
  timezone,
  session,
  onClose,
}: {
  eventId: string;
  timezone: string;
  session: FeedbackSessionView;
  onClose: () => void;
}) {
  const [anonymised, setAnonymised] = useState(false);
  const [data, setData] = useState<FeedbackDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/events/${eventId}/feedback/sessions/${session.id}`;
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ dashboard: FeedbackDashboard }>(
      `${base}/dashboard${anonymised ? '?anonymised=true' : ''}`,
    ).then(
      (r) => {
        if (!cancelled) setData(r.dashboard);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The dashboard could not be loaded.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, anonymised]);
  return (
    <Dialog
      title={`Feedback: ${session.title}`}
      description={`${formatDateShort(session.date)} ${session.startTime}-${session.endTime}${session.speaker ? ` · ${session.speaker}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <a
            href={apiUrl(`${base}/export.xlsx${anonymised ? '?anonymised=true' : ''}`)}
            download
            className={consoleButton({ variant: 'secondary' })}
          >
            <DownloadIcon aria-hidden="true" /> Export {anonymised ? 'anonymised ' : ''}to Excel
          </a>
          <button type="button" onClick={onClose} className={consoleButton({ variant: 'ghost' })}>
            Close
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
          <input
            type="checkbox"
            checked={anonymised}
            onChange={(e) => setAnonymised(e.target.checked)}
            className="size-5 accent-corp-green"
          />
          Speaker view: leave delegate names out
        </label>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : !data ? (
          <p role="status" className="text-sm text-corp-muted">
            Loading…
          </p>
        ) : (
          <>
            <p className="text-sm text-corp-text">
              <span className="font-semibold text-corp-ink">{data.session.submitted}</span> delegate
              {data.session.submitted === 1 ? '' : 's'} submitted feedback (latest response each) ·{' '}
              {data.session.attended} checked in that day.
            </p>
            {data.distributions.map((d) => (
              <section key={d.questionId} aria-label={d.prompt} className="space-y-1">
                <h3 className="text-sm font-semibold text-corp-ink">{d.prompt}</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs tracking-[0.08em] text-corp-muted uppercase">
                    <tr>
                      <th scope="col" className="py-1 text-left font-semibold">
                        Rating
                      </th>
                      <th scope="col" className="py-1 text-right font-semibold">
                        Responses
                      </th>
                      <th scope="col" className="py-1 text-right font-semibold">
                        Percentage
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ratings.map((r) => (
                      <tr key={r.rating} className="border-t border-corp-line">
                        <td className="py-1 text-corp-text">{feedbackRatingLabels[r.rating]}</td>
                        <td className="py-1 text-right text-corp-ink tabular-nums">{r.count}</td>
                        <td className="py-1 text-right text-corp-ink tabular-nums">{r.percent}%</td>
                      </tr>
                    ))}
                    <tr className="border-t border-corp-line font-semibold">
                      <td className="py-1 text-corp-ink">Total</td>
                      <td className="py-1 text-right text-corp-ink tabular-nums">{d.total}</td>
                      <td className="py-1 text-right text-corp-ink tabular-nums">
                        {d.total ? '100' : '0'}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            ))}
            {data.written.map((w) => (
              <section key={w.questionId} aria-label={w.prompt} className="space-y-1">
                <h3 className="text-sm font-semibold text-corp-ink">{w.prompt}</h3>
                {w.responses.length === 0 ? (
                  <p className="text-sm text-corp-muted">No written answers yet.</p>
                ) : (
                  <ul className="divide-y divide-corp-line text-sm">
                    {w.responses.map((r, i) => (
                      <li key={`${r.submittedAt}-${i}`} className="py-2">
                        <p className="text-corp-ink">{r.value}</p>
                        <p className="text-xs text-corp-muted">
                          {r.delegate ? `${r.delegate.name} · ` : ''}
                          {formatInstant(r.submittedAt, timezone)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
