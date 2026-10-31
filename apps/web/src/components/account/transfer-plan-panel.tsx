'use client';

import {
  actionProgressLabels,
  actionProgressStatuses,
  measurePlaceholders,
  planActionFieldLabels,
  progressDetailPrompt,
  progressNeedsDetail,
  reminderFrequencies,
  reminderFrequencyLabels,
  type ActionProgressStatus,
  type MyTransferPlan,
  type PlanActionFields,
  type PlanActionView,
  type ReminderFrequency,
} from '@mbc/shared';
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface TransferPlanPanelProps {
  eventId: string;
  timezone: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: MyTransferPlan }
  | { kind: 'error'; message: string; requestId?: string };

/**
 * The delegate's Individual Transfer Plan (backlog E9, E10, E12-8 to 12-11): one continuous
 * plan per event, saved as a draft in any Transfer Planning session, submitted once the final
 * session has started, then kept open for changes and progress records. Every save carries the
 * version last seen so two tabs cannot overwrite each other.
 */
export function TransferPlanPanel({ eventId, timezone }: TransferPlanPanelProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Kept outside the editor, which remounts on every new plan version.
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<MyTransferPlan>(`/me/events/${eventId}/transfer-plan`).then(
      (data) => {
        if (!cancelled) setState({ kind: 'ready', data });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Your plan could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.kind === 'loading') return <StatePanel kind="loading" title="Loading your plan…" />;
  if (state.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Plan unavailable"
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
    <>
      <PlanEditor
        key={state.data.plan.version}
        eventId={eventId}
        timezone={timezone}
        data={state.data}
        notice={notice}
        onUpdated={(data, message) => {
          setState({ kind: 'ready', data });
          setNotice(message ?? null);
        }}
        onSubmitted={(data) => {
          setState({ kind: 'ready', data });
          setNotice(null);
          setDone(true);
        }}
        onReload={() => setAttempt((n) => n + 1)}
      />
      {done ? (
        <Dialog
          title="Plan submitted"
          onClose={() => setDone(false)}
          size="md"
          footer={
            <button
              type="button"
              onClick={() => setDone(false)}
              className={consoleButton({ variant: 'primary' })}
            >
              Close
            </button>
          }
        >
          <p className="text-sm text-corp-text">
            Thank you. Your plan is submitted. Come back to this page to record progress on each
            action and to adjust the plan as things change.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ editor

interface ActionDraft extends Omit<PlanActionFields, 'startOn' | 'targetOn' | 'reviewOn'> {
  key: string;
  startOn: string;
  targetOn: string;
  reviewOn: string;
}

let tempKeys = 0;
const nextKey = () => `new-${++tempKeys}`;

function emptyAction(): ActionDraft {
  return {
    key: nextKey(),
    isPriority: false,
    priorityLearning: '',
    action: '',
    opportunity: '',
    firstStep: '',
    startOn: '',
    targetOn: '',
    stakeholders: '',
    support: '',
    barriers: '',
    evidence: '',
    expectedResult: '',
    measure: '',
    baseline: '',
    reviewOn: '',
  };
}

function draftOf(a: PlanActionView): ActionDraft {
  return {
    key: a.id,
    id: a.id,
    isPriority: a.isPriority,
    priorityLearning: a.priorityLearning,
    action: a.action,
    opportunity: a.opportunity,
    firstStep: a.firstStep,
    startOn: a.startOn ?? '',
    targetOn: a.targetOn ?? '',
    stakeholders: a.stakeholders,
    support: a.support,
    barriers: a.barriers,
    evidence: a.evidence,
    expectedResult: a.expectedResult,
    measure: a.measure,
    baseline: a.baseline,
    reviewOn: a.reviewOn ?? '',
  };
}

function payloadOf(actions: ActionDraft[]): PlanActionFields[] {
  return actions.map(({ key, startOn, targetOn, reviewOn, ...rest }) => {
    void key;
    return {
      ...rest,
      startOn: startOn || null,
      targetOn: targetOn || null,
      reviewOn: reviewOn || null,
    };
  });
}

const textarea =
  'w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm';
const input = 'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm';

function PlanEditor({
  eventId,
  timezone,
  data,
  notice,
  onUpdated,
  onSubmitted,
  onReload,
}: {
  eventId: string;
  timezone: string;
  data: MyTransferPlan;
  notice: string | null;
  onUpdated: (data: MyTransferPlan, message?: string) => void;
  onSubmitted: (data: MyTransferPlan) => void;
  onReload: () => void;
}) {
  const { plan } = data;
  const [actions, setActions] = useState<ActionDraft[]>(() => plan.actions.map(draftOf));
  const [frequency, setFrequency] = useState<ReminderFrequency>(plan.reminder.frequency);
  const [startOn, setStartOn] = useState(plan.reminder.startOn ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale?: boolean } | null>(null);
  const [dialog, setDialog] = useState<
    null | { kind: 'review' } | { kind: 'progress'; action: PlanActionView }
  >(null);
  const id = useId();
  const submitted = plan.status === 'submitted';
  const finalSession = data.sessions.find((s) => s.isFinal);
  const hasContent = actions.some((a) => a.action.trim() !== '');

  function update(key: string, patch: Partial<ActionDraft>) {
    setDirty(true);
    setActions((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }
  function setPriority(key: string) {
    setDirty(true);
    setActions((list) => list.map((a) => ({ ...a, isPriority: a.key === key })));
  }
  function move(key: string, delta: -1 | 1) {
    setDirty(true);
    setActions((list) => {
      const index = list.findIndex((a) => a.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return copy;
    });
  }
  function remove(key: string) {
    setDirty(true);
    setActions((list) => list.filter((a) => a.key !== key));
  }
  function add() {
    setDirty(true);
    setActions((list) => [...list, { ...emptyAction(), isPriority: list.length === 0 }]);
  }

  async function save(): Promise<MyTransferPlan | null> {
    setBusy(true);
    setFailure(null);
    try {
      const saved = await apiFetch<MyTransferPlan>(`/me/events/${eventId}/transfer-plan`, {
        method: 'PUT',
        body: JSON.stringify({
          version: plan.version,
          actions: payloadOf(actions),
          reminder: { frequency, startOn: startOn || null },
        }),
      });
      setDirty(false);
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_plan') {
        setFailure({ message: e.message, stale: true });
      } else {
        setFailure(describeError(e, 'Your plan could not be saved.'));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const saved = await save();
    if (saved) onUpdated(saved, submitted ? 'Your changes are saved.' : 'Draft saved.');
  }

  async function submit() {
    // Unsaved edits go first, so what is submitted is what is on screen.
    let current: MyTransferPlan = data;
    if (dirty) {
      const saved = await save();
      if (!saved) {
        setDialog(null);
        return;
      }
      current = saved;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<MyTransferPlan>(`/me/events/${eventId}/transfer-plan/submit`, {
        method: 'POST',
        body: JSON.stringify({ version: current.plan.version }),
      });
      onSubmitted(result);
    } catch (e) {
      setDialog(null);
      setFailure(describeError(e, 'Your plan could not be submitted.'));
      if (current !== data) onUpdated(current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={submitted ? 'positive' : 'neutral'}>
          {submitted ? 'Submitted' : 'Draft'}
        </StatusPill>
        <p className="text-sm text-corp-muted">
          {submitted
            ? `Submitted ${formatInstant(plan.submittedAt, timezone)}. You can keep updating it; the organisers keep your original submission.`
            : data.canSubmit
              ? 'Save as often as you like, then submit when your plan is ready.'
              : finalSession
                ? `Keep saving your draft. You submit from the start of the final Transfer Planning session on ${formatDateShort(finalSession.date)} at ${finalSession.startTime}.`
                : 'Keep saving your draft until you are ready to submit.'}
        </p>
      </div>

      {data.sessions.length > 0 ? (
        <section aria-label="Transfer Planning sessions" className="text-sm text-corp-text">
          <p className="font-semibold text-corp-ink">Transfer Planning sessions</p>
          <ul className="mt-1 space-y-0.5">
            {data.sessions.map((s) => (
              <li key={s.id}>
                {formatDateShort(s.date)}, {s.startTime}–{s.endTime}: {s.title}
                {s.isFinal ? ' (final session, submission opens)' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <References references={data.references} />

      {failure ? (
        <div
          role="alert"
          className="flex items-start gap-2 border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm text-brand-danger"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p className="font-semibold">{failure.message}</p>
            {failure.stale ? (
              <button
                type="button"
                onClick={onReload}
                className={consoleButton({ variant: 'secondary', size: 'sm' })}
              >
                Reload my plan
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm font-semibold text-corp-green-text">
          {notice}
        </p>
      ) : null}

      <div className="space-y-4">
        {actions.length === 0 ? (
          <p className="border border-dashed border-corp-line bg-white p-4 text-sm text-corp-muted">
            No action yet. Add the first thing you will do differently after the conference.
          </p>
        ) : null}
        {actions.map((a, index) => (
          <ActionCard
            key={a.key}
            draft={a}
            index={index}
            count={actions.length}
            saved={plan.actions.find((p) => p.id === a.id) ?? null}
            disabled={busy}
            onChange={(patch) => update(a.key, patch)}
            onPriority={() => setPriority(a.key)}
            onMove={(delta) => move(a.key, delta)}
            onRemove={() => remove(a.key)}
            onProgress={(action) => setDialog({ kind: 'progress', action })}
            timezone={timezone}
          />
        ))}
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className={consoleButton({ variant: 'secondary' })}
        >
          <PlusIcon aria-hidden="true" /> Add an action
        </button>
      </div>

      <section
        aria-labelledby={`${id}-reminders`}
        className="space-y-3 border border-corp-line bg-white p-4"
      >
        <h3 id={`${id}-reminders`} className="font-semibold text-corp-ink">
          Reminders
        </h3>
        <p className="text-sm text-corp-muted">
          When and how often would you like to be reminded about your plan? Reminders arrive by
          email and mention your first priority. Change or stop them here at any time.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-frequency`} className="text-sm font-semibold text-corp-ink">
              How often
            </label>
            <NativeSelect
              id={`${id}-frequency`}
              value={frequency}
              disabled={busy}
              onChange={(e) => {
                setDirty(true);
                setFrequency(e.target.value as ReminderFrequency);
              }}
              className="rounded-none border-corp-line"
            >
              {reminderFrequencies.map((f) => (
                <option key={f} value={f}>
                  {reminderFrequencyLabels[f]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-start`} className="text-sm font-semibold text-corp-ink">
              Start from
            </label>
            <input
              id={`${id}-start`}
              type="date"
              value={startOn}
              disabled={busy || frequency === 'none'}
              onChange={(e) => {
                setDirty(true);
                setStartOn(e.target.value);
              }}
              className={input}
            />
          </div>
        </div>
        {plan.reminder.nextReminderAt ? (
          <p className="text-xs text-corp-muted">
            Next reminder {formatInstant(plan.reminder.nextReminderAt, timezone)}.
          </p>
        ) : null}
        {data.reminders.length > 0 ? (
          <p className="text-xs text-corp-muted">
            Last reminder {data.reminders[0]!.status === 'sent' ? 'sent' : 'attempted'}{' '}
            {formatInstant(data.reminders[0]!.sentAt ?? data.reminders[0]!.scheduledFor, timezone)}.
          </p>
        ) : null}
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void saveDraft()}
          className={consoleButton({
            variant: submitted || !data.canSubmit ? 'accent' : 'secondary',
          })}
        >
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {submitted ? 'Save changes' : 'Save draft'}
        </button>
        {!submitted && data.canSubmit ? (
          <button
            type="button"
            disabled={busy || !hasContent}
            onClick={() => setDialog({ kind: 'review' })}
            className={consoleButton({ variant: 'accent' })}
          >
            Submit my plan
          </button>
        ) : null}
      </div>

      {dialog?.kind === 'review' ? (
        <Dialog
          title="Submit your plan?"
          description="Check your actions. After submitting you can still update the plan and record progress; the organisers keep this version as submitted."
          onClose={() => setDialog(null)}
          closeDisabled={busy}
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
                className={consoleButton({ variant: 'ghost' })}
              >
                Keep editing
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
          }
        >
          <ol
            aria-label="Summary: your actions"
            className="list-decimal space-y-3 pl-5 text-sm text-corp-text"
          >
            {actions.map((a, i) => (
              <li key={a.key}>
                <p className="font-semibold text-corp-ink">
                  {a.action.trim() || `Action ${i + 1} (no action written)`}
                  {a.isPriority ? (
                    <span className="ml-2 text-xs font-semibold text-corp-green-text uppercase">
                      First priority
                    </span>
                  ) : null}
                </p>
                {a.firstStep ? <p>First step: {a.firstStep}</p> : null}
                {a.startOn || a.targetOn ? (
                  <p className="text-corp-muted">
                    {a.startOn ? `Starts ${formatDateShort(a.startOn)}` : ''}
                    {a.startOn && a.targetOn ? ' · ' : ''}
                    {a.targetOn ? `Target ${formatDateShort(a.targetOn)}` : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-corp-muted">
            Reminders: {reminderFrequencyLabels[frequency].toLowerCase()}
            {frequency !== 'none' && startOn ? ` from ${formatDateShort(startOn)}` : ''}.
          </p>
        </Dialog>
      ) : null}
      {dialog?.kind === 'progress' ? (
        <ProgressDialog
          eventId={eventId}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            onUpdated(result, 'Progress recorded.');
          }}
        />
      ) : null}
    </div>
  );
}

function References({ references }: { references: MyTransferPlan['references'] }) {
  if (references.length === 0) return null;
  return (
    <section
      aria-label="Before the conference, you said"
      className="space-y-2 border-l-4 border-corp-accent bg-corp-accent-soft/40 p-4 text-sm"
    >
      <p className="font-semibold text-corp-ink">Before the conference, you said</p>
      <dl className="space-y-2">
        {references.map((r) => (
          <div key={r.questionKey}>
            <dt className="text-xs font-semibold text-corp-muted">{r.prompt}</dt>
            <dd className="text-corp-text">
              {r.answer ?? <span className="text-corp-muted">No answer recorded.</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ one action

function ActionCard({
  draft,
  index,
  count,
  saved,
  disabled,
  onChange,
  onPriority,
  onMove,
  onRemove,
  onProgress,
  timezone,
}: {
  draft: ActionDraft;
  index: number;
  count: number;
  saved: PlanActionView | null;
  disabled: boolean;
  onChange: (patch: Partial<ActionDraft>) => void;
  onPriority: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onProgress: (action: PlanActionView) => void;
  timezone: string;
}) {
  const id = useId();
  const title = draft.action.trim() ? draft.action.trim() : `Action ${index + 1}`;
  const text = (field: keyof ActionDraft, rows = 2) => {
    const meta = planActionFieldLabels[field as keyof typeof planActionFieldLabels];
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-${field}`} className="text-sm font-semibold text-corp-ink">
          {meta.label}
        </label>
        <p className="text-xs text-corp-muted">{meta.prompt}</p>
        <textarea
          id={`${id}-${field}`}
          rows={rows}
          value={String(draft[field] ?? '')}
          disabled={disabled}
          onChange={(e) => onChange({ [field]: e.target.value } as Partial<ActionDraft>)}
          className={textarea}
        />
        {field === 'measure' || field === 'baseline' ? (
          <div className="flex flex-wrap gap-2">
            {measurePlaceholders.map((p) => (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ [field]: p } as Partial<ActionDraft>)}
                className={consoleButton({ variant: 'ghost', size: 'sm' })}
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };
  const date = (field: 'startOn' | 'targetOn' | 'reviewOn') => {
    const meta = planActionFieldLabels[field];
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-${field}`} className="text-sm font-semibold text-corp-ink">
          {meta.label}
        </label>
        <p className="text-xs text-corp-muted">{meta.prompt}</p>
        <input
          id={`${id}-${field}`}
          type="date"
          value={draft[field]}
          disabled={disabled}
          onChange={(e) => onChange({ [field]: e.target.value })}
          className={input}
        />
      </div>
    );
  };

  return (
    <article
      aria-label={title}
      className="space-y-4 rounded-none border border-corp-line bg-white p-4 shadow-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-corp-ink">
            Action {index + 1} of {count}
          </p>
          {saved ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-corp-muted">
              <StatusPill tone={saved.progressStatus === 'not_started' ? 'neutral' : 'positive'}>
                {actionProgressLabels[saved.progressStatus]}
              </StatusPill>
              {saved.progress[0]
                ? `Updated ${formatInstant(saved.progress[0].recordedAt, timezone)}`
                : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-label={`Move action ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            <ArrowUpIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Move action ${index + 1} down`}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            <ArrowDownIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Remove action ${index + 1}`}
            disabled={disabled}
            onClick={onRemove}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            <Trash2Icon aria-hidden="true" />
          </button>
        </div>
      </div>

      <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
        <input
          type="radio"
          name={`${id}-priority`}
          checked={draft.isPriority}
          disabled={disabled}
          onChange={onPriority}
          className="size-5 accent-corp-green"
        />
        This is my first priority
      </label>

      {text('priorityLearning')}
      {text('action')}
      {text('opportunity')}
      {text('firstStep')}
      <details className="group border-t border-corp-line pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-corp-green-text">
          Dates, people and support
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {date('startOn')}
          {date('targetOn')}
          <div className="sm:col-span-2">{text('stakeholders')}</div>
          <div className="sm:col-span-2">{text('support')}</div>
          <div className="sm:col-span-2">{text('barriers')}</div>
          {date('reviewOn')}
        </div>
      </details>
      <details className="border-t border-corp-line pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-corp-green-text">
          Results, measure and evidence
        </summary>
        <div className="mt-3 space-y-4">
          {text('expectedResult')}
          {text('evidence')}
          {text('measure')}
          {text('baseline')}
        </div>
      </details>

      {saved ? (
        <div className="space-y-2 border-t border-corp-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-corp-ink">Progress</p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onProgress(saved)}
              className={consoleButton({ variant: 'secondary', size: 'sm' })}
            >
              Record progress
            </button>
          </div>
          {saved.progress.length > 0 ? (
            <ul className="space-y-2 text-sm text-corp-text">
              {saved.progress.map((p) => (
                <li key={p.id} className="border-l-2 border-corp-line pl-3">
                  <p className="font-semibold text-corp-ink">
                    {actionProgressLabels[p.status]}
                    <span className="ml-2 font-normal text-corp-muted">
                      {formatInstant(p.recordedAt, timezone)}
                    </span>
                  </p>
                  {p.note ? <p>{p.note}</p> : null}
                  {p.results ? <p>Results: {p.results}</p> : null}
                  {p.challenges ? <p>Challenges: {p.challenges}</p> : null}
                  {p.newTargetOn ? <p>New target: {formatDateShort(p.newTargetOn)}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-corp-muted">No progress recorded yet.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-corp-muted">Save the plan to record progress on this action.</p>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ progress dialog

function ProgressDialog({
  eventId,
  action,
  onClose,
  onSaved,
}: {
  eventId: string;
  action: PlanActionView;
  onClose: () => void;
  onSaved: (data: MyTransferPlan) => void;
}) {
  const id = useId();
  const [status, setStatus] = useState<ActionProgressStatus>(action.progressStatus);
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [results, setResults] = useState('');
  const [challenges, setChallenges] = useState('');
  const [newTargetOn, setNewTargetOn] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detail = progressDetailPrompt[status];

  async function save() {
    if (progressNeedsDetail(status) && note.trim() === '') {
      setProblem(detail);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plan/actions/${action.id}/progress`,
        {
          method: 'POST',
          body: JSON.stringify({
            status,
            note,
            evidence,
            results,
            challenges,
            newTargetOn: newTargetOn || null,
          }),
        },
      );
      onSaved(result);
    } catch (e) {
      setProblem(describeError(e, 'The progress could not be recorded.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Record progress"
      description={action.action.trim() || 'Your action'}
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
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Save progress
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {problem ? (
          <p
            role="alert"
            className="border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm font-semibold text-brand-danger"
          >
            {problem}
          </p>
        ) : null}
        <div className="space-y-1">
          <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
            Where does this action stand?
          </label>
          <NativeSelect
            id={`${id}-status`}
            value={status}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value as ActionProgressStatus)}
            className="rounded-none border-corp-line"
          >
            {actionProgressStatuses.map((s) => (
              <option key={s} value={s}>
                {actionProgressLabels[s]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-corp-muted">
            Started, in progress and completed describe the action; applied means you used the
            learning in real work.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-note`} className="text-sm font-semibold text-corp-ink">
            {detail ? 'Details (required)' : 'Note (optional)'}
          </label>
          {detail ? <p className="text-xs text-corp-muted">{detail}</p> : null}
          <textarea
            id={`${id}-note`}
            rows={3}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            className={textarea}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-results`} className="text-sm font-semibold text-corp-ink">
            Results so far (optional)
          </label>
          <textarea
            id={`${id}-results`}
            rows={2}
            value={results}
            disabled={busy}
            onChange={(e) => setResults(e.target.value)}
            className={textarea}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-evidence`} className="text-sm font-semibold text-corp-ink">
            Evidence (optional)
          </label>
          <textarea
            id={`${id}-evidence`}
            rows={2}
            value={evidence}
            disabled={busy}
            onChange={(e) => setEvidence(e.target.value)}
            className={textarea}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-challenges`} className="text-sm font-semibold text-corp-ink">
            Challenges (optional)
          </label>
          <textarea
            id={`${id}-challenges`}
            rows={2}
            value={challenges}
            disabled={busy}
            onChange={(e) => setChallenges(e.target.value)}
            className={textarea}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-target`} className="text-sm font-semibold text-corp-ink">
            New target date (optional)
          </label>
          <input
            id={`${id}-target`}
            type="date"
            value={newTargetOn}
            disabled={busy}
            onChange={(e) => setNewTargetOn(e.target.value)}
            className={input}
          />
        </div>
      </div>
    </Dialog>
  );
}
