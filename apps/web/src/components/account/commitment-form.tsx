'use client';

import {
  actionProgressLabels,
  commitmentStatuses,
  templateActions,
  type ChecklistTemplate,
  type CommitmentStatus,
  type MyTransferPlan,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { consoleButton } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

const input =
  'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base disabled:bg-corp-surface md:text-sm';
const textarea =
  'w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base disabled:bg-corp-surface md:text-sm';

/** The status a follow-up recorded, in the organisers' words where the form has them. */
export function commitmentStatusLabel(
  status: string,
  template: Pick<ChecklistTemplate, 'followUp'>,
): string {
  return (commitmentStatuses as readonly string[]).includes(status)
    ? template.followUp.statusLabels[status as CommitmentStatus]
    : (actionProgressLabels[status as keyof typeof actionProgressLabels] ?? status);
}

/**
 * The checklist-and-commitment form (2026-11-20), in the organisers' own wording: name a
 * training, tick the actions you plan to take, commit to one of them with a date and what will
 * show it, and ask for a reminder if you want one. Saving submits; a saved form can be changed.
 * The server refuses a commitment to an unticked action and a form with nothing ticked.
 */
export function CommitmentForm({
  eventId,
  timezone,
  data,
  template,
  onSaved,
  onReload,
}: {
  eventId: string;
  timezone: string;
  data: MyTransferPlan;
  template: ChecklistTemplate;
  onSaved: (data: MyTransferPlan, message: string) => void;
  onReload: () => void;
}) {
  const { plan } = data;
  const action = plan.actions[0] ?? null;
  const id = useId();
  const [trainingName, setTrainingName] = useState(plan.trainingName ?? '');
  const [ticked, setTicked] = useState<string[]>(plan.checklist?.ticked ?? []);
  const [commitmentKey, setCommitmentKey] = useState(plan.checklist?.commitmentKey ?? '');
  const [what, setWhat] = useState(action?.action ?? '');
  const [byOn, setByOn] = useState(action?.targetOn ?? '');
  const [evidence, setEvidence] = useState(action?.evidence ?? '');
  const [reminder, setReminder] = useState<'yes' | 'no'>(
    action?.reminder.frequency === 'once' ? 'yes' : 'no',
  );
  const [reminderOn, setReminderOn] = useState(
    action?.reminder.frequency === 'once' ? (action.reminder.startOn ?? '') : '',
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; stale?: boolean } | null>(null);
  const actions = templateActions(template);
  const tickedActions = actions.filter((a) => ticked.includes(a.key));
  const locked = plan.status === 'completed';
  const updates = action ? [...action.progress].reverse() : [];

  function toggle(key: string, on: boolean) {
    setProblem(null);
    setTicked((list) => (on ? [...list, key] : list.filter((k) => k !== key)));
    if (!on && commitmentKey === key) setCommitmentKey('');
  }

  async function save() {
    const missing = !trainingName.trim()
      ? `Answer “${template.trainingNameLabel}”.`
      : ticked.length === 0
        ? 'Tick at least one action you plan to take.'
        : !commitmentKey || !ticked.includes(commitmentKey)
          ? 'Choose one of the actions you ticked to commit to.'
          : !what.trim()
            ? `Answer “${template.commitment.whatLabel}”.`
            : !byOn
              ? `Answer “${template.commitment.whenLabel}”.`
              : !evidence.trim()
                ? `Answer “${template.commitment.evidenceLabel}”.`
                : reminder === 'yes' && !reminderOn
                  ? 'Choose the day of your reminder.'
                  : null;
    if (missing) {
      setProblem({ message: missing });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const saved = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${plan.id}/commitment`,
        {
          method: 'PUT',
          body: JSON.stringify({
            version: plan.version,
            trainingName: trainingName.trim(),
            ticked,
            commitmentKey,
            what: what.trim(),
            byOn,
            evidence: evidence.trim(),
            reminderOn: reminder === 'yes' ? reminderOn : null,
          }),
        },
      );
      onSaved(saved, template.savedMessage);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_plan') {
        setProblem({ message: e.message, stale: true });
      } else {
        setProblem(describeError(e, 'Your commitment could not be saved.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || locked;
  return (
    <form
      aria-label={template.title}
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {plan.submittedAt ? (
        <p role="status" className="text-xs text-corp-green-text">
          Saved {formatInstant(plan.submittedAt, timezone)}. You can change it below.
        </p>
      ) : null}
      <p className="border-l-4 border-corp-accent bg-corp-accent-soft/40 p-3 text-sm font-medium text-corp-ink">
        {template.intro}
      </p>

      <div className="space-y-1">
        <label htmlFor={`${id}-training`} className="text-sm font-semibold text-corp-ink">
          {template.trainingNameLabel}
          <span className="ml-1 text-xs font-normal text-corp-muted">(required)</span>
        </label>
        <input
          id={`${id}-training`}
          value={trainingName}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => {
            setTrainingName(e.target.value);
            setProblem(null);
          }}
          className={input}
        />
      </div>

      <section aria-labelledby={`${id}-tick`} className="space-y-4">
        <div>
          <h3 id={`${id}-tick`} className="font-corporate text-base font-semibold text-corp-ink">
            {template.tickHeading}
          </h3>
          <p className="text-sm text-corp-text">{template.tickHint}</p>
        </div>
        {template.groups.map((g) => (
          <fieldset key={g.key} className="space-y-2">
            <legend className="text-sm font-semibold text-corp-ink">{g.title}</legend>
            {g.actions.map((a) => (
              <label key={a.key} className="flex min-h-tap items-start gap-2 text-sm text-corp-ink">
                <input
                  type="checkbox"
                  checked={ticked.includes(a.key)}
                  disabled={disabled}
                  onChange={(e) => toggle(a.key, e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-corp-green"
                />
                <span>{a.text}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      <section
        aria-labelledby={`${id}-commit`}
        className="space-y-3 border-t border-corp-line pt-4"
      >
        <div>
          <h3 id={`${id}-commit`} className="font-corporate text-base font-semibold text-corp-ink">
            {template.commitment.heading}
          </h3>
          <p className="text-sm text-corp-text">{template.commitment.hint}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-key`} className="text-sm font-semibold text-corp-ink">
            {template.commitment.chooseLabel}
          </label>
          <NativeSelect
            id={`${id}-key`}
            value={commitmentKey}
            disabled={disabled || tickedActions.length === 0}
            onChange={(e) => {
              setCommitmentKey(e.target.value);
              setProblem(null);
            }}
            className="rounded-none border-corp-line"
          >
            <option value="">
              {tickedActions.length === 0 ? 'Tick an action above first' : 'Choose an action'}
            </option>
            {tickedActions.map((a) => (
              <option key={a.key} value={a.key}>
                {a.text}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-what`} className="text-sm font-semibold text-corp-ink">
            {template.commitment.whatLabel}
          </label>
          <textarea
            id={`${id}-what`}
            rows={2}
            value={what}
            maxLength={2000}
            disabled={disabled}
            onChange={(e) => setWhat(e.target.value)}
            className={textarea}
          />
        </div>
        <div className="space-y-1 sm:max-w-xs">
          <label htmlFor={`${id}-when`} className="text-sm font-semibold text-corp-ink">
            {template.commitment.whenLabel}
          </label>
          <input
            id={`${id}-when`}
            type="date"
            value={byOn}
            disabled={disabled}
            onChange={(e) => setByOn(e.target.value)}
            className={input}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-evidence`} className="text-sm font-semibold text-corp-ink">
            {template.commitment.evidenceLabel}
          </label>
          <textarea
            id={`${id}-evidence`}
            rows={2}
            value={evidence}
            maxLength={2000}
            disabled={disabled}
            onChange={(e) => setEvidence(e.target.value)}
            className={textarea}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-corp-ink">
            {template.commitment.reminderPrompt}
          </legend>
          <div className="flex flex-wrap gap-4">
            {(['yes', 'no'] as const).map((v) => (
              <label key={v} className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
                <input
                  type="radio"
                  name={`${id}-reminder`}
                  value={v}
                  checked={reminder === v}
                  disabled={disabled}
                  onChange={() => setReminder(v)}
                  className="size-5 shrink-0 accent-corp-green"
                />
                {v === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          {reminder === 'yes' ? (
            <div className="space-y-1 sm:max-w-xs">
              <label htmlFor={`${id}-remind`} className="text-sm font-semibold text-corp-ink">
                {template.commitment.reminderDateLabel}
              </label>
              <input
                id={`${id}-remind`}
                type="date"
                value={reminderOn}
                disabled={disabled}
                onChange={(e) => setReminderOn(e.target.value)}
                className={input}
              />
              <p className="text-xs text-corp-muted">
                One email that day, at 09:00 ({timezone}), if your commitment is still open. It
                shows your commitment and due date, with a link to update your progress.
              </p>
            </div>
          ) : null}
        </fieldset>
      </section>

      {problem ? (
        <p
          role="alert"
          className="border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm font-semibold text-brand-danger"
        >
          {problem.message}
          {problem.stale ? (
            <button type="button" onClick={onReload} className="ml-2 underline underline-offset-2">
              Reload
            </button>
          ) : null}
        </p>
      ) : null}
      {!locked ? (
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={consoleButton({ variant: 'accent' })}>
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {template.buttonLabel}
          </button>
        </div>
      ) : null}

      {updates.length > 0 ? (
        <section aria-label="Your updates" className="space-y-2 border-t border-corp-line pt-4">
          <h3 className="font-corporate text-base font-semibold text-corp-ink">Your updates</h3>
          <ul className="space-y-2">
            {updates.map((u) => (
              <li
                key={`${u.waveLabel}:${u.recordedAt}`}
                className="border-l-2 border-corp-line pl-3 text-sm"
              >
                <p className="font-semibold text-corp-ink">
                  {u.waveLabel || 'Follow-up'}: {commitmentStatusLabel(u.status, template)}
                  <span className="ml-2 text-xs font-normal text-corp-muted">
                    {formatDateShort(u.recordedAt.slice(0, 10))}
                  </span>
                </p>
                {u.note ? <p className="text-corp-text">{u.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </form>
  );
}
