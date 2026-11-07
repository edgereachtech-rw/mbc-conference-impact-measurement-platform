'use client';

import {
  actionProgressLabels,
  actionProgressStatuses,
  measurePlaceholders,
  planActionFieldLabels,
  progressDetailPrompt,
  progressNeedsDetail,
  dateIn,
  impactCheckAnswerLabels,
  impactCheckAnswersFor,
  NO_REMINDERS,
  planCompletionGaps,
  planHasResult,
  planOutcomeDescriptions,
  planOutcomeLabels,
  planTitleOf,
  reminderFrequencies,
  reminderFrequencyLabels,
  transferPlanStatusLabels,
  weekdays,
  type ActionProgressStatus,
  type ImpactCheckAnswer,
  type MyTransferPlan,
  type MyTransferPlans,
  type PlanActionFields,
  type PlanActionView,
  type ReminderFrequency,
  type ReminderPreference,
  type TransferPlanSummary,
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

import { ActionMeasures, EvidenceDialog, MeasuresDialog } from './measures-evidence';
import { SupportRequestPanel } from './support-request';

export type MyTransferPlansState =
  | { kind: 'loading' }
  | { kind: 'ready'; plans: TransferPlanSummary[] }
  | { kind: 'error'; message: string; requestId?: string };

type PlanState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: MyTransferPlan }
  | { kind: 'error'; message: string; requestId?: string };

/** The delegate's plans for one event, loaded once by the event page and shared by the tabs. */
export function useMyTransferPlans(eventId: string) {
  const [state, setState] = useState<MyTransferPlansState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    apiFetch<MyTransferPlans>(`/me/events/${eventId}/transfer-plans`).then(
      (data) => {
        if (!cancelled) setState({ kind: 'ready', plans: data.plans });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Your plans could not be loaded.');
          setState({ kind: 'error', message: failure.message, requestId: failure.requestId });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);
  return {
    state,
    retry: () => setAttempt((n) => n + 1),
    /** After a change the list is read again so every tab's label and status is current. */
    refresh: () =>
      apiFetch<MyTransferPlans>(`/me/events/${eventId}/transfer-plans`).then(
        (data) => setState({ kind: 'ready', plans: data.plans }),
        () => undefined,
      ),
  };
}

/** The tab id of one plan on the delegate's event page (`#transfer-plan-<id>`). */
export const transferPlanTabId = (p: Pick<TransferPlanSummary, 'id'>) =>
  `transfer-plan-${p.id}` as const;

/** The plan a delegate most likely wants on arrival: the first still open, else the latest. */
export function defaultPlan(plans: TransferPlanSummary[]): string | null {
  return plans.find((p) => p.status !== 'completed')?.id ?? plans.at(-1)?.id ?? null;
}

interface TransferPlanPanelProps {
  eventId: string;
  timezone: string;
  /** The plan this tab shows. */
  planId: string;
  plans: MyTransferPlansState;
  /** The list changed (a save, a submission, a completion): the tabs re-read it. */
  onPlansChanged: () => void;
}

/**
 * One of the delegate's Individual Transfer Plans, as its own tab (task of 2026-11-07; before,
 * the plans sat as cards above one editor). Backlog E9, E10, E12-8 to 12-11: a plan is saved as
 * a draft in any Transfer Planning session, submitted once the final session has started, kept
 * open for changes and progress records, and marked completed once every action is applied with
 * evidence. Every save carries the version last seen so two tabs cannot overwrite each other.
 * One plan per delegate, as section 9 of the brief has it (decision 2026-11-07): more to do means
 * more actions in this plan, not another plan.
 */
export function TransferPlanPanel({
  eventId,
  timezone,
  planId,
  plans,
  onPlansChanged,
}: TransferPlanPanelProps) {
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<{ id: string; state: PlanState } | null>(null);
  // Kept outside the editor, which remounts on every new plan version.
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<'submitted' | 'completed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No loading state is set here: while the ids differ, `current` below is null and the
    // loading panel shows; a reload of the same plan keeps the old data until the new arrives.
    apiFetch<MyTransferPlan>(`/me/events/${eventId}/transfer-plans/${planId}`).then(
      (data) => {
        if (!cancelled) setPlan({ id: planId, state: { kind: 'ready', data } });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'Your plan could not be loaded.');
          setPlan({
            id: planId,
            state: { kind: 'error', message: failure.message, requestId: failure.requestId },
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, planId, attempt]);

  function updated(data: MyTransferPlan, message?: string) {
    setPlan({ id: data.plan.id, state: { kind: 'ready', data } });
    setNotice(message ?? null);
    onPlansChanged();
  }

  void plans;
  const current = plan && plan.id === planId ? plan.state : null;
  return (
    <div className="space-y-6">
      {!current || current.kind === 'loading' ? (
        <StatePanel kind="loading" title="Loading your plan…" />
      ) : current.kind === 'error' ? (
        <StatePanel
          kind="error"
          title="Plan unavailable"
          description={current.message}
          requestId={current.requestId}
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
      ) : (
        <PlanEditor
          key={`${current.data.plan.id}:${current.data.plan.version}`}
          eventId={eventId}
          timezone={timezone}
          data={current.data}
          notice={notice}
          onUpdated={updated}
          onSubmitted={(data) => {
            updated(data);
            setDone('submitted');
          }}
          onCompleted={(data) => {
            updated(data);
            setDone('completed');
          }}
          onReload={() => setAttempt((n) => n + 1)}
        />
      )}
      {/* Support to apply the plan (brief 11.7): asked from here, answered by the organisers. */}
      {current?.kind === 'ready' ? (
        <SupportRequestPanel eventId={eventId} actions={current.data.plan.actions} />
      ) : null}
      {done ? (
        <Dialog
          title={done === 'completed' ? 'Plan completed' : 'Plan submitted'}
          onClose={() => setDone(null)}
          size="md"
          footer={
            <button
              type="button"
              onClick={() => setDone(null)}
              className={consoleButton({ variant: 'primary' })}
            >
              Close
            </button>
          }
        >
          <p className="text-sm text-corp-text">
            {done === 'completed'
              ? 'Thank you. Your plan is completed: every action applied, with evidence, and the organisers have been told. Its reminders have stopped. Next comes impact assessment: in about three months we will ask whether the actions have made a measurable difference, and later whether that has lasted. Add further actions to this plan when you take on something new.'
              : 'Thank you. Your plan is submitted. Come back to this page to record progress on each action and to adjust the plan as things change.'}
          </p>
        </Dialog>
      ) : null}
    </div>
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
  onCompleted,
  onReload,
}: {
  eventId: string;
  timezone: string;
  data: MyTransferPlan;
  notice: string | null;
  onUpdated: (data: MyTransferPlan, message?: string) => void;
  onSubmitted: (data: MyTransferPlan) => void;
  onCompleted: (data: MyTransferPlan) => void;
  onReload: () => void;
}) {
  const { plan } = data;
  const [actions, setActions] = useState<ActionDraft[]>(() => plan.actions.map(draftOf));
  const [reminder, setReminder] = useState<ReminderPreference>({
    frequency: plan.reminder.frequency,
    startOn: plan.reminder.startOn,
    endOn: plan.reminder.endOn,
    time: plan.reminder.time || NO_REMINDERS.time,
    days: plan.reminder.days,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale?: boolean } | null>(null);
  const [dialog, setDialog] = useState<
    | null
    | { kind: 'review' }
    | { kind: 'complete' }
    | { kind: 'progress'; action: PlanActionView }
    | { kind: 'measures'; action: PlanActionView }
    | { kind: 'evidence'; action: PlanActionView }
  >(null);
  const id = useId();
  const submitted = plan.status === 'submitted';
  /** Completed plans are finished: read-only, reminders stopped (2026-11-06). */
  const locked = plan.status === 'completed';
  const finalSession = data.sessions.find((s) => s.isFinal);
  const hasContent = actions.some((a) => a.action.trim() !== '');
  /** What still stands between a submitted plan and completion, from the saved plan. */
  const gaps = submitted ? planCompletionGaps(plan.actions) : [];
  /** Completion is application; impact is the delegate's own report, which needs a recorded result. */
  const hasResult = planHasResult(plan.actions);
  const [improvement, setImprovement] = useState<'seen' | 'not_yet'>('not_yet');
  const [outcomeNote, setOutcomeNote] = useState('');
  /** The impact check waiting for an answer, if any, as of today in the event's timezone. */
  const today = dateIn(new Date(), timezone);
  const dueCheck = locked
    ? (plan.impactChecks.find((c) => !c.answeredAt && c.dueOn <= today) ?? null)
    : null;
  const nextCheck = locked ? (plan.impactChecks.find((c) => !c.answeredAt) ?? null) : null;

  function setPreference(patch: Partial<ReminderPreference>) {
    setDirty(true);
    setReminder((r) => ({ ...r, ...patch }));
  }
  function toggleDay(day: number) {
    const days = reminder.days.includes(day)
      ? reminder.days.filter((d) => d !== day)
      : [...reminder.days, day].sort((a, b) => a - b);
    setPreference({ days });
  }

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
      const saved = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${plan.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            version: plan.version,
            // No name is asked for any more (2026-11-07): the one plan is the plan.
            title: plan.title,
            actions: payloadOf(actions),
            reminder: {
              ...reminder,
              startOn: reminder.startOn || null,
              endOn: reminder.endOn || null,
              days: reminder.frequency === 'twice_weekly' ? reminder.days : [],
            },
          }),
        },
      );
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
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${plan.id}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ version: current.plan.version }),
        },
      );
      onSubmitted(result);
    } catch (e) {
      setDialog(null);
      setFailure(describeError(e, 'Your plan could not be submitted.'));
      if (current !== data) onUpdated(current);
    } finally {
      setBusy(false);
    }
  }

  /** Marks the submitted plan completed; the server checks application and evidence again. */
  async function complete() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${plan.id}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ version: plan.version, improvement, note: outcomeNote.trim() }),
        },
      );
      setDialog(null);
      onCompleted(result);
    } catch (e) {
      setDialog(null);
      if (e instanceof ApiError && e.code === 'plan_incomplete') {
        setFailure({
          message:
            'Every action needs to be applied, with evidence, before the plan can be completed. Reload the plan to see what is missing.',
          stale: true,
        });
      } else {
        setFailure(describeError(e, 'Your plan could not be completed.'));
      }
    } finally {
      setBusy(false);
    }
  }

  /** Answers the impact check that is due; the outcome moves only as far as the evidence goes. */
  const [checkAnswer, setCheckAnswer] = useState<ImpactCheckAnswer | null>(null);
  const [checkNote, setCheckNote] = useState('');
  const [checkEvidence, setCheckEvidence] = useState('');
  async function answerCheck() {
    if (!dueCheck || !checkAnswer) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${plan.id}/impact-checks/${dueCheck.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            answer: checkAnswer,
            note: checkNote.trim(),
            evidence: checkEvidence.trim(),
          }),
        },
      );
      onUpdated(result, 'Thank you. Your answer is recorded.');
    } catch (e) {
      setFailure(describeError(e, 'Your answer could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={submitted || locked ? 'positive' : 'neutral'}>
          {transferPlanStatusLabels[plan.status]}
        </StatusPill>
        <p className="text-sm text-corp-muted">
          {locked
            ? `Completed ${formatInstant(plan.completedAt, timezone)}. This plan is finished and its reminders have stopped; it stays here to read.`
            : submitted
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
            disabled={busy || locked}
            onChange={(patch) => update(a.key, patch)}
            onPriority={() => setPriority(a.key)}
            onMove={(delta) => move(a.key, delta)}
            onRemove={() => remove(a.key)}
            onProgress={(action) => setDialog({ kind: 'progress', action })}
            dirty={dirty}
            onMeasures={(action) => setDialog({ kind: 'measures', action })}
            onEvidence={(action) => setDialog({ kind: 'evidence', action })}
            timezone={timezone}
          />
        ))}
        <button
          type="button"
          onClick={add}
          disabled={busy || locked}
          hidden={locked}
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
        {!locked ? (
          <p className="text-sm text-corp-text">
            Reminders are for after the conference, when the plan meets your working week. You can
            set them now or come back to this section later; nothing is sent until the start date
            you choose.
          </p>
        ) : null}
        <p className="text-sm text-corp-muted">
          {locked
            ? 'This plan is completed, so its reminders have stopped.'
            : 'When and how often would you like to be reminded about this plan? Reminders arrive by email at the time you choose and mention your first priority. In the last week before they end, the email says so and you can extend them here. Change or stop them at any time.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-frequency`} className="text-sm font-semibold text-corp-ink">
              How often
            </label>
            <NativeSelect
              id={`${id}-frequency`}
              value={reminder.frequency}
              disabled={busy || locked}
              onChange={(e) => setPreference({ frequency: e.target.value as ReminderFrequency })}
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
            <label htmlFor={`${id}-time`} className="text-sm font-semibold text-corp-ink">
              At what time
            </label>
            <input
              id={`${id}-time`}
              type="time"
              value={reminder.time}
              disabled={busy || locked || reminder.frequency === 'none'}
              onChange={(e) => setPreference({ time: e.target.value || NO_REMINDERS.time })}
              className={input}
            />
            <p className="text-xs text-corp-muted">Event time ({timezone}).</p>
          </div>
          {reminder.frequency === 'twice_weekly' ? (
            <fieldset className="space-y-1 sm:col-span-2">
              <legend className="text-sm font-semibold text-corp-ink">Which two days</legend>
              <div className="flex flex-wrap gap-2">
                {weekdays.map((d) => {
                  const on = reminder.days.includes(d.value);
                  return (
                    <label
                      key={d.value}
                      className={`inline-flex min-h-10 cursor-pointer items-center gap-2 border px-3 text-sm ${
                        on
                          ? 'border-corp-green bg-corp-green-soft text-corp-ink'
                          : 'border-corp-line bg-white text-corp-text'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy || locked || (!on && reminder.days.length >= 2)}
                        onChange={() => toggleDay(d.value)}
                        className="size-4"
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
              {reminder.days.length !== 2 ? (
                <p className="text-xs text-brand-danger">Choose two days.</p>
              ) : null}
            </fieldset>
          ) : null}
          <div className="space-y-1">
            <label htmlFor={`${id}-start`} className="text-sm font-semibold text-corp-ink">
              Start from
            </label>
            <input
              id={`${id}-start`}
              type="date"
              value={reminder.startOn ?? ''}
              disabled={busy || locked || reminder.frequency === 'none'}
              onChange={(e) => setPreference({ startOn: e.target.value || null })}
              className={input}
            />
            <p className="text-xs text-corp-muted">Leave empty to start right away.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-end`} className="text-sm font-semibold text-corp-ink">
              Until
            </label>
            <input
              id={`${id}-end`}
              type="date"
              value={reminder.endOn ?? ''}
              min={reminder.startOn ?? undefined}
              disabled={busy || locked || reminder.frequency === 'none'}
              onChange={(e) => setPreference({ endOn: e.target.value || null })}
              className={input}
            />
            <p className="text-xs text-corp-muted">
              Leave empty to keep going until the plan is completed. To extend, pick a later date.
            </p>
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

      {submitted ? (
        <section
          aria-labelledby={`${id}-finish`}
          className="space-y-3 border border-corp-line bg-white p-4"
        >
          <h3 id={`${id}-finish`} className="font-semibold text-corp-ink">
            Finishing this plan
          </h3>
          <p className="text-sm text-corp-muted">
            A plan is completed once every action has been applied on the job (recorded as applied
            or completed) with at least one piece of evidence. Completing it stops the reminders,
            freezes the plan and tells the organisers. Whether the actions made a measurable
            difference is a separate question you answer as you complete it, and again at later
            impact checks.
          </p>
          {gaps.length > 0 ? (
            <ul aria-label="Still needed before completion" className="space-y-1 text-sm">
              {gaps.map((g) => (
                <li key={g.actionId} className="flex items-start gap-2 text-corp-text">
                  <AlertCircleIcon
                    className="mt-0.5 size-4 shrink-0 text-corp-accent-deep"
                    aria-hidden="true"
                  />
                  <span className="flex flex-1 flex-wrap items-center gap-2">
                    <span>
                      <span className="font-semibold text-corp-ink">{g.action}</span>: needs{' '}
                      {g.missing
                        .map((m) => (m === 'applied' ? 'to be recorded as applied' : 'evidence'))
                        .join(' and ')}
                      .
                    </span>
                    {(() => {
                      const action = plan.actions.find((a) => a.id === g.actionId);
                      if (!action) return null;
                      return (
                        <span className="flex flex-wrap gap-1">
                          {g.missing.includes('applied') ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setDialog({ kind: 'progress', action })}
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              Did it happen?
                            </button>
                          ) : null}
                          {g.missing.includes('evidence') ? (
                            <button
                              type="button"
                              disabled={busy || dirty}
                              onClick={() => setDialog({ kind: 'evidence', action })}
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              What shows it?
                            </button>
                          ) : null}
                        </span>
                      );
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-corp-green-text">
              Every action is applied, with evidence. You can complete the plan.
            </p>
          )}
          <button
            type="button"
            disabled={busy || dirty || gaps.length > 0}
            onClick={() => setDialog({ kind: 'complete' })}
            className={consoleButton({ variant: 'primary' })}
          >
            Mark this plan completed
          </button>
          {dirty ? <p className="text-xs text-corp-muted">Save your changes first.</p> : null}
        </section>
      ) : null}

      {locked ? (
        <section
          aria-labelledby={`${id}-impact`}
          className="space-y-3 border border-corp-line bg-white p-4"
        >
          <h3 id={`${id}-impact`} className="font-semibold text-corp-ink">
            Impact assessment and sustainability
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="positive">{planOutcomeLabels[plan.outcome]}</StatusPill>
            <p className="text-sm text-corp-muted">{planOutcomeDescriptions[plan.outcome]}</p>
          </div>
          {plan.outcomeNote ? (
            <p className="text-sm text-corp-text">
              <span className="font-semibold text-corp-ink">In your words:</span> {plan.outcomeNote}
            </p>
          ) : null}
          {plan.impactChecks.filter((c) => c.answeredAt).length > 0 ? (
            <ol aria-label="Impact checks answered" className="space-y-1 text-sm text-corp-text">
              {plan.impactChecks
                .filter((c) => c.answeredAt)
                .map((c) => (
                  <li key={c.id}>
                    <span className="font-semibold text-corp-ink">
                      Check {c.round}, {formatInstant(c.answeredAt, timezone)}:
                    </span>{' '}
                    {c.answer ? impactCheckAnswerLabels[c.answer] : ''}
                    {c.evidence ? ` (${c.evidence})` : ''}
                    {c.note ? ` ${c.note}` : ''}
                  </li>
                ))}
            </ol>
          ) : null}
          {dueCheck ? (
            <form
              aria-label={`Impact check ${dueCheck.round}`}
              onSubmit={(e) => {
                e.preventDefault();
                void answerCheck();
              }}
              className="space-y-3 border-l-4 border-corp-accent bg-corp-accent-soft/40 p-3"
            >
              <p className="text-sm font-semibold text-corp-ink">
                {plan.outcome === 'impact_demonstrated'
                  ? 'Has the improvement you reported continued?'
                  : 'Has a measurable improvement appeared since you completed the plan?'}
              </p>
              <fieldset className="space-y-2">
                <legend className="sr-only">Your answer</legend>
                {impactCheckAnswersFor(plan.outcome).map((a) => (
                  <label key={a} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${id}-check`}
                      checked={checkAnswer === a}
                      onChange={() => setCheckAnswer(a)}
                      className="mt-1 size-4"
                    />
                    <span>{impactCheckAnswerLabels[a]}</span>
                  </label>
                ))}
              </fieldset>
              {checkAnswer === 'improved' || checkAnswer === 'sustained' ? (
                <div className="space-y-1">
                  <label
                    htmlFor={`${id}-check-evidence`}
                    className="text-sm font-semibold text-corp-ink"
                  >
                    What evidence shows it? (required)
                  </label>
                  <textarea
                    id={`${id}-check-evidence`}
                    rows={3}
                    maxLength={2000}
                    value={checkEvidence}
                    onChange={(e) => setCheckEvidence(e.target.value)}
                    className={textarea}
                  />
                </div>
              ) : null}
              <div className="space-y-1">
                <label htmlFor={`${id}-check-note`} className="text-sm font-semibold text-corp-ink">
                  Anything else? (optional)
                </label>
                <textarea
                  id={`${id}-check-note`}
                  rows={2}
                  maxLength={2000}
                  value={checkNote}
                  onChange={(e) => setCheckNote(e.target.value)}
                  className={textarea}
                />
              </div>
              <button
                type="submit"
                disabled={
                  busy ||
                  !checkAnswer ||
                  ((checkAnswer === 'improved' || checkAnswer === 'sustained') &&
                    !checkEvidence.trim())
                }
                className={consoleButton({ variant: 'accent' })}
              >
                {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Save my answer
              </button>
            </form>
          ) : nextCheck ? (
            <p className="text-sm text-corp-muted">
              We will ask you on {formatDateShort(nextCheck.dueOn)} whether
              {plan.outcome === 'impact_demonstrated'
                ? ' the improvement has continued.'
                : ' a measurable improvement has appeared.'}{' '}
              You will get an email that day.
            </p>
          ) : (
            <p className="text-sm text-corp-muted">
              No further checks are scheduled. The outcome above stands as you last reported it.
            </p>
          )}
        </section>
      ) : null}

      {locked ? null : (
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
      )}

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
            Reminders: {reminderFrequencyLabels[reminder.frequency].toLowerCase()}
            {reminder.frequency !== 'none' && reminder.startOn
              ? ` from ${formatDateShort(reminder.startOn)}`
              : ''}
            {reminder.frequency !== 'none' && reminder.endOn
              ? ` until ${formatDateShort(reminder.endOn)}`
              : ''}
            .
          </p>
        </Dialog>
      ) : null}

      {dialog?.kind === 'complete' ? (
        <Dialog
          title="Complete this plan?"
          description="Every action is applied, with evidence. Once completed, the plan cannot be changed, its reminders stop, and the organisers are told. Impact checks follow later."
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
                Not yet
              </button>
              <button
                type="button"
                disabled={busy || (improvement === 'seen' && !hasResult)}
                onClick={() => void complete()}
                className={consoleButton({ variant: 'primary' })}
              >
                {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Complete the plan
              </button>
            </>
          }
        >
          <div className="space-y-4 text-sm text-corp-text">
            <p>
              {planTitleOf(plan)}: {plan.actions.filter((a) => a.action.trim()).length} action
              {plan.actions.filter((a) => a.action.trim()).length === 1 ? '' : 's'}, each applied
              with evidence.
            </p>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-corp-ink">
                Have these actions made a measurable difference to performance or results yet?
              </legend>
              <p className="text-xs text-corp-muted">
                Completing the actions is one thing; a measurable improvement is another. Either
                answer is fine: what counts is what the evidence shows. We will ask again later.
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`${id}-improvement`}
                  checked={improvement === 'not_yet'}
                  onChange={() => setImprovement('not_yet')}
                  className="mt-1 size-4"
                />
                <span>No measurable improvement yet</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`${id}-improvement`}
                  checked={improvement === 'seen'}
                  onChange={() => setImprovement('seen')}
                  className="mt-1 size-4"
                />
                <span>Yes, there is a measurable improvement, and the evidence shows it</span>
              </label>
              {improvement === 'seen' && !hasResult ? (
                <div role="alert" className="space-y-2 text-xs text-brand-danger">
                  <p>
                    Record the result on at least one action first: open &ldquo;What changed?&rdquo;
                    on the action and fill in the actual value of its measure, or put the results in
                    a progress record.
                  </p>
                  {plan.actions.find((a) => a.action.trim()) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setDialog({
                          kind: 'measures',
                          action: plan.actions.find((a) => a.action.trim())!,
                        })
                      }
                      className={consoleButton({ variant: 'secondary', size: 'sm' })}
                    >
                      Record a result
                    </button>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
            <div className="space-y-1">
              <label htmlFor={`${id}-outcome-note`} className="font-semibold text-corp-ink">
                In your words, what changed, or what has not changed yet? (optional)
              </label>
              <textarea
                id={`${id}-outcome-note`}
                rows={3}
                maxLength={2000}
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                className={textarea}
              />
            </div>
          </div>
        </Dialog>
      ) : null}
      {dialog?.kind === 'progress' ? (
        <ProgressDialog
          eventId={eventId}
          planId={plan.id}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            onUpdated(result, 'Progress recorded.');
          }}
        />
      ) : null}
      {dialog?.kind === 'measures' ? (
        <MeasuresDialog
          eventId={eventId}
          planId={plan.id}
          action={dialog.action}
          version={plan.version}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            onUpdated(result, 'Measures saved.');
          }}
          onStale={(message) => {
            setDialog(null);
            setFailure({ message, stale: true });
          }}
        />
      ) : null}
      {dialog?.kind === 'evidence' ? (
        <EvidenceDialog
          eventId={eventId}
          planId={plan.id}
          action={dialog.action}
          version={plan.version}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            onUpdated(result, 'Evidence saved.');
          }}
          onStale={(message) => {
            setDialog(null);
            setFailure({ message, stale: true });
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
  dirty,
  onMeasures,
  onEvidence,
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
  /** Unsaved plan edits; the measure and evidence dialogs wait for a save. */
  dirty: boolean;
  onMeasures: (action: PlanActionView) => void;
  onEvidence: (action: PlanActionView) => void;
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

      {!saved ? (
        <p className="text-sm text-corp-muted">
          Write the action and its first step. Everything else can wait: open the groups below when
          you are ready, or come back to them later.
        </p>
      ) : null}
      {text('action')}
      {text('firstStep')}
      <details className="group border-t border-corp-line pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-corp-green-text">
          Why, when and who
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{text('priorityLearning')}</div>
          <div className="sm:col-span-2">{text('opportunity')}</div>
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
          What you expect to change, and how you will know
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
            <div>
              <p className="text-sm font-semibold text-corp-ink">Did it happen?</p>
              <p className="text-xs text-corp-muted">
                Where this action stands now: not started, started, applied, completed.
              </p>
            </div>
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
      {saved ? (
        <ActionMeasures
          action={saved}
          disabled={disabled}
          dirty={dirty}
          onMeasures={() => onMeasures(saved)}
          onEvidence={() => onEvidence(saved)}
        />
      ) : null}
    </article>
  );
}

// ------------------------------------------------------------------ progress dialog

function ProgressDialog({
  eventId,
  planId,
  action,
  onClose,
  onSaved,
}: {
  eventId: string;
  planId: string;
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
        `/me/events/${eventId}/transfer-plans/${planId}/actions/${action.id}/progress`,
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

// ------------------------------------------------------------------ the plans, grouped

/**
 * The Transfer plans tab (task of 2026-11-07): the delegate's plans as tabs inside one tab, the
 * chosen plan's page beneath. The page address names the chosen plan (`#transfer-plan-<id>`) so
 * a reload keeps it; plain `#transfer-plan` lands on the plan to act on.
 */
export function TransferPlansTabs({
  eventId,
  timezone,
  plans,
  selectedPlanId,
  onSelectPlan,
  onPlansChanged,
  onRetry,
}: {
  eventId: string;
  timezone: string;
  plans: MyTransferPlansState;
  selectedPlanId: string | null;
  onSelectPlan: (planId: string) => void;
  onPlansChanged: () => void;
  onRetry: () => void;
}) {
  if (plans.kind === 'loading') return <StatePanel kind="loading" title="Loading your plans…" />;
  if (plans.kind === 'error') {
    return (
      <StatePanel
        kind="error"
        title="Plans unavailable"
        description={plans.message}
        requestId={plans.requestId}
        action={
          <button
            type="button"
            onClick={onRetry}
            className={consoleButton({ variant: 'secondary' })}
          >
            Try again
          </button>
        }
      />
    );
  }
  const list = plans.plans;
  const selected =
    list.find((p) => p.id === selectedPlanId) ?? list.find((p) => p.id === defaultPlan(list));
  return (
    <div className="space-y-4">
      {list.length > 1 ? (
        <div
          role="tablist"
          aria-label="Your plans"
          className="-mx-gutter flex gap-1 overflow-x-auto border-b border-corp-line px-gutter md:mx-0 md:px-0"
        >
          {list.map((p) => {
            const on = p.id === selected?.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                id={`plan-tab-${p.id}`}
                aria-selected={on}
                aria-controls={`plan-panel-${p.id}`}
                onClick={() => onSelectPlan(p.id)}
                className={
                  on
                    ? '-mb-px flex min-h-tap shrink-0 flex-col items-start justify-center border-b-2 border-corp-accent px-3 py-2 text-left text-sm font-semibold whitespace-nowrap text-corp-ink'
                    : 'flex min-h-tap shrink-0 flex-col items-start justify-center border-b-2 border-transparent px-3 py-2 text-left text-sm font-medium whitespace-nowrap text-corp-muted hover:text-corp-ink'
                }
              >
                <span>{planTitleOf(p)}</span>
                <span className="text-xs font-normal">
                  {p.checkDue ? 'Impact check waiting' : transferPlanStatusLabels[p.status]}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {selected ? (
        <div
          role={list.length > 1 ? 'tabpanel' : undefined}
          id={`plan-panel-${selected.id}`}
          aria-labelledby={list.length > 1 ? `plan-tab-${selected.id}` : undefined}
        >
          <TransferPlanPanel
            key={selected.id}
            eventId={eventId}
            timezone={timezone}
            planId={selected.id}
            plans={plans}
            onPlansChanged={onPlansChanged}
          />
        </div>
      ) : (
        <p className="text-sm text-corp-muted">No plan yet.</p>
      )}
    </div>
  );
}
