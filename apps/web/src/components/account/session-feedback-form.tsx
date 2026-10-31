'use client';

import {
  FEEDBACK_ENCOURAGED_MINUTES,
  feedbackRatingLabels,
  feedbackRatings,
  type MyFeedback,
} from '@mbc/shared';
import { AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; feedback: MyFeedback }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * One session's feedback form, reached through the session's link or QR code: the session and
 * speaker are shown automatically, three ratings are required, the written answers optional.
 * Only delegates recorded as attending can submit; a response can be updated while the form is
 * open. Submitting never records attendance.
 */
export function SessionFeedbackForm({ code }: { code: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ feedback: MyFeedback }>(`/me/feedback/${encodeURIComponent(code)}`).then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', feedback: r.feedback });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'This feedback link could not be opened.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  if (state.kind === 'loading')
    return <StatePanel kind="loading" title="Opening the feedback form…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Feedback unavailable"
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
  return (
    <Form
      code={code}
      feedback={state.feedback}
      onUpdated={(feedback) => setState({ kind: 'ready', feedback })}
    />
  );
}

function Form({
  code,
  feedback,
  onUpdated,
}: {
  code: string;
  feedback: MyFeedback;
  onUpdated: (feedback: MyFeedback) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(feedback.response?.answers ?? {});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [review, setReview] = useState<'review' | 'done' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const id = useId();
  const { session } = feedback;
  const tz = session.timezone;

  function setAnswer(questionId: string, value: string) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
    setProblems((p) => {
      if (!p[questionId]) return p;
      const copy = { ...p };
      delete copy[questionId];
      return copy;
    });
    setBanner(null);
  }
  function startSubmit() {
    const issues: Record<string, string> = {};
    for (const q of feedback.questions) {
      if (q.required && !(answers[q.id] ?? '').trim()) {
        issues[q.id] =
          q.type === 'rating'
            ? 'Choose a rating before you submit.'
            : 'This question needs an answer before you submit.';
      }
    }
    if (Object.keys(issues).length) {
      setProblems(issues);
      const n = Object.keys(issues).length;
      setBanner(
        n === 1
          ? 'One question needs an answer before you can submit. It is highlighted below.'
          : `${n} questions need an answer before you can submit. They are highlighted below.`,
      );
      return;
    }
    setProblems({});
    setBanner(null);
    setReview('review');
  }
  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiFetch<{ feedback: MyFeedback }>(
        `/me/feedback/${encodeURIComponent(code)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ answers }),
        },
      );
      onUpdated(result.feedback);
      setReview('done');
    } catch (e) {
      setReview(null);
      if (e instanceof ApiError && e.code === 'answers_invalid') {
        const served = (e.body as { problems?: Record<string, string> } | undefined)?.problems;
        if (served) setProblems(served);
        setBanner('Some answers need attention. They are highlighted below.');
      } else {
        setNotice(describeError(e, 'Your feedback could not be submitted.').message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      aria-label={`Feedback: ${session.title}`}
      className="space-y-5 rounded-none border border-corp-line bg-white p-4 shadow-panel md:p-6"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          {session.eventName}
        </p>
        <h2 className="font-corporate text-h3 text-corp-ink">{session.title}</h2>
        <p className="text-sm text-corp-text">
          {formatDateShort(session.date)} {session.startTime}-{session.endTime}
          {session.speaker ? ` · ${session.speaker}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={feedback.window === 'open' ? 'positive' : 'neutral'}>
            {feedback.window === 'open' ? 'Open' : 'Closed'}
          </StatusPill>
          {feedback.response ? (
            <StatusPill tone="positive">
              Submitted {formatInstant(feedback.response.updatedAt, tz)}
            </StatusPill>
          ) : null}
        </div>
        <p className="text-xs text-corp-muted">
          {feedback.openedAt
            ? `Feedback opened ${formatInstant(feedback.openedAt, tz)}; please take about ${FEEDBACK_ENCOURAGED_MINUTES} minutes now. `
            : ''}
          {feedback.closesAt
            ? `Open until ${formatInstant(feedback.closesAt, tz)}.`
            : 'Open until the organisers close it.'}
        </p>
      </div>

      {!feedback.attended ? (
        <div
          role="alert"
          className="rounded-none border-2 border-danger bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
        >
          Feedback is open to delegates recorded as attending this session. If you attended, ask the
          organisers to record it, then come back to this link.
        </div>
      ) : feedback.window !== 'open' ? (
        <p className="text-sm text-corp-muted">
          This feedback form is closed.{feedback.response ? ' Your answers are shown below.' : ''}
        </p>
      ) : null}

      {feedback.attended && (feedback.window === 'open' || feedback.response) ? (
        <form
          noValidate
          aria-label={`${session.title} feedback questions`}
          onSubmit={(e) => {
            e.preventDefault();
            if (feedback.canSubmit) startSubmit();
          }}
          className="space-y-5"
        >
          {banner ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-none border-2 border-danger bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
            >
              <AlertCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{banner}</span>
            </div>
          ) : null}
          <ol className="space-y-5">
            {feedback.questions.map((q, i) => (
              <li
                key={q.id}
                className={
                  problems[q.id]
                    ? 'space-y-2 rounded-none border-l-4 border-danger bg-danger/5 py-2 pl-3'
                    : 'space-y-2'
                }
              >
                {q.type === 'rating' ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-corp-ink">
                      {i + 1}. {q.prompt}
                      {q.required ? <span className="text-danger"> *</span> : null}
                    </legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {feedbackRatings.map((r) => (
                        <label
                          key={r}
                          className={`flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-none border px-3 text-sm ${answers[q.id] === r ? 'border-corp-green bg-corp-green-soft font-semibold text-corp-ink' : 'border-corp-line bg-white text-corp-text'}`}
                        >
                          <input
                            type="radio"
                            name={`${id}-${q.id}`}
                            value={r}
                            checked={answers[q.id] === r}
                            disabled={!feedback.canSubmit || busy}
                            onChange={() => setAnswer(q.id, r)}
                            className="size-4 accent-corp-green"
                          />
                          {feedbackRatingLabels[r]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <div className="space-y-1">
                    <label
                      htmlFor={`${id}-${q.id}`}
                      className="block text-sm font-semibold text-corp-ink"
                    >
                      {i + 1}. {q.prompt}
                      {q.required ? <span className="text-danger"> *</span> : null}
                    </label>
                    <textarea
                      id={`${id}-${q.id}`}
                      rows={3}
                      maxLength={5000}
                      value={answers[q.id] ?? ''}
                      disabled={!feedback.canSubmit || busy}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                      className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base disabled:bg-corp-surface md:text-sm"
                    />
                  </div>
                )}
                {problems[q.id] ? (
                  <p role="alert" className="text-xs text-danger">
                    {problems[q.id]}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {notice ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {notice}
            </p>
          ) : null}
          {feedback.canSubmit ? (
            <div className="flex justify-end border-t border-corp-line pt-4">
              <button
                type="submit"
                disabled={busy}
                className={consoleButton({ variant: 'accent' })}
              >
                {feedback.response ? 'Update feedback' : 'Submit feedback'}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      {review ? (
        <Dialog
          title={
            review === 'done'
              ? 'Feedback submitted'
              : feedback.response
                ? 'Update your feedback?'
                : 'Submit your feedback?'
          }
          description={
            review === 'done'
              ? 'Thank you. Your feedback is recorded and you can update it while the form is open.'
              : 'Check your answers below.'
          }
          onClose={() => setReview(null)}
          closeDisabled={busy}
          size="md"
          footer={
            review === 'done' ? (
              <button
                type="button"
                onClick={() => setReview(null)}
                className={consoleButton({ variant: 'accent' })}
              >
                Close
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReview(null)}
                  className={consoleButton({ variant: 'ghost' })}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit()}
                  className={consoleButton({ variant: 'accent' })}
                >
                  {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                  Submit now
                </button>
              </>
            )
          }
        >
          <section aria-label={`Summary: ${session.title}`}>
            <dl className="space-y-2">
              {feedback.questions.map((q) => {
                const raw = (answers[q.id] ?? '').trim();
                const value =
                  q.type === 'rating' && raw
                    ? (feedbackRatingLabels[raw as keyof typeof feedbackRatingLabels] ?? raw)
                    : raw;
                return (
                  <div key={q.id}>
                    <dt className="text-sm text-corp-text">{q.prompt}</dt>
                    <dd
                      className={
                        value ? 'text-sm font-semibold text-corp-ink' : 'text-sm text-corp-muted'
                      }
                    >
                      {value || 'No answer'}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </Dialog>
      ) : null}
    </article>
  );
}
