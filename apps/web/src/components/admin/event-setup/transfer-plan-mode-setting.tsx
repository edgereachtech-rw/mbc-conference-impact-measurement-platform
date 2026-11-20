'use client';

import {
  checklistTemplateSchema,
  DEFAULT_CHECKLIST_TEMPLATE,
  transferPlanModeLabels,
  transferPlanModes,
  transferPlanPositionLabels,
  transferPlanPositions,
  type ChecklistTemplate,
  type EventDetail,
  type TransferPlanMode,
  type TransferPlanPosition,
} from '@mbc/shared';
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { consoleButton } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

const input =
  'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm disabled:opacity-60';
const textarea =
  'w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm disabled:opacity-60';

let keys = 0;
const newKey = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(keys++).toString(36)}`;

/**
 * How delegates plan their transfer on this event (2026-11-20): the full Transfer Plan, or the
 * checklist-and-commitment form a training programme asks of line managers, with its own
 * wording as a template the organisers edit here: the groups of actions to tick, the three
 * commitment questions, the reminder question, the button, the confirmation and the follow-up's
 * three answers. Also where Transfer Planning sits in the delegate's journey.
 */
export function TransferPlanModeSetting({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<TransferPlanMode>(event.transferPlanMode ?? 'full');
  const [position, setPosition] = useState<TransferPlanPosition>(
    event.transferPlanPosition ?? 'last',
  );
  const [template, setTemplate] = useState<ChecklistTemplate>(
    event.transferPlanTemplate ?? DEFAULT_CHECKLIST_TEMPLATE,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const readOnly = event.status === 'archived';
  const disabled = busy || readOnly;

  function patch(part: Partial<ChecklistTemplate>) {
    setSaved(null);
    setProblem(null);
    setTemplate((t) => ({ ...t, ...part }));
  }
  function patchCommitment(part: Partial<ChecklistTemplate['commitment']>) {
    patch({ commitment: { ...template.commitment, ...part } });
  }
  function patchFollowUp(part: Partial<ChecklistTemplate['followUp']>) {
    patch({ followUp: { ...template.followUp, ...part } });
  }
  function patchGroup(key: string, part: Partial<ChecklistTemplate['groups'][number]>) {
    patch({ groups: template.groups.map((g) => (g.key === key ? { ...g, ...part } : g)) });
  }

  async function save(reset = false) {
    const parsed = reset ? null : checklistTemplateSchema.safeParse(template);
    if (parsed && !parsed.success) {
      const issue = parsed.error.issues[0];
      setProblem(
        `Complete every field of the checklist wording (${issue?.path.join('.') ?? 'template'}).`,
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          transferPlanMode: mode,
          transferPlanPosition: position,
          transferPlanTemplate: mode === 'commitment' && parsed ? parsed.data : null,
        }),
      });
      if (reset) setTemplate(DEFAULT_CHECKLIST_TEMPLATE);
      onSaved(result.event);
      setSaved(
        mode === 'commitment'
          ? 'Delegates get the checklist and commitment, in this wording.'
          : 'Delegates get the full Transfer Plan.',
      );
    } catch (err) {
      setProblem(describeError(err, 'The setting could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { rows?: number; max?: number } = {},
  ) => {
    const fieldId = `${id}-${label.replace(/\W+/g, '-').toLowerCase()}`;
    return (
      <div className="space-y-1">
        <label htmlFor={fieldId} className="text-sm font-semibold text-corp-ink">
          {label}
        </label>
        {options.rows ? (
          <textarea
            id={fieldId}
            rows={options.rows}
            value={value}
            maxLength={options.max ?? 1000}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={textarea}
          />
        ) : (
          <input
            id={fieldId}
            value={value}
            maxLength={options.max ?? 200}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={input}
          />
        )}
      </div>
    );
  };

  return (
    <section
      aria-label="Transfer Planning form"
      className="space-y-4 border border-corp-line bg-white p-4"
    >
      <div>
        <h3 className="font-semibold text-corp-ink">What delegates plan with</h3>
        <p className="text-sm text-corp-text">
          The full Transfer Plan asks for any number of actions with their details, measures and
          evidence. The checklist and commitment asks a line manager to name a training, tick the
          actions they plan to take and commit to one of them, with a date and what will show it.
          Its wording is a template you can change for this event: another programme can have other
          groups, actions and questions. Follow-ups, reminders and reports work the same either way.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-mode`} className="text-sm font-semibold text-corp-ink">
            Form
          </label>
          <NativeSelect
            id={`${id}-mode`}
            value={mode}
            disabled={disabled}
            onChange={(e) => {
              setMode(e.target.value as TransferPlanMode);
              setSaved(null);
              setProblem(null);
            }}
            className="rounded-none border-corp-line"
          >
            {transferPlanModes.map((m) => (
              <option key={m} value={m}>
                {transferPlanModeLabels[m]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-position`} className="text-sm font-semibold text-corp-ink">
            Place in the delegate’s journey
          </label>
          <NativeSelect
            id={`${id}-position`}
            value={position}
            disabled={disabled}
            onChange={(e) => {
              setPosition(e.target.value as TransferPlanPosition);
              setSaved(null);
              setProblem(null);
            }}
            className="rounded-none border-corp-line"
          >
            {transferPlanPositions.map((v) => (
              <option key={v} value={v}>
                {transferPlanPositionLabels[v]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-corp-muted">
            “Before the closing assessments” puts it ahead of the end-of-event evaluation and the
            follow-ups on the dashboard and the event page.
          </p>
        </div>
      </div>

      {mode === 'commitment' ? (
        <div className="space-y-5 border-t border-corp-line pt-4">
          <h4 className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
            Checklist wording
          </h4>
          {field('Form name', template.title, (v) => patch({ title: v }), { max: 120 })}
          {field('Instruction above the form', template.intro, (v) => patch({ intro: v }), {
            rows: 3,
          })}
          {field('Training name question', template.trainingNameLabel, (v) =>
            patch({ trainingNameLabel: v }),
          )}
          {field('Tick-box heading', template.tickHeading, (v) => patch({ tickHeading: v }))}
          {field('Tick-box hint', template.tickHint, (v) => patch({ tickHint: v }), { max: 500 })}

          <div className="space-y-4">
            {template.groups.map((g, gi) => (
              <fieldset
                key={g.key}
                aria-label={`Group ${gi + 1}`}
                className="space-y-2 border border-corp-line bg-corp-surface p-3"
              >
                <div className="flex items-end gap-2">
                  <div className="grow">
                    {field(`Group ${gi + 1} heading`, g.title, (v) =>
                      patchGroup(g.key, { title: v }),
                    )}
                  </div>
                  {!readOnly ? (
                    <button
                      type="button"
                      disabled={disabled || template.groups.length === 1}
                      aria-label={`Remove group ${gi + 1}`}
                      onClick={() =>
                        patch({ groups: template.groups.filter((x) => x.key !== g.key) })
                      }
                      className={consoleButton({ variant: 'ghost', size: 'sm' })}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <ol className="space-y-2">
                  {g.actions.map((a, ai) => (
                    <li key={a.key} className="flex items-start gap-2">
                      <label className="sr-only" htmlFor={`${id}-${a.key}`}>
                        Group {gi + 1} action {ai + 1}
                      </label>
                      <textarea
                        id={`${id}-${a.key}`}
                        rows={2}
                        value={a.text}
                        maxLength={500}
                        disabled={disabled}
                        onChange={(e) =>
                          patchGroup(g.key, {
                            actions: g.actions.map((x) =>
                              x.key === a.key ? { ...x, text: e.target.value } : x,
                            ),
                          })
                        }
                        className={textarea}
                      />
                      {!readOnly ? (
                        <button
                          type="button"
                          disabled={disabled || g.actions.length === 1}
                          aria-label={`Remove group ${gi + 1} action ${ai + 1}`}
                          onClick={() =>
                            patchGroup(g.key, { actions: g.actions.filter((x) => x.key !== a.key) })
                          }
                          className={consoleButton({ variant: 'ghost', size: 'sm' })}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {!readOnly ? (
                  <button
                    type="button"
                    disabled={disabled || g.actions.length >= 20}
                    onClick={() =>
                      patchGroup(g.key, {
                        actions: [...g.actions, { key: newKey('a'), text: '' }],
                      })
                    }
                    className={consoleButton({ variant: 'secondary', size: 'sm' })}
                  >
                    <PlusIcon aria-hidden="true" /> Add an action
                  </button>
                ) : null}
              </fieldset>
            ))}
            {!readOnly ? (
              <button
                type="button"
                disabled={disabled || template.groups.length >= 10}
                onClick={() =>
                  patch({
                    groups: [
                      ...template.groups,
                      { key: newKey('g'), title: '', actions: [{ key: newKey('a'), text: '' }] },
                    ],
                  })
                }
                className={consoleButton({ variant: 'secondary', size: 'sm' })}
              >
                <PlusIcon aria-hidden="true" /> Add a group
              </button>
            ) : null}
          </div>

          <h4 className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
            Commitment wording
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('Heading', template.commitment.heading, (v) => patchCommitment({ heading: v }))}
            {field('Hint', template.commitment.hint, (v) => patchCommitment({ hint: v }), {
              max: 500,
            })}
            {field('Choose-an-action label', template.commitment.chooseLabel, (v) =>
              patchCommitment({ chooseLabel: v }),
            )}
            {field('Question 1 (what)', template.commitment.whatLabel, (v) =>
              patchCommitment({ whatLabel: v }),
            )}
            {field('Question 2 (by when)', template.commitment.whenLabel, (v) =>
              patchCommitment({ whenLabel: v }),
            )}
            {field('Question 3 (what will show it)', template.commitment.evidenceLabel, (v) =>
              patchCommitment({ evidenceLabel: v }),
            )}
            {field('Reminder question', template.commitment.reminderPrompt, (v) =>
              patchCommitment({ reminderPrompt: v }),
            )}
            {field('Reminder date label', template.commitment.reminderDateLabel, (v) =>
              patchCommitment({ reminderDateLabel: v }),
            )}
            {field('Button', template.buttonLabel, (v) => patch({ buttonLabel: v }), { max: 60 })}
            {field(
              'Confirmation after saving',
              template.savedMessage,
              (v) => patch({ savedMessage: v }),
              { max: 500 },
            )}
          </div>

          <h4 className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
            Follow-up wording
          </h4>
          {field('Introduction', template.followUp.intro, (v) => patchFollowUp({ intro: v }), {
            rows: 2,
            max: 500,
          })}
          <div className="grid gap-3 sm:grid-cols-2">
            {field('Status question', template.followUp.statusPrompt, (v) =>
              patchFollowUp({ statusPrompt: v }),
            )}
            {field(
              'Answer: done',
              template.followUp.statusLabels.applied,
              (v) =>
                patchFollowUp({ statusLabels: { ...template.followUp.statusLabels, applied: v } }),
              { max: 100 },
            )}
            {field(
              'Answer: started',
              template.followUp.statusLabels.started,
              (v) =>
                patchFollowUp({ statusLabels: { ...template.followUp.statusLabels, started: v } }),
              { max: 100 },
            )}
            {field(
              'Answer: not started',
              template.followUp.statusLabels.not_started,
              (v) =>
                patchFollowUp({
                  statusLabels: { ...template.followUp.statusLabels, not_started: v },
                }),
              { max: 100 },
            )}
          </div>
          {field(
            'Update question',
            template.followUp.updatePrompt,
            (v) => patchFollowUp({ updatePrompt: v }),
            { rows: 3, max: 500 },
          )}
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-xs text-corp-green-text">
          {saved}
        </p>
      ) : null}
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className={consoleButton({ variant: 'secondary' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Save the form setting
          </button>
          {mode === 'commitment' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
              className={consoleButton({ variant: 'ghost' })}
            >
              Reset the wording to the default
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
