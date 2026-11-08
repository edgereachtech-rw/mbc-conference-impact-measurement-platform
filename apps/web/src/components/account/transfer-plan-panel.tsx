'use client';

import {
  actionProgressLabels,
  appliedStatuses,
  actionSubmissionGaps,
  measurePlaceholders,
  planActionFieldLabels,
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
  type ImpactCheckAnswer,
  type MyTransferPlan,
  type MyTransferPlans,
  type PlanActionFields,
  type MeasureView,
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

import { ActionMeasures, EvidenceDialog, MeasuresDialog, ResultsDialog } from './measures-evidence';

export type MyTransferPlansState =
  | { kind: 'loading' }
  | { kind: 'ready'; plans: TransferPlanSummary[] }
  | { kind: 'error'; message: string; requestId?: string };

type PlanState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: MyTransferPlan }
  | { kind: 'error'; message: string; requestId?: string; gone?: boolean };

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
  /** A new plan was started: the page opens its tab. */
  onOpenPlan: (planId: string) => void;
}

/**
 * One of the delegate's Individual Transfer Plans, as its own tab (task of 2026-11-07; before,
 * the plans sat as cards above one editor). Backlog E9, E10, E12-8 to 12-11: a plan is saved as
 * a draft in any Transfer Planning session, submitted once the final session has started, kept
 * open for changes and progress records, and marked completed once every action is applied with
 * evidence. Every save carries the version last seen so two tabs cannot overwrite each other.
 * "Start another plan" opens a new tab for the next plan.
 */
export function TransferPlanPanel({
  eventId,
  timezone,
  planId,
  plans,
  onPlansChanged,
  onOpenPlan,
}: TransferPlanPanelProps) {
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<{ id: string; state: PlanState } | null>(null);
  // Kept outside the editor, which remounts on every new plan version.
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<'submitted' | 'completed' | null>(null);
  const [starting, setStarting] = useState<{ title: string; busy: boolean; error?: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    // No loading state is set here: while the ids differ, `current` below is null and the
    // loading panel shows; a reload of the same plan keeps the old data until the new arrives.
    apiFetch<MyTransferPlan>(`/me/events/${eventId}/transfer-plans/${planId}`).then(
      (data) => {
        if (!cancelled) setPlan({ id: planId, state: { kind: 'ready', data } });
      },
      (e: unknown) => {
        if (cancelled) return;
        // The plan is gone (deleted or replaced while this page was open): the list is read
        // again and the current plan takes its place (2026-11-08), instead of asking for the
        // same id until the page is reloaded.
        if (e instanceof ApiError && e.status === 404) {
          setPlan({
            id: planId,
            state: {
              kind: 'error',
              gone: true,
              message: 'This plan no longer exists. Your current plan is being opened instead.',
              requestId: e.requestId,
            },
          });
          onPlansChanged();
          return;
        }
        const failure = describeError(e, 'Your plan could not be loaded.');
        setPlan({
          id: planId,
          state: { kind: 'error', message: failure.message, requestId: failure.requestId },
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // onPlansChanged is a stable callback of the page; the load depends on the ids only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, planId, attempt]);

  // Once the fresh list is in and the gone plan is not on it, open the plan that is current.
  useEffect(() => {
    if (!plan || plan.id !== planId || plan.state.kind !== 'error' || !plan.state.gone) return;
    if (plans.kind !== 'ready' || plans.plans.some((p) => p.id === planId)) return;
    const next = defaultPlan(plans.plans);
    if (next && next !== planId) onOpenPlan(next);
    // onOpenPlan is a stable callback of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, planId, plans]);

  function updated(data: MyTransferPlan, message?: string) {
    setPlan({ id: data.plan.id, state: { kind: 'ready', data } });
    setNotice(message ?? null);
    onPlansChanged();
  }

  async function startAnother() {
    if (!starting) return;
    setStarting({ ...starting, busy: true, error: undefined });
    try {
      const created = await apiFetch<MyTransferPlan>(`/me/events/${eventId}/transfer-plans`, {
        method: 'POST',
        body: JSON.stringify({ title: starting.title.trim() }),
      });
      setStarting(null);
      setNotice(null);
      onPlansChanged();
      onOpenPlan(created.plan.id);
    } catch (e) {
      setStarting({
        ...starting,
        busy: false,
        error: describeError(e, 'The plan could not be started.').message,
      });
    }
  }

  const count = plans.kind === 'ready' ? plans.plans.length : 0;
  const current = plan && plan.id === planId ? plan.state : null;
  return (
    <div className="space-y-6">
      <section aria-label="Another plan" className="space-y-3">
        {starting ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void startAnother();
            }}
            className="flex flex-col gap-2 border border-corp-line bg-white p-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1">
              <label htmlFor="new-plan-title" className="text-sm font-semibold text-corp-ink">
                What is this plan about?
              </label>
              <input
                id="new-plan-title"
                value={starting.title}
                maxLength={120}
                disabled={starting.busy}
                onChange={(e) => setStarting({ ...starting, title: e.target.value })}
                placeholder={`Plan ${count + 1}`}
                className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
              />
              {starting.error ? (
                <p role="alert" className="text-xs text-brand-danger">
                  {starting.error}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={starting.busy}
                onClick={() => setStarting(null)}
                className={consoleButton({ variant: 'ghost' })}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={starting.busy}
                className={consoleButton({ variant: 'accent' })}
              >
                {starting.busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Start this plan
              </button>
            </div>
          </form>
        ) : (
          <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-corp-muted">
            <span>
              Each of your plans has its own tab. Start another only for something new you take on.
            </span>
            <button
              type="button"
              onClick={() => setStarting({ title: '', busy: false })}
              className={consoleButton({ variant: 'secondary', size: 'sm' })}
            >
              <PlusIcon aria-hidden="true" /> Start another plan
            </button>
          </p>
        )}
      </section>
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
              ? 'Thank you. Your plan is completed: every action applied, with evidence, and the organisers have been told. Its reminders have stopped. Next comes impact assessment: in about three months we will ask whether the actions have made a measurable difference, and later whether that has lasted. Start another plan only if you take on something new.'
              : 'Thank you. Your plan is submitted. Your 30, 60, 90-day and longer-term follow-ups will ask where each action stands, and what you tell them is shown here as your progress. You can still adjust the plan as things change.'}
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
    title: '',
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
    title: a.title,
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
    | { kind: 'measures'; action: PlanActionView }
    | { kind: 'results'; action: PlanActionView; measure: MeasureView }
    | { kind: 'evidence'; action: PlanActionView }
  >(null);
  const id = useId();
  const submitted = plan.status === 'submitted';
  /** Completed plans are finished: read-only, reminders stopped (2026-11-06). */
  const locked = plan.status === 'completed';
  const finalSession = data.sessions.find((s) => s.isFinal);
  const hasContent = actions.some((a) => a.action.trim() !== '');
  // Submission waits for a title, the priority learning and the action on every card
  // (spec 2026-11-08); drafts save with anything missing.
  const submissionGaps = actionSubmissionGaps(actions);
  const [removing, setRemoving] = useState<string | null>(null);
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
    setRemoving(null);
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
            ? `Completed ${formatInstant(plan.completedAt, timezone)}. This plan is finished and its reminders have stopped; it stays here to read. Start another plan for anything new.`
            : submitted
              ? `Submitted ${formatInstant(plan.submittedAt, timezone)}. You can keep updating it; the organisers keep your original submission.`
              : data.canSubmit
                ? 'Save as often as you like, then submit when your plan is ready.'
                : finalSession
                  ? `Keep saving your draft. You'll submit in the final Transfer Planning session on ${formatDateShort(finalSession.date)} at ${finalSession.startTime}.`
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
            onRemove={() => setRemoving(a.key)}
            dirty={dirty}
            onMeasures={(action) => setDialog({ kind: 'measures', action })}
            onResults={(action, measure) => setDialog({ kind: 'results', action, measure })}
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
                  <span>
                    <span className="font-semibold text-corp-ink">{g.action}</span>: needs{' '}
                    {g.missing
                      .map((m) => (m === 'applied' ? 'to be recorded as applied' : 'evidence'))
                      .join(' and ')}
                    .
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
              disabled={busy || !hasContent || submissionGaps.length > 0}
              onClick={() => setDialog({ kind: 'review' })}
              className={consoleButton({ variant: 'accent' })}
            >
              Submit my plan
            </button>
          ) : null}
        </div>
      )}

      {!submitted && !locked && hasContent && submissionGaps.length > 0 ? (
        <p role="status" className="text-sm text-corp-muted">
          Before you can submit, complete{' '}
          {submissionGaps
            .map(
              (g) =>
                `action ${g.index + 1} (${g.missing
                  .map((f) => planActionFieldLabels[f].label.toLowerCase())
                  .join(', ')})`,
            )
            .join('; ')}
          . Everything else can wait.
        </p>
      ) : null}
      {removing ? (
        <Dialog
          title="Remove this action?"
          description="Its details leave the plan when you next save. Progress, measures and evidence already recorded on it go with it."
          onClose={() => setRemoving(null)}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRemoving(null)}
                className={consoleButton({ variant: 'ghost' })}
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => remove(removing)}
                className={consoleButton({ variant: 'danger' })}
              >
                Remove action
              </button>
            </>
          }
        >
          <p className="text-sm text-corp-text">
            {(() => {
              const a = actions.find((x) => x.key === removing);
              return a?.title.trim() || a?.action.trim() || 'This action has nothing written yet.';
            })()}
          </p>
        </Dialog>
      ) : null}
      {dialog?.kind === 'review' ? (
        <Dialog
          title="Submit your plan?"
          description="Check your actions. After submitting you can still update the plan; progress is recorded through your follow-ups. The organisers keep this version as submitted."
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
                <p role="alert" className="text-xs text-brand-danger">
                  Record the result on at least one action first: a measure with an actual value, or
                  results on a progress record.
                </p>
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
      {dialog?.kind === 'results' ? (
        <ResultsDialog
          eventId={eventId}
          planId={plan.id}
          action={dialog.action}
          measure={dialog.measure}
          version={plan.version}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            onUpdated(result, 'Results saved.');
          }}
          onStale={(message) => {
            setDialog(null);
            setFailure({ message, stale: true });
          }}
        />
      ) : null}
      {dialog?.kind === 'results' ? (
        <ResultsDialog
          eventId={eventId}
          planId={plan.id}
          action={dialog.action}
          measure={dialog.measure}
          version={plan.version}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            onUpdated(result, 'Results saved.');
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
  dirty,
  onMeasures,
  onResults,
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
  /** Unsaved plan edits; the measure and evidence dialogs wait for a save. */
  dirty: boolean;
  onMeasures: (action: PlanActionView) => void;
  onResults: (action: PlanActionView, measure: MeasureView) => void;
  onEvidence: (action: PlanActionView) => void;
  timezone: string;
}) {
  const id = useId();
  const title = draft.title.trim() || draft.action.trim() || `Action ${index + 1}`;
  const required = (field: 'title' | 'priorityLearning' | 'action') =>
    draft[field].trim() === '' ? (
      <span className="ml-1 text-xs font-normal text-corp-muted">(required to submit)</span>
    ) : null;
  const dateProblem =
    draft.startOn && draft.targetOn && draft.targetOn < draft.startOn
      ? 'The target date cannot be earlier than the start date.'
      : null;
  const text = (field: keyof ActionDraft, rows = 2) => {
    const meta = planActionFieldLabels[field as keyof typeof planActionFieldLabels];
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-${field}`} className="text-sm font-semibold text-corp-ink">
          {meta.label}
          {field === 'priorityLearning' || field === 'action' ? required(field) : null}
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
          <p className="flex flex-wrap items-center gap-2 font-semibold text-corp-ink">
            Action {index + 1} of {count}
            {draft.isPriority ? <StatusPill tone="attention">First priority</StatusPill> : null}
          </p>
          <p className="text-sm text-corp-text">{draft.title.trim() || 'No title yet'}</p>
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

      <section aria-label="Action identification" className="space-y-4">
        <h5 className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Action identification
        </h5>
        <div className="space-y-1">
          <label htmlFor={`${id}-title`} className="text-sm font-semibold text-corp-ink">
            {planActionFieldLabels.title.label}
            {required('title')}
          </label>
          <p className="text-xs text-corp-muted">{planActionFieldLabels.title.prompt}</p>
          <input
            id={`${id}-title`}
            value={draft.title}
            maxLength={120}
            disabled={disabled}
            placeholder="e.g. Improve customer response time"
            onChange={(e) => onChange({ title: e.target.value })}
            className={input}
          />
        </div>
        {text('priorityLearning')}
        {text('action')}
        <div className="space-y-1">
          <label htmlFor={`${id}-priority`} className="text-sm font-semibold text-corp-ink">
            Is this your first priority action?
          </label>
          <p className="text-xs text-corp-muted">
            One action is the first priority; choosing another one moves it.
          </p>
          <NativeSelect
            id={`${id}-priority`}
            value={draft.isPriority ? 'first' : 'other'}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === 'first') onPriority();
              else onChange({ isPriority: false });
            }}
          >
            <option value="first">First priority</option>
            <option value="other">Other priority</option>
          </NativeSelect>
        </div>
      </section>

      <section
        aria-label="Workplace application"
        className="space-y-4 border-t border-corp-line pt-3"
      >
        <h5 className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Workplace application
        </h5>
        {text('opportunity')}
        {text('firstStep')}
        <div className="grid gap-4 sm:grid-cols-2">
          {date('startOn')}
          {date('targetOn')}
        </div>
        {dateProblem ? (
          <p role="alert" className="text-xs text-brand-danger">
            {dateProblem}
          </p>
        ) : null}
        {text('stakeholders')}
        {text('support')}
        {text('barriers')}
        {text('expectedResult')}
      </section>

      {saved ? (
        <div className="space-y-2 border-t border-corp-line pt-3">
          <p className="text-sm font-semibold text-corp-ink">Progress from your follow-ups</p>
          <p className="text-xs text-corp-muted">
            Each 30, 60, 90-day and longer-term follow-up asks where this action stands. What you
            answer there is recorded here; nothing is recorded from this page.
          </p>
          {saved.progress.length > 0 ? (
            <ul aria-label="Progress from follow-ups" className="space-y-2 text-sm text-corp-text">
              {saved.progress.map((p) => (
                <li key={p.id} className="border-l-2 border-corp-line pl-3">
                  <p className="font-semibold text-corp-ink">
                    {p.waveLabel || 'Recorded on the plan page'}
                    <span className="ml-2 font-normal text-corp-muted">
                      {formatInstant(p.recordedAt, timezone)}
                    </span>
                  </p>
                  <p className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={appliedStatuses.includes(p.status) ? 'positive' : 'neutral'}>
                      {actionProgressLabels[p.status]}
                    </StatusPill>
                    {p.occurredOn ? (
                      <span className="text-xs text-corp-muted">
                        on {formatDateShort(p.occurredOn)}
                      </span>
                    ) : null}
                  </p>
                  {p.note ? <p>{p.note}</p> : null}
                  {p.results ? <p>Results: {p.results}</p> : null}
                  {p.challenges ? <p>Challenges: {p.challenges}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-corp-muted">
              No follow-up has recorded progress on this action yet.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-corp-muted">Save the plan to see progress on this action.</p>
      )}
      {saved ? (
        <ActionMeasures
          action={saved}
          disabled={disabled}
          dirty={dirty}
          onMeasures={() => onMeasures(saved)}
          onResults={(measure) => onResults(saved, measure)}
          onEvidence={() => onEvidence(saved)}
        />
      ) : null}
    </article>
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
            onOpenPlan={onSelectPlan}
          />
        </div>
      ) : (
        <p className="text-sm text-corp-muted">No plan yet.</p>
      )}
    </div>
  );
}
