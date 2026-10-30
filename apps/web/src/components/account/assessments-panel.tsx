'use client';

import {
  answerIssue,
  groupQuestions,
  isBlankAnswer,
  type AssessmentQuestionView,
  type MyAssessment,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { ApiError, apiFetch } from '@/lib/api';
import { formatInstant, stageLabels, stagePurpose, stageWhen } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface AssessmentsPanelProps {
  eventId: string;
  timezone: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; assessments: MyAssessment[] }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * The delegate's assessments for one event: each enabled stage that is upcoming, open or closed.
 * An open stage shows its questions one section per step (answer, save a draft, submit once);
 * a closed or submitted stage shows the answers read-only. Everything is served and checked by
 * the API for the signed-in delegate only.
 */
export function AssessmentsPanel({ eventId, timezone }: AssessmentsPanelProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ assessments: MyAssessment[] }>(`/me/events/${eventId}/assessments`).then(
      (result) => {
        if (!cancelled) setState({ kind: 'ready', assessments: result.assessments });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Your assessments could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading') {
    return <StatePanel kind="loading" title="Loading your assessments…" />;
  }
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Assessments unavailable"
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
  if (state.assessments.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No assessments open yet"
        description="The organisers will open the pre-conference check-in, the conference days and the follow-ups here when it is time. You will be told by email."
      />
    );
  }
  return (
    <div className="space-y-4">
      {state.assessments.map((a) => (
        <AssessmentCard
          key={a.stage}
          eventId={eventId}
          timezone={timezone}
          assessment={a}
          onUpdated={(assessments) => setState({ kind: 'ready', assessments })}
        />
      ))}
    </div>
  );
}

function AssessmentCard({
  eventId,
  timezone,
  assessment,
  onUpdated,
}: {
  eventId: string;
  timezone: string;
  assessment: MyAssessment;
  onUpdated: (assessments: MyAssessment[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    assessment.response?.answers ?? {},
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const submitted = Boolean(assessment.response?.submittedAt);
  const tone =
    assessment.status === 'open'
      ? 'positive'
      : assessment.status === 'closed'
        ? 'neutral'
        : 'attention';
  const statusText = submitted
    ? 'Submitted'
    : assessment.status === 'open'
      ? 'Open'
      : assessment.status === 'closed'
        ? 'Closed'
        : 'Opens later';
  const canAnswer = assessment.canAnswer && !submitted;
  const groups = groupQuestions(assessment.sections, assessment.questions).filter(
    (g) => g.questions.length > 0,
  );
  const stepped = canAnswer && groups.length > 1;
  const current = stepped ? groups[Math.min(step, groups.length - 1)]! : null;
  const lastStep = !stepped || step >= groups.length - 1;

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
    setProblems((p) => {
      if (!p[questionId]) return p;
      const copy = { ...p };
      delete copy[questionId];
      return copy;
    });
    setNotice(null);
  }

  /** Local check before any request: blank required answers (on submit) and malformed values. */
  function validate(submit: boolean, only?: AssessmentQuestionView[]): Record<string, string> {
    const next: Record<string, string> = {};
    for (const q of only ?? assessment.questions) {
      const value = answers[q.id];
      if (isBlankAnswer(value)) {
        if (submit && q.required) next[q.id] = 'This question needs an answer before you submit.';
        continue;
      }
      const issue = answerIssue(q, value);
      if (issue) next[q.id] = issue;
    }
    return next;
  }
  /** Shows the problems and jumps to the first step that holds one. */
  function showProblems(next: Record<string, string>) {
    setProblems(next);
    setConfirm(false);
    if (stepped) {
      const index = groups.findIndex((g) => g.questions.some((q) => next[q.id]));
      if (index >= 0) setStep(index);
    }
  }

  async function save(submit: boolean) {
    const next = validate(submit);
    if (Object.keys(next).length) {
      showProblems(next);
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    try {
      const result = await apiFetch<{ assessments: MyAssessment[] }>(
        `/me/events/${eventId}/assessments/${assessment.stage}`,
        { method: 'PUT', body: JSON.stringify({ answers, submit }) },
      );
      onUpdated(result.assessments);
      setNotice({
        ok: true,
        text: submit
          ? 'Thank you, your answers are submitted.'
          : 'Draft saved. You can come back to it.',
      });
      setConfirm(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'answers_invalid') {
        setNotice({ ok: false, text: 'Some answers need attention.' });
      } else {
        setNotice({
          ok: false,
          text: describeError(e, 'Your answers could not be saved.').message,
        });
      }
      setConfirm(false);
    } finally {
      setBusy(null);
    }
  }

  function nextSection() {
    if (!current) return;
    const issues = validate(false, current.questions);
    if (Object.keys(issues).length) {
      setProblems(issues);
      return;
    }
    setNotice(null);
    setStep((s) => Math.min(s + 1, groups.length - 1));
  }

  const visibleGroups = stepped && current ? [current] : groups;

  return (
    <article
      aria-label={stageLabels[assessment.stage]}
      className={`space-y-4 rounded-none border border-corp-line bg-white p-4 shadow-panel md:p-5 ${
        assessment.status === 'open' && !submitted ? 'border-l-4 border-l-corp-accent' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="neutral">{stageWhen[assessment.stage]}</StatusPill>
        <StatusPill tone={submitted ? 'positive' : tone}>{statusText}</StatusPill>
      </div>
      <div>
        <h3 className="font-corporate text-base font-semibold text-corp-ink md:text-lg">
          {stageLabels[assessment.stage]}
        </h3>
        <p className="text-sm text-corp-text">{stagePurpose[assessment.stage]}</p>
        <p className="mt-1 text-xs text-corp-muted">
          {assessment.opensAt
            ? `Opens ${formatInstant(assessment.opensAt, timezone)}`
            : 'Opens when the organisers say'}
          {assessment.closesAt ? ` · closes ${formatInstant(assessment.closesAt, timezone)}` : ''}
        </p>
      </div>

      {assessment.status === 'upcoming' ? (
        <p className="text-sm text-corp-muted">
          The questions appear here when the assessment opens.
        </p>
      ) : assessment.questions.length === 0 ? (
        <p className="text-sm text-corp-muted">No questions have been published for this stage.</p>
      ) : (
        <form
          noValidate
          aria-label={`${stageLabels[assessment.stage]} questions`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!lastStep) {
              nextSection();
              return;
            }
            if (confirm) {
              void save(true);
              return;
            }
            const issues = validate(true);
            if (Object.keys(issues).length) {
              showProblems(issues);
              setNotice(null);
              return;
            }
            setConfirm(true);
          }}
          className="space-y-5"
        >
          {stepped ? (
            <div className="flex flex-col gap-2 border-b border-corp-line pb-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                Section {step + 1} of {groups.length}
              </p>
              <ol className="flex flex-wrap gap-1" aria-label="Sections">
                {groups.map((g, i) => (
                  <li key={g.section?.id ?? 'general'}>
                    <button
                      type="button"
                      aria-current={i === step ? 'step' : undefined}
                      onClick={() => {
                        setNotice(null);
                        setStep(i);
                      }}
                      className={
                        i === step
                          ? 'min-h-9 rounded-none bg-corp-ink px-3 text-xs font-semibold text-white'
                          : 'min-h-9 rounded-none border border-corp-line bg-white px-3 text-xs font-medium text-corp-text hover:bg-corp-surface'
                      }
                    >
                      {g.section?.title ?? 'Start'}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {visibleGroups.map((group) => (
            <section
              key={group.section?.id ?? 'general'}
              aria-label={group.section?.title ?? 'Questions'}
              className="space-y-4"
            >
              {group.section ? (
                <div>
                  <h4 className="font-corporate text-base font-semibold text-corp-ink">
                    {group.section.title}
                  </h4>
                  {group.section.description ? (
                    <p className="text-sm text-corp-text">{group.section.description}</p>
                  ) : null}
                </div>
              ) : null}
              <ol className="space-y-5">
                {group.questions.map((q) => (
                  <li key={q.id} className="space-y-2">
                    <QuestionField
                      index={assessment.questions.findIndex((x) => x.id === q.id)}
                      question={q}
                      value={answers[q.id]}
                      disabled={!canAnswer || busy !== null}
                      problem={problems[q.id]}
                      onChange={(value) => setAnswer(q.id, value)}
                    />
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {notice ? (
            <p
              role={notice.ok ? 'status' : 'alert'}
              className={
                notice.ok
                  ? 'text-sm font-semibold text-corp-green-text'
                  : 'text-sm font-semibold text-brand-danger'
              }
            >
              {notice.text}
            </p>
          ) : null}
          {canAnswer ? (
            <div className="flex flex-col gap-2 border-t border-corp-line pt-4 sm:flex-row sm:items-center sm:justify-end">
              {confirm ? (
                <>
                  <p className="text-sm text-corp-ink sm:mr-auto">
                    Submit your answers? You cannot change them afterwards.
                  </p>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setConfirm(false)}
                    className={consoleButton({ variant: 'ghost' })}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className={consoleButton({ variant: 'accent' })}
                  >
                    {busy === 'submit' ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : null}
                    Submit now
                  </button>
                </>
              ) : (
                <>
                  {stepped && step > 0 ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setNotice(null);
                        setStep((s) => Math.max(0, s - 1));
                      }}
                      className={`${consoleButton({ variant: 'ghost' })} sm:mr-auto`}
                    >
                      Previous section
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void save(false)}
                    className={consoleButton({ variant: 'secondary' })}
                  >
                    {busy === 'draft' ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : null}
                    Save draft
                  </button>
                  {lastStep ? (
                    <button
                      type="submit"
                      disabled={busy !== null}
                      className={consoleButton({ variant: 'accent' })}
                    >
                      Submit answers
                    </button>
                  ) : (
                    <button type="submit" disabled={busy !== null} className={consoleButton()}>
                      Next section
                    </button>
                  )}
                </>
              )}
            </div>
          ) : submitted ? (
            <p className="text-sm text-corp-muted">
              Submitted{' '}
              {assessment.response?.submittedAt
                ? formatInstant(assessment.response.submittedAt, timezone)
                : ''}
              . Your answers are shown above.
            </p>
          ) : null}
        </form>
      )}
    </article>
  );
}

function QuestionField({
  index,
  question,
  value,
  disabled,
  problem,
  onChange,
}: {
  index: number;
  question: AssessmentQuestionView;
  value: unknown;
  disabled: boolean;
  problem?: string;
  onChange: (value: unknown) => void;
}) {
  const id = useId();
  const label = (
    <span className="block text-sm font-semibold text-corp-ink">
      {index + 1}. {question.prompt}
      {question.required ? <span className="text-brand-danger"> *</span> : null}
    </span>
  );
  const help = question.helpText ? (
    <span className="block text-xs text-corp-muted">{question.helpText}</span>
  ) : null;
  const inputClass =
    'h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base disabled:bg-corp-surface md:text-sm';
  const error = problem ? (
    <p role="alert" className="text-xs text-brand-danger">
      {problem}
    </p>
  ) : null;

  switch (question.type) {
    case 'short_text':
    case 'number':
    case 'date':
      return (
        <div className="space-y-1">
          <label htmlFor={id}>
            {label}
            {help}
          </label>
          <input
            id={id}
            type={
              question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : 'text'
            }
            value={
              typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
            }
            disabled={disabled}
            maxLength={500}
            onChange={(e) =>
              onChange(
                question.type === 'number'
                  ? e.target.value === ''
                    ? ''
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
            className={inputClass}
          />
          {error}
        </div>
      );
    case 'long_text':
      return (
        <div className="space-y-1">
          <label htmlFor={id}>
            {label}
            {help}
          </label>
          <textarea
            id={id}
            rows={4}
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            maxLength={5000}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base disabled:bg-corp-surface md:text-sm"
          />
          {error}
        </div>
      );
    case 'single_choice':
    case 'yes_no': {
      const options =
        question.type === 'yes_no'
          ? [
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]
          : (question.options ?? []);
      const current =
        question.type === 'yes_no'
          ? value === true
            ? 'true'
            : value === false
              ? 'false'
              : ''
          : typeof value === 'string'
            ? value
            : '';
      return (
        <fieldset className="space-y-2">
          <legend>
            {label}
            {help}
          </legend>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex min-h-tap items-center gap-2 text-sm text-corp-ink"
            >
              <input
                type="radio"
                name={id}
                value={o.value}
                checked={current === o.value}
                disabled={disabled}
                onChange={() => onChange(question.type === 'yes_no' ? o.value === 'true' : o.value)}
                className="size-5 accent-corp-green"
              />
              {o.label}
            </label>
          ))}
          {error}
        </fieldset>
      );
    }
    case 'multiple_choice': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-2">
          <legend>
            {label}
            {help}
          </legend>
          {(question.options ?? []).map((o) => (
            <label
              key={o.value}
              className="flex min-h-tap items-center gap-2 text-sm text-corp-ink"
            >
              <input
                type="checkbox"
                checked={chosen.includes(o.value)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value),
                  )
                }
                className="size-5 accent-corp-green"
              />
              {o.label}
            </label>
          ))}
          {error}
        </fieldset>
      );
    }
    case 'rating': {
      const scale = question.scale ?? { min: 1, max: 5, minLabel: null, maxLabel: null };
      const steps = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i);
      return (
        <fieldset className="space-y-2">
          <legend>
            {label}
            {help}
          </legend>
          <div
            className="flex flex-wrap items-center gap-2"
            role="radiogroup"
            aria-label={question.prompt}
          >
            {scale.minLabel ? (
              <span className="text-xs text-corp-muted">{scale.minLabel}</span>
            ) : null}
            {steps.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                disabled={disabled}
                onClick={() => onChange(n)}
                className={
                  value === n
                    ? 'flex size-11 items-center justify-center rounded-none border border-corp-green bg-corp-green text-sm font-semibold text-white'
                    : 'flex size-11 items-center justify-center rounded-none border border-corp-line bg-white text-sm font-semibold text-corp-ink hover:bg-corp-surface disabled:opacity-60'
                }
              >
                {n}
              </button>
            ))}
            {scale.maxLabel ? (
              <span className="text-xs text-corp-muted">{scale.maxLabel}</span>
            ) : null}
          </div>
          {error}
        </fieldset>
      );
    }
    default:
      return null;
  }
}
