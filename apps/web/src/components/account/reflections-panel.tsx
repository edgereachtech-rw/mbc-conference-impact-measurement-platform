'use client';

import type { MyReflection } from '@mbc/shared';
import { AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface ReflectionsPanelProps {
  eventId: string;
  timezone: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; reflections: MyReflection[] }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * The delegate's Daily Learning Reflections: one short questionnaire per conference day the
 * organisers enabled, answered once, with a review popup before sending and a confirmation
 * after. Submitting a reflection records nothing about attendance.
 */
export function ReflectionsPanel({ eventId, timezone }: ReflectionsPanelProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ reflections: MyReflection[] }>(`/me/events/${eventId}/reflections`).then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', reflections: r.reflections });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Your reflections could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading') return <StatePanel kind="loading" title="Loading reflections…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Reflections unavailable"
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
  if (state.reflections.length === 0) {
    return (
      <p className="text-sm text-corp-muted">
        No daily reflection is open yet. The organisers open one at the end of a conference day.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {state.reflections.map((r) => (
        <ReflectionCard
          key={r.id}
          eventId={eventId}
          timezone={timezone}
          reflection={r}
          onUpdated={(reflections) => setState({ kind: 'ready', reflections })}
        />
      ))}
    </div>
  );
}

function ReflectionCard({
  eventId,
  timezone,
  reflection,
  onUpdated,
}: {
  eventId: string;
  timezone: string;
  reflection: MyReflection;
  onUpdated: (reflections: MyReflection[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [review, setReview] = useState<'review' | 'done' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const id = useId();
  const submitted = reflection.submission;
  const statusText = submitted
    ? 'Submitted'
    : reflection.status === 'open'
      ? 'Open'
      : reflection.status === 'closed'
        ? 'Closed'
        : 'Opens later';
  const tone = submitted
    ? 'positive'
    : reflection.status === 'open'
      ? 'positive'
      : reflection.status === 'closed'
        ? 'neutral'
        : 'attention';

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    for (const q of reflection.questions) {
      if (q.required && !(answers[q.id] ?? '').trim()) {
        next[q.id] = 'This question needs an answer before you submit.';
      }
    }
    return next;
  }
  function startSubmit() {
    const issues = validate();
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
      const result = await apiFetch<{ reflections: MyReflection[] }>(
        `/me/events/${eventId}/reflections/${reflection.id}`,
        { method: 'POST', body: JSON.stringify({ answers }) },
      );
      onUpdated(result.reflections);
      setReview('done');
    } catch (e) {
      setReview(null);
      if (e instanceof ApiError && e.code === 'answers_invalid') {
        const served = (e.body as { problems?: Record<string, string> } | undefined)?.problems;
        if (served) setProblems(served);
        setBanner('Some answers need attention. They are highlighted below.');
      } else {
        setNotice(describeError(e, 'Your reflection could not be submitted.').message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      aria-label={reflection.title}
      className={`space-y-4 rounded-none border border-corp-line bg-white p-4 shadow-panel md:p-5 ${
        reflection.canSubmit ? 'border-l-4 border-l-corp-accent' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="neutral">{formatDateShort(reflection.date)}</StatusPill>
        <StatusPill tone={tone}>{statusText}</StatusPill>
      </div>
      <div>
        <h3 className="font-corporate text-base font-semibold text-corp-ink md:text-lg">
          {reflection.title}
        </h3>
        <p className="mt-1 text-xs text-corp-muted">
          {reflection.opensAt ? `Opens ${formatInstant(reflection.opensAt, timezone)}` : 'Open now'}
          {reflection.closesAt ? ` · closes ${formatInstant(reflection.closesAt, timezone)}` : ''}
        </p>
      </div>

      {reflection.status === 'upcoming' ? (
        <p className="text-sm text-corp-muted">
          The questions appear here when the reflection opens.
        </p>
      ) : submitted ? (
        <div className="space-y-3">
          <p className="text-sm text-corp-muted">
            Submitted {formatInstant(submitted.submittedAt, timezone)}. Thank you.
          </p>
          <dl className="space-y-2">
            {reflection.questions.map((q) => (
              <div key={q.id}>
                <dt className="text-sm text-corp-text">{q.prompt}</dt>
                <dd
                  className={
                    submitted.answers[q.id]
                      ? 'text-sm font-semibold text-corp-ink'
                      : 'text-sm text-corp-muted'
                  }
                >
                  {submitted.answers[q.id] || 'No answer'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : !reflection.canSubmit ? (
        <p className="text-sm text-corp-muted">This reflection is closed.</p>
      ) : (
        <form
          noValidate
          aria-label={`${reflection.title} questions`}
          onSubmit={(e) => {
            e.preventDefault();
            startSubmit();
          }}
          className="space-y-4"
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
          <ol className="space-y-4">
            {reflection.questions.map((q, i) => (
              <li
                key={q.id}
                className={
                  problems[q.id]
                    ? 'space-y-1 rounded-none border-l-4 border-danger bg-danger/5 py-2 pl-3'
                    : 'space-y-1'
                }
              >
                <label
                  htmlFor={`${id}-${q.id}`}
                  className="block text-sm font-semibold text-corp-ink"
                >
                  {i + 1}. {q.prompt}
                  {q.required ? <span className="text-danger"> *</span> : null}
                </label>
                {q.type === 'long_text' ? (
                  <textarea
                    id={`${id}-${q.id}`}
                    rows={4}
                    maxLength={5000}
                    value={answers[q.id] ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                      setProblems((p) => {
                        if (!p[q.id]) return p;
                        const copy = { ...p };
                        delete copy[q.id];
                        return copy;
                      });
                      setBanner(null);
                    }}
                    className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
                  />
                ) : (
                  <input
                    id={`${id}-${q.id}`}
                    maxLength={500}
                    value={answers[q.id] ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                      setProblems((p) => {
                        if (!p[q.id]) return p;
                        const copy = { ...p };
                        delete copy[q.id];
                        return copy;
                      });
                      setBanner(null);
                    }}
                    className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
                  />
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
          <div className="flex justify-end border-t border-corp-line pt-4">
            <button type="submit" disabled={busy} className={consoleButton({ variant: 'accent' })}>
              Submit reflection
            </button>
          </div>
        </form>
      )}

      {review ? (
        <Dialog
          title={review === 'done' ? 'Reflection submitted' : 'Submit your reflection?'}
          description={
            review === 'done'
              ? 'Thank you. Your answers are recorded.'
              : 'Check your answers below. Once submitted they cannot be changed.'
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
          <section aria-label={`Summary: ${reflection.title}`}>
            <dl className="space-y-2">
              {reflection.questions.map((q) => {
                const value = (submitted?.answers[q.id] ?? answers[q.id] ?? '').trim();
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
