'use client';

import {
  actionProgressLabels,
  appliedStatuses,
  actionSubmissionGaps,
  completionStatuses,
  measurePlaceholders,
  measureStatuses,
  measureStatusLabels,
  planActionFieldLabels,
  dateIn,
  impactCheckAnswerLabels,
  impactCheckAnswersFor,
  NO_REMINDERS,
  planCompletionGaps,
  planOutcomeDescriptions,
  planOutcomeLabels,
  planTitleOf,
  reminderFrequencies,
  reminderFrequencyLabels,
  transferPlanStatusLabels,
  weekdays,
  type ImpactCheckAnswer,
  type MyAssessment,
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

export type MyTransferPlansState =
  | { kind: 'loading' }
  | { kind: 'ready'; plans: TransferPlanSummary[] }
  | { kind: 'error'; message: string; requestId?: string };

type PlanState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: MyTransferPlan }
  | { kind: 'error'; message: string; requestId?: string; gone?: boolean };

/** The delegate's plans for one event, loaded once by the event page and shared by the tabs. */
export function useMyTransferPlans(eventId: string, enabled = true) {
  const [state, setState] = useState<MyTransferPlansState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Transfer Planning hidden by the organisers (2026-11-08): nothing is asked for.
    if (!enabled) return undefined;
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
  }, [eventId, attempt, enabled]);
  // Hidden reads as an empty, settled list; nothing was asked for.
  const hidden: MyTransferPlansState = { kind: 'ready', plans: [] };
  return {
    state: enabled ? state : hidden,
    retry: () => setAttempt((n) => n + 1),
    /** After a change the list is read again so every tab's label and status is current. */
    refresh: () =>
      !enabled
        ? Promise.resolve()
        : apiFetch<MyTransferPlans>(`/me/events/${eventId}/transfer-plans`).then(
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
  /** The plan shown no longer exists: the page opens the current one. */
  onOpenPlan: (planId: string) => void;
}

/**
 * The delegate's Individual Transfer Plan, as its own tab (task of 2026-11-07). Backlog E9, E10,
 * E12-8 to 12-11: the plan is saved as a draft, submitted when the delegate is ready, kept open
 * for changes, and marked completed once every action is applied with evidence. Where each
 * action stands is recorded through the post-conference follow-ups; each action carries its own
 * reminder (decision 2026-11-11). A delegate has one plan per event: there is no "start another
 * plan" (decision 2026-11-11). Every save carries the version last seen so two tabs cannot
 * overwrite each other.
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
              ? 'Thank you. Your plan is completed: every action applied, with evidence, and the organisers have been told. Its reminders have stopped. Next comes impact assessment: in about three months we will ask whether the actions have made a measurable difference, and later whether that has lasted.'
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
    measureStatus: null,
    reminder: { ...NO_REMINDERS },
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
    measureStatus: a.measureStatus,
    reminder: {
      frequency: a.reminder.frequency,
      startOn: a.reminder.startOn,
      endOn: a.reminder.endOn,
      time: a.reminder.time || NO_REMINDERS.time,
      days: a.reminder.days,
    },
  };
}

function payloadOf(actions: ActionDraft[]): PlanActionFields[] {
  return actions.map(({ key, startOn, targetOn, reviewOn, reminder, ...rest }) => {
    void key;
    return {
      ...rest,
      startOn: startOn || null,
      targetOn: targetOn || null,
      reviewOn: reviewOn || null,
      reminder: {
        ...reminder,
        startOn: reminder.startOn || null,
        endOn: reminder.endOn || null,
        days: reminder.frequency === 'twice_weekly' ? reminder.days : [],
      },
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
  // The first plan is created without a name; it gets one here like any other (2026-11-08).
  const [title, setTitle] = useState(plan.title);
  const [actions, setActions] = useState<ActionDraft[]>(() => plan.actions.map(draftOf));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale?: boolean } | null>(null);
  const [dialog, setDialog] = useState<
    | null
    | { kind: 'review' }
    | { kind: 'complete' }
    | { kind: 'measures'; action: PlanActionView; version: number; saved?: MyTransferPlan }
    | { kind: 'evidence'; action: PlanActionView; version: number; saved?: MyTransferPlan }
  >(null);
  const id = useId();
  const submitted = plan.status === 'submitted';
  /** Completed plans are finished: read-only, reminders stopped (2026-11-06). */
  const locked = plan.status === 'completed';
  const hasContent = actions.some((a) => a.action.trim() !== '');
  // Submission waits for a title, the priority learning and the action on every card
  // (spec 2026-11-08); drafts save with anything missing.
  const submissionGaps = actionSubmissionGaps(actions);
  const [removing, setRemoving] = useState<string | null>(null);
  /** What still stands between a submitted plan and completion, from the saved plan. */
  const gaps = submitted ? planCompletionGaps(plan.actions) : [];
  const [improvement, setImprovement] = useState<'seen' | 'not_yet'>('not_yet');
  const [outcomeNote, setOutcomeNote] = useState('');
  /** The impact check waiting for an answer, if any, as of today in the event's timezone. */
  const today = dateIn(new Date(), timezone);
  const dueCheck = locked
    ? (plan.impactChecks.find((c) => !c.answeredAt && c.dueOn <= today) ?? null)
    : null;
  const nextCheck = locked ? (plan.impactChecks.find((c) => !c.answeredAt) ?? null) : null;

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
            title: title.trim(),
            actions: payloadOf(actions),
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

  const savedMessage = submitted ? 'Your changes are saved.' : 'Draft saved.';

  async function saveDraft() {
    const saved = await save();
    if (saved) onUpdated(saved, savedMessage);
  }

  /**
   * Opens the measures or evidence dialog of one action. Unsaved edits, or an action not stored
   * yet, are saved first (decision 2026-11-11: no need to save the plan by hand before adding a
   * measure), so the dialog opens on the action as it stands on screen. The saved plan is shown
   * once the dialog closes, because the editor remounts on every new version.
   */
  async function openDialog(kind: 'measures' | 'evidence', key: string) {
    const index = actions.findIndex((a) => a.key === key);
    const draft = actions[index];
    const stored = draft?.id ? (plan.actions.find((p) => p.id === draft.id) ?? null) : null;
    if (stored && !dirty) {
      setDialog({ kind, action: stored, version: plan.version });
      return;
    }
    const saved = await save();
    if (!saved) return;
    // The server keeps the actions in the order they were sent.
    const action = saved.plan.actions[index];
    if (!action) {
      onUpdated(saved, savedMessage);
      return;
    }
    setDialog({ kind, action, version: saved.plan.version, saved });
  }

  function closeDialog() {
    const current = dialog;
    setDialog(null);
    if (current && 'saved' in current && current.saved) onUpdated(current.saved, savedMessage);
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
              : 'Save as often as you like, then submit when your plan is ready. You can submit at any time, and keep updating the plan afterwards.'}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-plan-title`} className="text-sm font-semibold text-corp-ink">
          Plan name
        </label>
        <p className="text-xs text-corp-muted">
          A short name for this plan. It names its tab and appears in your reminders.
        </p>
        <input
          id={`${id}-plan-title`}
          value={title}
          maxLength={120}
          readOnly={locked}
          placeholder={`Plan ${plan.sequence}`}
          onChange={(e) => {
            setDirty(true);
            setTitle(e.target.value);
          }}
          className={input}
        />
      </div>

      {data.sessions.length > 0 ? (
        <section aria-label="Transfer Planning sessions" className="text-sm text-corp-text">
          <p className="font-semibold text-corp-ink">Transfer Planning sessions</p>
          <ul className="mt-1 space-y-0.5">
            {data.sessions.map((s) => (
              <li key={s.id}>
                {formatDateShort(s.date)}, {s.startTime}–{s.endTime}: {s.title}
                {s.isFinal ? ' (final session)' : ''}
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
            onMeasures={() => void openDialog('measures', a.key)}
            onEvidence={() => void openDialog('evidence', a.key)}
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
                {a.reminder.frequency !== 'none' ? (
                  <p className="text-corp-muted">
                    Reminder: {reminderFrequencyLabels[a.reminder.frequency].toLowerCase()}
                    {a.reminder.startOn ? ` from ${formatDateShort(a.reminder.startOn)}` : ''}
                    {a.reminder.endOn ? ` until ${formatDateShort(a.reminder.endOn)}` : ''}.
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
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
                disabled={busy}
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
          version={dialog.version}
          onClose={closeDialog}
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
          version={dialog.version}
          onClose={closeDialog}
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
  /** Opens the measures dialog; the plan is saved first when needed. */
  onMeasures: () => void;
  /** Opens the evidence dialog; the plan is saved first when needed. */
  onEvidence: () => void;
  timezone: string;
}) {
  const id = useId();
  const reminder = draft.reminder;
  /** An applied or completed action is no longer reminded (decision 2026-11-11). */
  const finished = saved ? completionStatuses.includes(saved.progressStatus) : false;
  const setReminder = (patch: Partial<ReminderPreference>) =>
    onChange({ reminder: { ...reminder, ...patch } });
  const toggleDay = (day: number) =>
    setReminder({
      days: reminder.days.includes(day)
        ? reminder.days.filter((d) => d !== day)
        : [...reminder.days, day].sort((a, b) => a - b),
    });
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
        <div className="space-y-1">
          <label htmlFor={`${id}-measureStatus`} className="text-sm font-semibold text-corp-ink">
            {planActionFieldLabels.measureStatus.label}
          </label>
          <p className="text-xs text-corp-muted">{planActionFieldLabels.measureStatus.prompt}</p>
          <NativeSelect
            id={`${id}-measureStatus`}
            value={draft.measureStatus ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                measureStatus: (e.target.value || null) as ActionDraft['measureStatus'],
              })
            }
          >
            <option value="">Choose an answer</option>
            {measureStatuses.map((s) => (
              <option key={s} value={s}>
                {measureStatusLabels[s]}
              </option>
            ))}
          </NativeSelect>
          {draft.measureStatus === 'identified' ? (
            <p className="text-xs text-corp-muted">
              Add the measure under “Business measures and evidence” below.
            </p>
          ) : null}
        </div>
      </section>

      <section aria-label="Reminder" className="space-y-3 border-t border-corp-line pt-3">
        <h5 className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Reminder
        </h5>
        {finished && saved ? (
          <p className="text-xs text-corp-muted">
            This action is {actionProgressLabels[saved.progressStatus].toLowerCase()}, so it is no
            longer reminded.
          </p>
        ) : (
          <>
            <p className="text-xs text-corp-muted">
              An email that reminds you of this action, and nothing more: it asks nothing of you and
              has no form to fill. Whenever you wish, you can come back here to update where the
              action stands, its measures and your evidence.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${id}-frequency`} className="text-sm font-semibold text-corp-ink">
                  How often
                </label>
                <NativeSelect
                  id={`${id}-frequency`}
                  value={reminder.frequency}
                  disabled={disabled}
                  onChange={(e) => setReminder({ frequency: e.target.value as ReminderFrequency })}
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
                  disabled={disabled || reminder.frequency === 'none'}
                  onChange={(e) => setReminder({ time: e.target.value || NO_REMINDERS.time })}
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
                            disabled={disabled || (!on && reminder.days.length >= 2)}
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
                  disabled={disabled || reminder.frequency === 'none'}
                  onChange={(e) => setReminder({ startOn: e.target.value || null })}
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
                  disabled={disabled || reminder.frequency === 'none'}
                  onChange={(e) => setReminder({ endOn: e.target.value || null })}
                  className={input}
                />
                <p className="text-xs text-corp-muted">
                  Leave empty to keep going until the action is applied or the plan is completed.
                </p>
              </div>
            </div>
            {saved?.reminder.nextReminderAt ? (
              <p className="text-xs text-corp-muted">
                Next reminder {formatInstant(saved.reminder.nextReminderAt, timezone)}.
              </p>
            ) : null}
          </>
        )}
      </section>

      {saved ? (
        <div className="space-y-2 border-t border-corp-line pt-3">
          <p className="text-sm font-semibold text-corp-ink">Progress</p>
          <p className="text-xs text-corp-muted">
            Where this action stands now:{' '}
            <span className="font-semibold text-corp-ink">
              {actionProgressLabels[saved.progressStatus]}
            </span>
            . Each post-conference follow-up asks for it; every answer is kept here, with where it
            came from.
          </p>
          {saved.progress.length > 0 ? (
            <ul aria-label="Progress history" className="space-y-2 text-sm text-corp-text">
              {[...saved.progress].reverse().map((p) => (
                <li key={p.id} className="border-l-2 border-corp-line pl-3">
                  <p className="font-semibold text-corp-ink">
                    {p.waveLabel || 'Plan page'}
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
              No status recorded on this action yet. The first follow-up will ask for it.
            </p>
          )}
        </div>
      ) : null}
      {saved ? (
        <ActionMeasures
          action={saved}
          disabled={disabled}
          onMeasures={onMeasures}
          onEvidence={onEvidence}
        />
      ) : (
        <section
          aria-label="Business measures and evidence"
          className="space-y-2 border-t border-corp-line pt-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-corp-ink">Business measures and evidence</p>
            <div className="flex flex-wrap gap-1">
              {draft.measureStatus === 'identified' ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onMeasures}
                  className={consoleButton({ variant: 'secondary', size: 'sm' })}
                >
                  Add a measure
                </button>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                onClick={onEvidence}
                className={consoleButton({ variant: 'secondary', size: 'sm' })}
              >
                Add evidence
              </button>
            </div>
          </div>
          <p className="text-xs text-corp-muted">
            {draft.measureStatus === 'identified'
              ? 'Your plan is saved first, then the measure or evidence is added to this action.'
              : 'Answer “Can you identify a business measure for this action?” above; measures can be added once the answer is yes. Evidence of what you did can be added at any time: your plan is saved first.'}
          </p>
        </section>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ the follow-ups

/**
 * The post-conference follow-ups, listed on the plan tab (decision 2026-11-09): each one asks
 * where every action stands and what was applied, in its own window after the event. The
 * delegate's reminders point at the one that is open; here they see all of them with where each
 * stands, and open one in its own tab.
 */
function FollowUpsBlock({
  followUps,
  timezone,
  onOpen,
}: {
  followUps: readonly MyAssessment[];
  timezone: string;
  onOpen?: (followUp: MyAssessment) => void;
}) {
  const id = useId();
  const ordered = [...followUps].sort((a, b) => a.wave - b.wave);
  return (
    <section
      aria-labelledby={`${id}-follow-ups`}
      className="space-y-2 border border-corp-line bg-white p-4"
    >
      <h3 id={`${id}-follow-ups`} className="font-semibold text-corp-ink">
        Post-conference follow-ups
      </h3>
      <p className="text-sm text-corp-muted">
        After the conference, each follow-up asks where every action of your plans stands and what
        you have applied. What you answer is recorded under each action below. The organisers send
        you each follow-up when it is time; it appears here once they have.
      </p>
      <ul className="divide-y divide-corp-line">
        {ordered.map((f) => {
          const submittedAt = f.response?.submittedAt ?? null;
          const state = submittedAt
            ? `Submitted ${formatInstant(submittedAt, timezone)}`
            : f.status === 'upcoming'
              ? f.opensAt
                ? `Opens ${formatInstant(f.opensAt, timezone)}`
                : 'Opens later'
              : f.status === 'closed'
                ? 'Closed'
                : f.closesAt
                  ? `Open until ${formatInstant(f.closesAt, timezone)}`
                  : 'Open now';
          return (
            <li
              key={`${f.stage}:${f.wave}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <span className="font-semibold text-corp-ink">
                  {f.waveLabel || 'Post-conference follow-up'}
                </span>
                <span className="block text-xs text-corp-muted">{state}</span>
              </span>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(f)}
                  className={consoleButton({
                    variant: !submittedAt && f.status === 'open' ? 'accent' : 'secondary',
                    size: 'sm',
                  })}
                >
                  {submittedAt ? 'Read your answers' : f.status === 'open' ? 'Answer now' : 'View'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
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
  followUps = [],
  onOpenFollowUp,
}: {
  eventId: string;
  timezone: string;
  plans: MyTransferPlansState;
  selectedPlanId: string | null;
  onSelectPlan: (planId: string) => void;
  onPlansChanged: () => void;
  onRetry: () => void;
  /** The post-conference follow-ups of this event, in wave order (decision 2026-11-09). */
  followUps?: readonly MyAssessment[];
  onOpenFollowUp?: (followUp: MyAssessment) => void;
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
      {followUps.length > 0 ? (
        <FollowUpsBlock followUps={followUps} timezone={timezone} onOpen={onOpenFollowUp} />
      ) : null}
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
