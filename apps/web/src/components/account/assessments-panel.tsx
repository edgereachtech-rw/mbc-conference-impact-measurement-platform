'use client';

import {
  answerIssue,
  describeAnswer,
  GENERAL_SECTION,
  groupQuestions,
  isBlankAnswer,
  multipleChoiceAnswer,
  sectionKeyOf,
  type DelegateQuestionView,
  type KnowledgeFeedback,
  type MyAssessment,
} from '@mbc/shared';
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
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
 * An open stage shows its questions one section per step; each section is submitted on its own
 * (after a review popup listing its answers) and locks, and the stage counts as submitted once
 * every section is. Missing required answers are flagged in a highlighted banner and on the
 * questions themselves. A closed or submitted stage shows the answers read-only, section by
 * section. A knowledge question is saved the moment it is answered, shows whether the answer
 * was right, and cannot be changed afterwards. Everything is served and checked by the API for
 * the signed-in delegate only.
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
  const [busy, setBusy] = useState<'draft' | 'submit' | 'check' | null>(null);
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  /** The highlighted message shown when a submission is attempted with required answers missing. */
  const [banner, setBanner] = useState<string | null>(null);
  /** The section being confirmed in the review popup, and the outcome once it is submitted. */
  const [review, setReview] = useState<null | { key: string; done: 'section' | 'all' | null }>(
    null,
  );
  const submitted = Boolean(assessment.response?.submittedAt);
  const submittedKeys = new Set(assessment.response?.submittedSections ?? []);
  const feedback = assessment.feedback ?? {};
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
  const keyOf = (g: (typeof groups)[number]) => sectionKeyOf(g.section?.id ?? null);
  const stepped = canAnswer && groups.length > 1;
  const current = stepped ? groups[Math.min(step, groups.length - 1)]! : (groups[0] ?? null);
  const currentKey = current ? keyOf(current) : GENERAL_SECTION;
  const currentLocked = current ? submittedKeys.has(currentKey) : false;
  const remaining = groups.filter((g) => !submittedKeys.has(keyOf(g))).length;

  function clearProblem(questionId: string) {
    setProblems((p) => {
      if (!p[questionId]) return p;
      const copy = { ...p };
      delete copy[questionId];
      return copy;
    });
  }
  function setAnswer(questionId: string, value: unknown) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
    clearProblem(questionId);
    setNotice(null);
    setBanner(null);
  }

  /** Local check before any request: malformed values, and blank required answers of the questions given. */
  function validate(
    requiredIn: DelegateQuestionView[] | null,
    current: Record<string, unknown> = answers,
  ): Record<string, string> {
    const next: Record<string, string> = {};
    for (const q of assessment.questions) {
      const value = current[q.id];
      if (isBlankAnswer(value)) {
        if (q.required && requiredIn?.some((x) => x.id === q.id)) {
          next[q.id] = 'This question needs an answer before you submit.';
        }
        continue;
      }
      const issue = answerIssue(q, value);
      if (issue) next[q.id] = issue;
    }
    return next;
  }
  /** Shows the problems, the highlighted banner, and jumps to the first step that holds one. */
  function showProblems(next: Record<string, string>) {
    setProblems(next);
    setReview(null);
    const count = Object.keys(next).length;
    setBanner(
      count === 1
        ? 'One question needs attention before you can submit. It is highlighted below.'
        : `${count} questions need attention before you can submit. They are highlighted below.`,
    );
    if (stepped) {
      const index = groups.findIndex((g) => g.questions.some((q) => next[q.id]));
      if (index >= 0) setStep(index);
    }
  }

  async function save(
    body: { submitSection?: string },
    mode: 'draft' | 'submit' | 'check',
    current: Record<string, unknown> = answers,
  ) {
    setBusy(mode);
    try {
      const result = await apiFetch<{ assessments: MyAssessment[] }>(
        `/me/events/${eventId}/assessments/${assessment.stage}`,
        { method: 'PUT', body: JSON.stringify({ answers: current, ...body }) },
      );
      onUpdated(result.assessments);
      const next = result.assessments.find((a) => a.stage === assessment.stage);
      if (mode === 'draft') setNotice({ ok: true, text: 'Draft saved. You can come back to it.' });
      if (mode === 'submit') {
        setReview((r) => (r ? { ...r, done: next?.response?.submittedAt ? 'all' : 'section' } : r));
        setNotice(null);
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'answers_invalid') {
        const served = (e.body as { problems?: Record<string, string> } | undefined)?.problems;
        if (served && Object.keys(served).length) showProblems(served);
        else setNotice({ ok: false, text: 'Some answers need attention.' });
      } else {
        setReview(null);
        setNotice({
          ok: false,
          text: describeError(e, 'Your answers could not be saved.').message,
        });
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** A knowledge answer is saved at once so the result can be shown and the answer kept. */
  function answerKnowledge(questionId: string, value: string) {
    const current = { ...answers, [questionId]: value };
    setAnswers(current);
    clearProblem(questionId);
    setNotice(null);
    setBanner(null);
    void save({}, 'check', current);
  }

  function saveDraft() {
    const issues = validate(null);
    if (Object.keys(issues).length) {
      showProblems(issues);
      return;
    }
    setBanner(null);
    void save({}, 'draft');
  }

  /** Opens the review popup for the current section once its required answers are in. */
  function startSubmit() {
    if (!current) return;
    const issues = validate(current.questions);
    if (Object.keys(issues).length) {
      showProblems(issues);
      setNotice(null);
      return;
    }
    setBanner(null);
    setNotice(null);
    setReview({ key: currentKey, done: null });
  }

  function goTo(index: number) {
    setNotice(null);
    setBanner(null);
    setStep(Math.max(0, Math.min(index, groups.length - 1)));
  }

  /** After a section is submitted, move on to the next one still open. */
  function closeReview() {
    const done = review?.done;
    setReview(null);
    if (done === 'section' && stepped) {
      const next = groups.findIndex((g, i) => i > step && !submittedKeys.has(keyOf(g)));
      const first = groups.findIndex((g) => !submittedKeys.has(keyOf(g)));
      goTo(next >= 0 ? next : first >= 0 ? first : step);
    }
  }

  const visibleGroups = stepped && current ? [current] : groups;
  const reviewGroup = review ? groups.find((g) => keyOf(g) === review.key) : null;
  const submitLabel = groups.length > 1 ? 'Submit section' : 'Submit answers';

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
        {canAnswer && groups.length > 1 ? (
          <StatusPill tone={remaining === 0 ? 'positive' : 'attention'}>
            {groups.length - remaining} of {groups.length} sections submitted
          </StatusPill>
        ) : null}
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
            if (currentLocked) return;
            startSubmit();
          }}
          className="space-y-5"
        >
          {stepped ? (
            <div className="flex flex-col gap-2 border-b border-corp-line pb-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                Section {step + 1} of {groups.length}
              </p>
              <ol className="flex flex-wrap gap-1" aria-label="Sections">
                {groups.map((g, i) => {
                  const done = submittedKeys.has(keyOf(g));
                  return (
                    <li key={keyOf(g)}>
                      <button
                        type="button"
                        aria-current={i === step ? 'step' : undefined}
                        onClick={() => goTo(i)}
                        className={
                          i === step
                            ? 'min-h-9 rounded-none bg-corp-ink px-3 text-xs font-semibold text-white'
                            : done
                              ? 'min-h-9 rounded-none border border-corp-green bg-corp-green-soft px-3 text-xs font-medium text-corp-green-text hover:bg-corp-surface'
                              : 'min-h-9 rounded-none border border-corp-line bg-white px-3 text-xs font-medium text-corp-text hover:bg-corp-surface'
                        }
                      >
                        {done ? '✓ ' : ''}
                        {g.section?.title ?? 'Start'}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {banner ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-none border-2 border-danger bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
            >
              <AlertCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{banner}</span>
            </div>
          ) : null}

          {visibleGroups.map((group) => {
            const locked = submittedKeys.has(keyOf(group));
            return (
              <section
                key={keyOf(group)}
                aria-label={group.section?.title ?? 'Questions'}
                className="space-y-4"
              >
                {group.section || (canAnswer && locked) ? (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      {group.section ? (
                        <h4 className="font-corporate text-base font-semibold text-corp-ink">
                          {group.section.title}
                        </h4>
                      ) : null}
                      {group.section?.description ? (
                        <p className="text-sm text-corp-text">{group.section.description}</p>
                      ) : null}
                    </div>
                    {canAnswer && locked ? (
                      <StatusPill tone="positive">Submitted</StatusPill>
                    ) : null}
                  </div>
                ) : null}
                <ol className="space-y-5">
                  {group.questions.map((q) => (
                    <li
                      key={q.id}
                      className={
                        problems[q.id]
                          ? 'space-y-2 rounded-none border-l-4 border-danger bg-danger/5 py-2 pl-3'
                          : 'space-y-2'
                      }
                    >
                      <QuestionField
                        index={assessment.questions.findIndex((x) => x.id === q.id)}
                        question={q}
                        value={answers[q.id]}
                        disabled={!canAnswer || locked || busy !== null}
                        problem={problems[q.id]}
                        feedback={feedback[q.id]}
                        checking={busy === 'check'}
                        onChange={(value) => setAnswer(q.id, value)}
                        onKnowledgeChoice={(value) => answerKnowledge(q.id, value)}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}

          {notice ? (
            <p
              role={notice.ok ? 'status' : 'alert'}
              className={
                notice.ok
                  ? 'text-sm font-semibold text-corp-green-text'
                  : 'text-sm font-semibold text-danger'
              }
            >
              {notice.text}
            </p>
          ) : null}
          {canAnswer ? (
            <div className="flex flex-col gap-2 border-t border-corp-line pt-4 sm:flex-row sm:items-center sm:justify-end">
              {stepped && step > 0 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => goTo(step - 1)}
                  className={`${consoleButton({ variant: 'ghost' })} sm:mr-auto`}
                >
                  Previous section
                </button>
              ) : null}
              {currentLocked ? (
                <p className="text-sm text-corp-muted">
                  This section is submitted and cannot be changed.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={saveDraft}
                    className={consoleButton({ variant: 'secondary' })}
                  >
                    {busy === 'draft' ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : null}
                    Save draft
                  </button>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className={consoleButton({ variant: 'accent' })}
                  >
                    {submitLabel}
                  </button>
                </>
              )}
              {stepped && step < groups.length - 1 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => goTo(step + 1)}
                  className={consoleButton()}
                >
                  Next section
                </button>
              ) : null}
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

      {review && reviewGroup ? (
        <Dialog
          title={
            review.done === 'all'
              ? 'All sections submitted'
              : review.done === 'section'
                ? 'Section submitted'
                : groups.length > 1
                  ? 'Submit this section?'
                  : 'Submit your answers?'
          }
          description={
            review.done
              ? 'Thank you. Your answers are recorded.'
              : 'Check your answers below. Once submitted they cannot be changed.'
          }
          onClose={closeReview}
          closeDisabled={busy === 'submit'}
          size="md"
          footer={
            review.done ? (
              <button
                type="button"
                onClick={closeReview}
                className={consoleButton({ variant: 'accent' })}
              >
                {review.done === 'section' && remaining > 0 ? 'Continue' : 'Close'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy === 'submit'}
                  onClick={() => setReview(null)}
                  className={consoleButton({ variant: 'ghost' })}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy === 'submit'}
                  onClick={() => void save({ submitSection: review.key }, 'submit')}
                  className={consoleButton({ variant: 'accent' })}
                >
                  {busy === 'submit' ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : null}
                  Submit now
                </button>
              </>
            )
          }
        >
          <AnswerSummary
            groups={review.done === 'all' ? groups : [reviewGroup]}
            answers={answers}
          />
          {review.done === 'section' && remaining > 0 ? (
            <p className="mt-4 text-sm text-corp-text">
              {remaining} more section{remaining === 1 ? '' : 's'} to submit.
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </article>
  );
}

/** The delegate's answers, section by section: the section title first, then each question. */
function AnswerSummary({
  groups,
  answers,
}: {
  groups: ReturnType<typeof groupQuestions<DelegateQuestionView>>;
  answers: Record<string, unknown>;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section
          key={group.section?.id ?? GENERAL_SECTION}
          aria-label={`Summary: ${group.section?.title ?? 'Questions'}`}
          className="space-y-2"
        >
          <h3 className="border-b border-corp-line pb-1 font-corporate text-sm font-semibold text-corp-ink">
            {group.section?.title ?? 'Questions'}
          </h3>
          <dl className="space-y-2">
            {group.questions.map((q) => {
              const text = describeAnswer(q, answers[q.id]);
              return (
                <div key={q.id}>
                  <dt className="text-sm text-corp-text">{q.prompt}</dt>
                  <dd
                    className={
                      text ? 'text-sm font-semibold text-corp-ink' : 'text-sm text-corp-muted'
                    }
                  >
                    {text || 'No answer'}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

function QuestionField({
  index,
  question,
  value,
  disabled,
  problem,
  feedback,
  checking,
  onChange,
  onKnowledgeChoice,
}: {
  index: number;
  question: DelegateQuestionView;
  value: unknown;
  disabled: boolean;
  problem?: string;
  feedback?: KnowledgeFeedback;
  checking: boolean;
  onChange: (value: unknown) => void;
  onKnowledgeChoice: (value: string) => void;
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
      const knowledge = question.isKnowledge;
      const locked = knowledge && Boolean(feedback);
      return (
        <fieldset className="space-y-2">
          <legend>
            {label}
            {help}
            {knowledge && !locked ? (
              <span className="block text-xs text-corp-muted">
                Your answer is saved as soon as you choose it and cannot be changed.
              </span>
            ) : null}
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
                disabled={disabled || locked}
                onChange={() => {
                  if (question.type === 'yes_no') onChange(o.value === 'true');
                  else if (knowledge) onKnowledgeChoice(o.value);
                  else onChange(o.value);
                }}
                className="size-5 accent-corp-green"
              />
              {o.label}
              {feedback && feedback.correctValue === o.value && o.value !== current ? (
                <span className="text-xs text-corp-muted">(correct answer)</span>
              ) : null}
            </label>
          ))}
          {knowledge && checking && !feedback ? (
            <p className="flex items-center gap-1 text-xs text-corp-muted" role="status">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Checking…
            </p>
          ) : null}
          {feedback ? (
            <p
              role="status"
              className={
                feedback.correct
                  ? 'flex items-start gap-1 text-sm font-semibold text-corp-green-text'
                  : 'flex items-start gap-1 text-sm font-semibold text-brand-danger'
              }
            >
              {feedback.correct ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {feedback.correct
                  ? 'Correct.'
                  : `Not quite. The correct answer is: ${feedback.correctLabel}`}
              </span>
            </p>
          ) : null}
          {error}
        </fieldset>
      );
    }
    case 'multiple_choice': {
      const options = question.options ?? [];
      const answer = multipleChoiceAnswer(value) ?? { selected: [], other: null };
      // The text as typed (the parsed answer trims it, which would eat spaces while typing).
      const otherText =
        value &&
        typeof value === 'object' &&
        typeof (value as { other?: unknown }).other === 'string'
          ? (value as { other: string }).other
          : (answer.other ?? '');
      const otherOption = options.find((o) => o.other);
      const otherTicked = Boolean(otherOption && answer.selected.includes(otherOption.value));
      const toggle = (option: (typeof options)[number], checked: boolean) => {
        let selected: string[];
        if (!checked) {
          selected = answer.selected.filter((v) => v !== option.value);
        } else if (option.exclusive) {
          // "None of the above" and the like stand alone.
          selected = [option.value];
        } else {
          const exclusiveValues = new Set(options.filter((o) => o.exclusive).map((o) => o.value));
          selected = [...answer.selected.filter((v) => !exclusiveValues.has(v)), option.value];
        }
        const keepOther = otherOption ? selected.includes(otherOption.value) : false;
        onChange({ selected, other: keepOther ? otherText || null : null });
      };
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
                type="checkbox"
                checked={answer.selected.includes(o.value)}
                disabled={disabled}
                onChange={(e) => toggle(o, e.target.checked)}
                className="size-5 accent-corp-green"
              />
              {o.label}
            </label>
          ))}
          {otherOption && otherTicked ? (
            <div className="space-y-1 pl-7">
              <label htmlFor={`${id}-other`} className="block text-xs font-semibold text-corp-ink">
                Please specify
              </label>
              <input
                id={`${id}-other`}
                value={otherText}
                disabled={disabled}
                maxLength={500}
                onChange={(e) =>
                  onChange({ selected: answer.selected, other: e.target.value || null })
                }
                className={inputClass}
              />
            </div>
          ) : null}
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
