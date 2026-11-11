'use client';

import {
  baselineStateLabels,
  baselineStates,
  confidentialityNotice,
  evidenceSupportHints,
  evidenceSupportLabels,
  evidenceSupports,
  evidenceTypeLabels,
  evidenceTypes,
  improvementDirectionLabels,
  improvementDirections,
  isNumericValue,
  measureExamples,
  measureFieldLabels,
  measureKindLabels,
  measureKinds,
  measureStatusLabels,
  targetStateLabels,
  targetStates,
  type BaselineState,
  type EvidenceFields,
  type EvidenceSupport,
  type EvidenceType,
  type EvidenceView,
  type ImprovementDirection,
  type MeasureFields,
  type MeasureKind,
  type MeasureStatus,
  type MeasureView,
  type MyTransferPlan,
  type PlanActionView,
  type TargetState,
} from '@mbc/shared';
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateShort } from '@/lib/events';
import { describeError } from '@/lib/imports';

/**
 * Business measures and evidence of application on one planned action (backlog E14, S12; spec
 * of 2026-11-08). Everything hangs off the action of the delegate's existing plan and is saved
 * with the plan's version, so an update changes that plan and never creates another. The
 * delegate answers on the action card whether a measure can be identified, defines the measures
 * here (name, why it matters, how it is measured, baseline and target), and adds evidence, which
 * may name the measure it supports. No actual results are recorded (decision 2026-11-09): what
 * happened is told by the evidence and by the follow-ups. Each evidence record is self-reported
 * or supported by another source; nothing here is called verified, and no file is uploaded.
 */

const textarea =
  'w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm';
const input = 'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm';
const heading = 'text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase';

/** A value with its unit, or a dash. */
export function formatMeasureValue(value: string, unit: string) {
  const v = value.trim();
  if (!v) return '—';
  return unit.trim() ? `${v} ${unit.trim()}` : v;
}

const when = (d: string | null) => (d ? ` (${formatDateShort(d)})` : '');

/** The baseline as the delegate stated it: a value, or that it is not yet known. */
export function baselineText(m: MeasureView) {
  return m.baselineState === 'known'
    ? `${formatMeasureValue(m.baselineValue, m.unit)}${when(m.baselineOn)}`
    : baselineStateLabels.not_yet_known;
}

/** The target as the delegate stated it: a value, not yet known, or not applicable. */
export function targetText(m: MeasureView) {
  return m.targetState === 'set'
    ? `${formatMeasureValue(m.targetValue, m.unit)}${when(m.targetOn)}`
    : targetStateLabels[m.targetState];
}

// ------------------------------------------------------------------ read-only lines

export function MeasureLine({ measure }: { measure: MeasureView }) {
  return (
    <div className="space-y-1 border-l-2 border-corp-line pl-3 text-sm">
      <p className="font-semibold text-corp-ink">
        {measure.name.trim() || 'Unnamed measure'}
        <span className="ml-2 font-normal text-corp-muted">
          {measure.kind === 'quantitative'
            ? improvementDirectionLabels[measure.direction]
            : 'Qualitative'}
        </span>
      </p>
      {measure.importance.trim() ? <p className="text-corp-text">{measure.importance}</p> : null}
      {measure.method.trim() ? (
        <p className="text-xs text-corp-muted">Measured by: {measure.method}</p>
      ) : null}
      <p className="text-corp-text">
        Baseline {baselineText(measure)} · Target {targetText(measure)}
      </p>
    </div>
  );
}

export function EvidenceLine({
  record,
  measureName,
}: {
  record: EvidenceView;
  /** The measure it supports, when it names one. */
  measureName?: string | null;
}) {
  return (
    <div className="space-y-0.5 border-l-2 border-corp-line pl-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-corp-ink">{evidenceTypeLabels[record.type]}</span>
        <StatusPill tone={record.support === 'supported' ? 'positive' : 'neutral'}>
          {evidenceSupportLabels[record.support]}
        </StatusPill>
        {record.evidenceOn ? (
          <span className="text-xs text-corp-muted">{formatDateShort(record.evidenceOn)}</span>
        ) : null}
      </p>
      <p className="text-corp-text">{record.description}</p>
      {measureName ? <p className="text-xs text-corp-muted">For measure: {measureName}</p> : null}
      {record.supportedBy.trim() ? (
        <p className="text-xs text-corp-muted">Source: {record.supportedBy}</p>
      ) : null}
      {record.reference.trim() ? (
        <p className="text-xs text-corp-muted">Reference: {record.reference}</p>
      ) : null}
    </div>
  );
}

/** The name of the measure an evidence record points at, if any. */
export function measureNameFor(action: PlanActionView, record: EvidenceView) {
  if (!record.measureId) return null;
  const m = action.measures.find((x) => x.id === record.measureId);
  return m ? m.name.trim() || 'Unnamed measure' : null;
}

// ------------------------------------------------------------------ block inside an action card

export function ActionMeasures({
  action,
  disabled,
  onMeasures,
  onEvidence,
}: {
  action: PlanActionView;
  disabled: boolean;
  /** Opens the measures dialog; unsaved plan edits are saved first by the caller (2026-11-11). */
  onMeasures: () => void;
  onEvidence: () => void;
}) {
  const measures = action.measures ?? [];
  const records = action.evidenceRecords ?? [];
  const status = action.measureStatus;
  return (
    <section
      aria-label="Business measures and evidence"
      className="space-y-3 border-t border-corp-line pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-corp-ink">
          Business measures and evidence
          {status ? (
            <StatusPill tone={status === 'identified' ? 'positive' : 'neutral'}>
              {status === 'identified'
                ? `${measures.length} measure${measures.length === 1 ? '' : 's'}`
                : measureStatusLabels[status]}
            </StatusPill>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-1">
          {status === 'identified' ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onMeasures}
              className={consoleButton({ variant: 'secondary', size: 'sm' })}
            >
              {measures.length > 0 ? 'Update measures' : 'Add a measure'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={onEvidence}
            className={consoleButton({ variant: 'secondary', size: 'sm' })}
          >
            {records.length > 0 ? 'Update evidence' : 'Add evidence'}
          </button>
        </div>
      </div>
      {!status ? (
        <p className="text-xs text-corp-muted">
          Answer “Can you identify a business measure for this action?” above. Measures can be added
          once the answer is yes; evidence of what you did can be added at any time.
        </p>
      ) : status === 'identified' && measures.length === 0 ? (
        <p className="text-xs text-corp-muted">
          Add the measure: what you will track, its starting point and the target where known.
        </p>
      ) : status !== 'identified' ? (
        <p className="text-xs text-corp-muted">
          No measure is needed for now. Change the answer above when a measure becomes known or
          relevant.
        </p>
      ) : null}
      {measures.length > 0 ? (
        <ul aria-label="Measures" className="space-y-2">
          {measures.map((m) => (
            <li key={m.id}>
              <MeasureLine measure={m} />
            </li>
          ))}
        </ul>
      ) : null}
      {records.length > 0 ? (
        <ul aria-label="Evidence" className="space-y-2">
          {records.map((e) => (
            <li key={e.id}>
              <EvidenceLine record={e} measureName={measureNameFor(action, e)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ shared form bits

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p
      role="alert"
      className="border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm font-semibold text-brand-danger"
    >
      {text}
    </p>
  );
}

function SupportChoice({
  id,
  legend,
  value,
  disabled,
  onChange,
}: {
  id: string;
  legend: string;
  value: EvidenceSupport;
  disabled: boolean;
  onChange: (value: EvidenceSupport) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-corp-ink">{legend}</legend>
      {evidenceSupports.map((s) => (
        <label key={s} className="flex min-h-tap items-start gap-2 text-sm text-corp-ink">
          <input
            type="radio"
            name={id}
            value={s}
            checked={value === s}
            disabled={disabled}
            onChange={() => onChange(s)}
            className="mt-1 size-5 shrink-0 accent-corp-green"
          />
          <span>
            <span className="font-semibold">{evidenceSupportLabels[s]}</span>
            <span className="block text-xs text-corp-muted">{evidenceSupportHints[s]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

let tempKeys = 0;
const nextKey = () => `new-${++tempKeys}`;

// ------------------------------------------------------------------ measures dialog

interface MeasureDraft {
  key: string;
  id?: string;
  kind: MeasureKind;
  name: string;
  importance: string;
  method: string;
  unit: string;
  direction: ImprovementDirection;
  baselineState: BaselineState;
  baselineValue: string;
  baselineOn: string;
  targetState: TargetState;
  targetValue: string;
  targetOn: string;
}

function emptyMeasure(): MeasureDraft {
  return {
    key: nextKey(),
    kind: 'quantitative',
    name: '',
    importance: '',
    method: '',
    unit: '',
    direction: 'unspecified',
    baselineState: 'not_yet_known',
    baselineValue: '',
    baselineOn: '',
    targetState: 'not_yet_known',
    targetValue: '',
    targetOn: '',
  };
}

function measureDraftOf(m: MeasureView): MeasureDraft {
  return {
    key: m.id,
    id: m.id,
    kind: m.kind,
    name: m.name,
    importance: m.importance,
    method: m.method,
    unit: m.unit,
    direction: m.direction,
    baselineState: m.baselineState,
    baselineValue: m.baselineValue,
    baselineOn: m.baselineOn ?? '',
    targetState: m.targetState,
    targetValue: m.targetValue,
    targetOn: m.targetOn ?? '',
  };
}

function measurePayload(rows: MeasureDraft[]): MeasureFields[] {
  return rows.map(({ key, baselineOn, targetOn, ...rest }) => {
    void key;
    return { ...rest, baselineOn: baselineOn || null, targetOn: targetOn || null };
  });
}

/** The first thing wrong with the measures, in the delegate's words; null when all is fine. */
function firstMeasureProblem(status: MeasureStatus, rows: MeasureDraft[]): string | null {
  if (status !== 'identified') return null;
  if (rows.length === 0) {
    return 'Add at least one measure, or say the measure is not yet known or not applicable.';
  }
  for (const [i, m] of rows.entries()) {
    const n = `Measure ${i + 1}`;
    if (!m.name.trim()) return `${n}: say what you would like to measure.`;
    if (!m.importance.trim()) return `${n}: say why this measure is important.`;
    if (!m.method.trim()) return `${n}: say how you will measure it.`;
    const quantitative = m.kind === 'quantitative';
    if (quantitative && !m.unit.trim()) {
      return `${n}: give the unit, for example hours, % or number of errors.`;
    }
    if (m.baselineState === 'known' && !m.baselineValue.trim()) {
      return `${n}: give the current value, or say the baseline is not yet known.`;
    }
    if (m.targetState === 'set' && !m.targetValue.trim()) {
      return `${n}: give the target, or say it is not yet known or not applicable.`;
    }
    if (quantitative) {
      for (const field of ['baselineValue', 'targetValue'] as const) {
        if (m[field].trim() !== '' && !isNumericValue(m[field])) {
          return `${n}: ${measureFieldLabels[field].label.toLowerCase()} must be a number such as 12 or 3.5, with the unit in its own field. Choose “qualitative” to describe it in words instead.`;
        }
      }
    }
  }
  return null;
}

export function MeasuresDialog({
  eventId,
  planId,
  action,
  version,
  onClose,
  onSaved,
  onStale,
}: {
  eventId: string;
  planId: string;
  action: PlanActionView;
  version: number;
  onClose: () => void;
  onSaved: (data: MyTransferPlan) => void;
  onStale: (message: string) => void;
}) {
  // The question is answered on the action card (2026-11-08); the dialog opens only for "yes".
  const status: MeasureStatus = 'identified';
  const [rows, setRows] = useState<MeasureDraft[]>(() =>
    (action.measures ?? []).map(measureDraftOf),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const listId = useId();

  function update(key: string, patch: Partial<MeasureDraft>) {
    setRows((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  async function save() {
    const invalid = firstMeasureProblem(status, rows);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${planId}/actions/${action.id}/measures`,
        {
          method: 'PUT',
          body: JSON.stringify({ version, measureStatus: status, measures: measurePayload(rows) }),
        },
      );
      onSaved(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_plan') onStale(e.message);
      else setProblem(describeError(e, 'The measures could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  const identified = status === 'identified';
  return (
    <Dialog
      title="Business measures for this action"
      description={action.title.trim() || action.action.trim() || 'Your action'}
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
            Save measures
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="border-l-4 border-corp-accent bg-corp-accent-soft/40 p-3 text-xs text-corp-text">
          {confidentialityNotice}
        </p>
        <Problem text={problem} />
        <p className="text-xs text-corp-muted">
          Choose a result or change that can help you understand whether your planned action is
          making a difference. It may be a numerical measure, such as time saved or errors reduced,
          or a qualitative measure, such as improved teamwork or customer experience.
        </p>
        {identified ? (
          <>
            <datalist id={`${listId}-examples`}>
              {measureExamples.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            {rows.length === 0 ? (
              <p className="text-sm text-corp-muted">
                No measure yet. For example: “Improve customer support” → average response time;
                “Improve team collaboration” → team feedback on collaboration.
              </p>
            ) : null}
            {rows.map((m, index) => (
              <MeasureForm
                key={m.key}
                draft={m}
                index={index}
                examplesId={`${listId}-examples`}
                disabled={busy}
                onChange={(patch) => update(m.key, patch)}
                onRemove={() => setRows((list) => list.filter((x) => x.key !== m.key))}
              />
            ))}
            <button
              type="button"
              disabled={busy || rows.length >= 20}
              onClick={() => setRows((list) => [...list, emptyMeasure()])}
              className={consoleButton({ variant: 'secondary' })}
            >
              <PlusIcon aria-hidden="true" /> Add a measure
            </button>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function MeasureForm({
  draft,
  index,
  examplesId,
  disabled,
  onChange,
  onRemove,
}: {
  draft: MeasureDraft;
  index: number;
  examplesId: string;
  disabled: boolean;
  onChange: (patch: Partial<MeasureDraft>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const quantitative = draft.kind === 'quantitative';
  const field = (
    name: keyof typeof measureFieldLabels,
    kind: 'text' | 'textarea' | 'date' | 'value',
    required = false,
  ) => {
    const meta = measureFieldLabels[name];
    const value = draft[name];
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-${name}`} className="text-sm font-semibold text-corp-ink">
          {meta.label}
          {required ? (
            <span className="ml-1 text-xs font-normal text-corp-muted">(required)</span>
          ) : null}
        </label>
        <p className="text-xs text-corp-muted">{meta.prompt}</p>
        {kind === 'textarea' ? (
          <textarea
            id={`${id}-${name}`}
            rows={2}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange({ [name]: e.target.value } as Partial<MeasureDraft>)}
            className={textarea}
          />
        ) : (
          <input
            id={`${id}-${name}`}
            // A quantitative value takes only a number; the unit has its own field.
            type={kind === 'date' ? 'date' : kind === 'value' && quantitative ? 'number' : 'text'}
            step={kind === 'value' && quantitative ? 'any' : undefined}
            inputMode={kind === 'value' && quantitative ? 'decimal' : undefined}
            list={name === 'name' ? examplesId : undefined}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange({ [name]: e.target.value } as Partial<MeasureDraft>)}
            className={input}
          />
        )}
      </div>
    );
  };
  const title = draft.name.trim() || `Measure ${index + 1}`;

  return (
    <fieldset aria-label={title} className="space-y-4 border border-corp-line bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="float-left text-sm font-semibold text-corp-ink">
          Measure {index + 1}
        </legend>
        <button
          type="button"
          aria-label={`Remove measure ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      </div>

      <section aria-label="Identify the measure" className="space-y-3">
        <h5 className={heading}>A. Identify the measure</h5>
        {field('name', 'text', true)}
        {field('importance', 'textarea', true)}
        {field('method', 'textarea', true)}
        <div className="space-y-1">
          <label htmlFor={`${id}-kind`} className="text-sm font-semibold text-corp-ink">
            What type of measure is this?
          </label>
          <NativeSelect
            id={`${id}-kind`}
            value={draft.kind}
            disabled={disabled}
            onChange={(e) => onChange({ kind: e.target.value as MeasureKind })}
            className="rounded-none border-corp-line"
          >
            {measureKinds.map((k) => (
              <option key={k} value={k}>
                {measureKindLabels[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {quantitative ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('unit', 'text', true)}
            <div className="space-y-1">
              <label htmlFor={`${id}-direction`} className="text-sm font-semibold text-corp-ink">
                Which way is better?
              </label>
              <p className="text-xs text-corp-muted">
                A shorter response time is an improvement; a higher satisfaction score may be too. A
                higher number is never assumed to be better.
              </p>
              <NativeSelect
                id={`${id}-direction`}
                value={draft.direction}
                disabled={disabled}
                onChange={(e) => onChange({ direction: e.target.value as ImprovementDirection })}
                className="rounded-none border-corp-line"
              >
                {improvementDirections.map((d) => (
                  <option key={d} value={d}>
                    {improvementDirectionLabels[d]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        ) : null}
      </section>

      <section
        aria-label="Starting point and target"
        className="space-y-3 border-t border-corp-line pt-3"
      >
        <h5 className={heading}>B. Starting point and target</h5>
        <p className="text-xs text-corp-muted">
          A baseline is the starting point later results are compared against. A target is the
          result you hope to achieve. Either can be unknown for now.
        </p>
        <div className="space-y-1">
          <label htmlFor={`${id}-baselineState`} className="text-sm font-semibold text-corp-ink">
            Do you know the current starting value (baseline)?
          </label>
          <NativeSelect
            id={`${id}-baselineState`}
            value={draft.baselineState}
            disabled={disabled}
            onChange={(e) => onChange({ baselineState: e.target.value as BaselineState })}
            className="rounded-none border-corp-line"
          >
            {baselineStates.map((s) => (
              <option key={s} value={s}>
                {baselineStateLabels[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {draft.baselineState === 'known' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('baselineValue', quantitative ? 'value' : 'textarea', true)}
            {field('baselineOn', 'date')}
          </div>
        ) : null}
        <div className="space-y-1">
          <label htmlFor={`${id}-targetState`} className="text-sm font-semibold text-corp-ink">
            Do you have a target you want to achieve?
          </label>
          <NativeSelect
            id={`${id}-targetState`}
            value={draft.targetState}
            disabled={disabled}
            onChange={(e) => onChange({ targetState: e.target.value as TargetState })}
            className="rounded-none border-corp-line"
          >
            {targetStates.map((s) => (
              <option key={s} value={s}>
                {targetStateLabels[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {draft.targetState === 'set' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('targetValue', quantitative ? 'value' : 'textarea', true)}
            {field('targetOn', 'date')}
          </div>
        ) : null}
      </section>
    </fieldset>
  );
}

// ------------------------------------------------------------------ evidence dialog

interface EvidenceDraft {
  key: string;
  id?: string;
  measureId: string | null;
  type: EvidenceType;
  description: string;
  evidenceOn: string;
  support: EvidenceSupport;
  supportedBy: string;
  reference: string;
}

function emptyEvidence(measureId: string | null): EvidenceDraft {
  return {
    key: nextKey(),
    measureId,
    type: 'work_product',
    description: '',
    evidenceOn: '',
    support: 'self_reported',
    supportedBy: '',
    reference: '',
  };
}

function evidenceDraftOf(e: EvidenceView): EvidenceDraft {
  return {
    key: e.id,
    id: e.id,
    measureId: e.measureId,
    type: e.type,
    description: e.description,
    evidenceOn: e.evidenceOn ?? '',
    support: e.support,
    supportedBy: e.supportedBy,
    reference: e.reference,
  };
}

function evidencePayload(rows: EvidenceDraft[]): EvidenceFields[] {
  return rows.map(({ key, evidenceOn, ...rest }) => {
    void key;
    return { ...rest, evidenceOn: evidenceOn || null };
  });
}

export function EvidenceDialog({
  eventId,
  planId,
  action,
  version,
  measureId = null,
  onClose,
  onSaved,
  onStale,
}: {
  eventId: string;
  planId: string;
  action: PlanActionView;
  version: number;
  /** Preselects the measure a new record supports. */
  measureId?: string | null;
  onClose: () => void;
  onSaved: (data: MyTransferPlan) => void;
  onStale: (message: string) => void;
}) {
  const [rows, setRows] = useState<EvidenceDraft[]>(() =>
    (action.evidenceRecords ?? []).map(evidenceDraftOf),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function update(key: string, patch: Partial<EvidenceDraft>) {
    setRows((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  async function save() {
    const blank = rows.findIndex((e) => e.description.trim() === '');
    if (blank >= 0) {
      setProblem(`Evidence ${blank + 1}: describe it in your own words, or remove it.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${planId}/actions/${action.id}/evidence`,
        { method: 'PUT', body: JSON.stringify({ version, evidence: evidencePayload(rows) }) },
      );
      onSaved(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_plan') onStale(e.message);
      else setProblem(describeError(e, 'The evidence could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Evidence of application"
      description={action.title.trim() || action.action.trim() || 'Your action'}
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
            Save evidence
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="border-l-4 border-corp-accent bg-corp-accent-soft/40 p-3 text-xs text-corp-text">
          {confidentialityNotice} Nothing is uploaded here: describe the evidence, and name a
          document or link only if you choose to. You are never asked for confidential
          organisational documents.
        </p>
        <Problem text={problem} />
        {rows.length === 0 ? (
          <p className="text-sm text-corp-muted">
            No evidence yet. An example of work completed is enough to start. A measure says what is
            tracked, a result says what was observed; evidence helps explain or support it.
          </p>
        ) : null}
        {rows.map((e, index) => (
          <EvidenceForm
            key={e.key}
            draft={e}
            index={index}
            measures={action.measures ?? []}
            disabled={busy}
            onChange={(patch) => update(e.key, patch)}
            onRemove={() => setRows((list) => list.filter((x) => x.key !== e.key))}
          />
        ))}
        <button
          type="button"
          disabled={busy || rows.length >= 20}
          onClick={() => setRows((list) => [...list, emptyEvidence(measureId)])}
          className={consoleButton({ variant: 'secondary' })}
        >
          <PlusIcon aria-hidden="true" /> Add evidence
        </button>
      </div>
    </Dialog>
  );
}

function EvidenceForm({
  draft,
  index,
  measures,
  disabled,
  onChange,
  onRemove,
}: {
  draft: EvidenceDraft;
  index: number;
  measures: MeasureView[];
  disabled: boolean;
  onChange: (patch: Partial<EvidenceDraft>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  return (
    <fieldset
      aria-label={`Evidence ${index + 1}`}
      className="space-y-3 border border-corp-line bg-white p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="float-left text-sm font-semibold text-corp-ink">
          Evidence {index + 1}
        </legend>
        <button
          type="button"
          aria-label={`Remove evidence ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-description`} className="text-sm font-semibold text-corp-ink">
          Describe the evidence (required)
        </label>
        <p className="text-xs text-corp-muted">
          What you did differently, what came of it, or what the work product or confirmation shows.
          In your own words; no confidential detail is needed.
        </p>
        <textarea
          id={`${id}-description`}
          rows={3}
          value={draft.description}
          disabled={disabled}
          onChange={(e) => onChange({ description: e.target.value })}
          className={textarea}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-type`} className="text-sm font-semibold text-corp-ink">
            What type of evidence is this?
          </label>
          <NativeSelect
            id={`${id}-type`}
            value={draft.type}
            disabled={disabled}
            onChange={(e) => onChange({ type: e.target.value as EvidenceType })}
            className="rounded-none border-corp-line"
          >
            {evidenceTypes.map((t) => (
              <option key={t} value={t}>
                {evidenceTypeLabels[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {measures.length > 0 ? (
          <div className="space-y-1">
            <label htmlFor={`${id}-measure`} className="text-sm font-semibold text-corp-ink">
              Which measure does it support?
            </label>
            <p className="text-xs text-corp-muted">Optional: leave it on the action as a whole.</p>
            <NativeSelect
              id={`${id}-measure`}
              value={draft.measureId ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ measureId: e.target.value || null })}
              className="rounded-none border-corp-line"
            >
              <option value="">The action as a whole</option>
              {measures.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name.trim() || 'Unnamed measure'}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="space-y-1">
          <label htmlFor={`${id}-on`} className="text-sm font-semibold text-corp-ink">
            When was this evidence obtained?
          </label>
          <p className="text-xs text-corp-muted">Optional.</p>
          <input
            id={`${id}-on`}
            type="date"
            value={draft.evidenceOn}
            disabled={disabled}
            onChange={(e) => onChange({ evidenceOn: e.target.value })}
            className={input}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-by`} className="text-sm font-semibold text-corp-ink">
            Who or what is the source?
          </label>
          <p className="text-xs text-corp-muted">
            Optional. A role or a document is enough, for example “line manager” or “monthly
            report”.
          </p>
          <input
            id={`${id}-by`}
            type="text"
            value={draft.supportedBy}
            disabled={disabled}
            onChange={(e) => onChange({ supportedBy: e.target.value })}
            className={input}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-reference`} className="text-sm font-semibold text-corp-ink">
            Reference (optional)
          </label>
          <p className="text-xs text-corp-muted">
            A link or the name of a document, if you wish. No file is uploaded or stored.
          </p>
          <input
            id={`${id}-reference`}
            type="text"
            value={draft.reference}
            disabled={disabled}
            onChange={(e) => onChange({ reference: e.target.value })}
            className={input}
          />
        </div>
      </div>
      <SupportChoice
        id={`${id}-support`}
        legend="Is this evidence self-reported or supported by another source?"
        value={draft.support}
        disabled={disabled}
        onChange={(support) => onChange({ support })}
      />
    </fieldset>
  );
}
