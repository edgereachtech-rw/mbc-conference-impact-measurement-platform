'use client';

import {
  compareMeasure,
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
  measureOutcomeLabels,
  measureStatusLabels,
  measureStatuses,
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
 * Business and workplace measures and evidence of application on one planned action (backlog
 * E14, S12). Both lists hang off the action of the delegate's existing plan and are saved with
 * the plan's version, so an update changes that plan and never creates another. Nothing is
 * mandatory: a measure may be "not yet known" or "not applicable", values may be numbers with a
 * unit or words, and every record can be saved incomplete. Each result and each evidence record
 * is self-reported or supported by another source; nothing here is called verified.
 */

const textarea =
  'w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm';
const input = 'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm';

/** A value with its unit, or a dash. */
export function formatMeasureValue(value: string, unit: string) {
  const v = value.trim();
  if (!v) return '—';
  return unit.trim() ? `${v} ${unit.trim()}` : v;
}

// ------------------------------------------------------------------ read-only lines

export function MeasureLine({ measure }: { measure: MeasureView }) {
  if (measure.status !== 'identified') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-corp-ink">{measure.name.trim() || 'Measure'}</span>
        <StatusPill tone="neutral">{measureStatusLabels[measure.status]}</StatusPill>
      </div>
    );
  }
  const comparison = compareMeasure(measure);
  const when = (d: string | null) => (d ? ` (${formatDateShort(d)})` : '');
  const change =
    comparison.change === null
      ? null
      : `${comparison.change > 0 ? '+' : ''}${comparison.change}${measure.unit.trim() ? ` ${measure.unit.trim()}` : ''}`;
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
      <p className="text-corp-text">
        Baseline {formatMeasureValue(measure.baselineValue, measure.unit)}
        {when(measure.baselineOn)} · Target {formatMeasureValue(measure.targetValue, measure.unit)}
        {when(measure.targetOn)} · Actual {formatMeasureValue(measure.actualValue, measure.unit)}
        {when(measure.actualOn)}
      </p>
      {measure.actualValue.trim() ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-corp-muted">
          <StatusPill
            tone={
              comparison.outcome === 'improved'
                ? 'positive'
                : comparison.outcome === 'declined'
                  ? 'attention'
                  : 'neutral'
            }
          >
            {measureOutcomeLabels[comparison.outcome]}
          </StatusPill>
          {comparison.reason ?? (change !== null ? `Change ${change}` : null)}
          {comparison.targetMet !== null
            ? comparison.targetMet
              ? ' · target reached'
              : ' · target not yet reached'
            : null}
          <span>· {evidenceSupportLabels[measure.support]}</span>
          {measure.source.trim() ? <span>· Source: {measure.source}</span> : null}
        </p>
      ) : null}
      {measure.influences.trim() ? (
        <p className="text-xs text-corp-muted">Other factors: {measure.influences}</p>
      ) : null}
      {measure.readings.length > 0 ? (
        <p className="text-xs text-corp-muted">
          Earlier results:{' '}
          {measure.readings
            .map((r) => `${formatMeasureValue(r.value, measure.unit)}${when(r.readingOn)}`)
            .join(', ')}
        </p>
      ) : null}
    </div>
  );
}

export function EvidenceLine({ record }: { record: EvidenceView }) {
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
      {record.support === 'supported' && record.supportedBy.trim() ? (
        <p className="text-xs text-corp-muted">Supported by: {record.supportedBy}</p>
      ) : null}
      {record.reference.trim() ? (
        <p className="text-xs text-corp-muted">Reference: {record.reference}</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ block inside an action card

export function ActionMeasures({
  action,
  disabled,
  dirty,
  onMeasures,
  onEvidence,
}: {
  /** The saved action, or null while it exists only on screen (nothing to attach to yet). */
  action: PlanActionView | null;
  disabled: boolean;
  /** Unsaved plan edits: the dialogs would reload the plan and lose them. */
  dirty: boolean;
  onMeasures: () => void;
  onEvidence: () => void;
}) {
  const measures = action?.measures ?? [];
  const records = action?.evidenceRecords ?? [];
  const unsaved = action === null;
  return (
    <section aria-label="Measure and evidence" className="space-y-3 border-t border-corp-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-corp-ink">Measure and evidence</p>
          <p className="text-xs text-corp-muted">
            The measure you will track for this action, with its starting point and target now and
            its actual result later; and, later, the evidence that the action happened.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={disabled || dirty || unsaved}
            onClick={onMeasures}
            aria-label={measures.length > 0 ? 'Measure: edit measures' : 'Measure: add a measure'}
            className={consoleButton({ variant: 'secondary', size: 'sm' })}
          >
            Measure
          </button>
          <button
            type="button"
            disabled={disabled || dirty || unsaved}
            onClick={onEvidence}
            aria-label={records.length > 0 ? 'Evidence: edit evidence' : 'Evidence: add evidence'}
            className={consoleButton({ variant: 'secondary', size: 'sm' })}
          >
            Evidence
          </button>
        </div>
      </div>
      {unsaved || dirty ? (
        <p className="text-xs text-corp-muted">
          Save your plan first, then set the measure and, later, the evidence.
        </p>
      ) : null}
      {measures.length === 0 && records.length === 0 ? (
        <p className="text-xs text-corp-muted">
          No measure yet. Set the measure you will track and its starting point while you plan; “Not
          yet known” and “Not applicable” are fine. Add the actual result and the evidence when the
          action starts to show. Both are needed before the plan can be completed as having made a
          difference; evidence alone completes it as applied.
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
              <EvidenceLine record={e} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ measures dialog

interface MeasureDraft {
  key: string;
  id?: string;
  status: MeasureStatus;
  kind: MeasureKind;
  name: string;
  importance: string;
  unit: string;
  direction: ImprovementDirection;
  baselineValue: string;
  baselineOn: string;
  targetValue: string;
  targetOn: string;
  actualValue: string;
  actualOn: string;
  source: string;
  influences: string;
  support: EvidenceSupport;
}

let tempKeys = 0;
const nextKey = () => `new-${++tempKeys}`;

function emptyMeasure(): MeasureDraft {
  return {
    key: nextKey(),
    status: 'identified',
    kind: 'quantitative',
    name: '',
    importance: '',
    unit: '',
    direction: 'unspecified',
    baselineValue: '',
    baselineOn: '',
    targetValue: '',
    targetOn: '',
    actualValue: '',
    actualOn: '',
    source: '',
    influences: '',
    support: 'self_reported',
  };
}

function measureDraftOf(m: MeasureView): MeasureDraft {
  return {
    key: m.id,
    id: m.id,
    status: m.status,
    kind: m.kind,
    name: m.name,
    importance: m.importance,
    unit: m.unit,
    direction: m.direction,
    baselineValue: m.baselineValue,
    baselineOn: m.baselineOn ?? '',
    targetValue: m.targetValue,
    targetOn: m.targetOn ?? '',
    actualValue: m.actualValue,
    actualOn: m.actualOn ?? '',
    source: m.source,
    influences: m.influences,
    support: m.support,
  };
}

function measurePayload(rows: MeasureDraft[]): MeasureFields[] {
  return rows.map(({ key, baselineOn, targetOn, actualOn, ...rest }) => {
    void key;
    return {
      ...rest,
      baselineOn: baselineOn || null,
      targetOn: targetOn || null,
      actualOn: actualOn || null,
    };
  });
}

/** The first number that is not one, for a quantitative measure; null when all are fine. */
function firstNonNumber(rows: MeasureDraft[]): string | null {
  for (const [i, m] of rows.entries()) {
    if (m.kind !== 'quantitative' || m.status !== 'identified') continue;
    for (const field of ['baselineValue', 'targetValue', 'actualValue'] as const) {
      if (m[field].trim() !== '' && !isNumericValue(m[field])) {
        return `Measure ${i + 1}: ${measureFieldLabels[field].label.toLowerCase()} must be a number such as 12 or 3.5, with the unit in its own field. Choose “qualitative” to describe it in words instead.`;
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
    const invalid = firstNonNumber(rows);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<MyTransferPlan>(
        `/me/events/${eventId}/transfer-plans/${planId}/actions/${action.id}/measures`,
        { method: 'PUT', body: JSON.stringify({ version, measures: measurePayload(rows) }) },
      );
      onSaved(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_plan') onStale(e.message);
      else setProblem(describeError(e, 'The measures could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Measures for this action"
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
            Save measures
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="border-l-4 border-corp-accent bg-corp-accent-soft/40 p-3 text-xs text-corp-text">
          {confidentialityNotice}
        </p>
        {problem ? (
          <p
            role="alert"
            className="border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm font-semibold text-brand-danger"
          >
            {problem}
          </p>
        ) : null}
        <datalist id={`${listId}-examples`}>
          {measureExamples.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        {rows.length === 0 ? (
          <p className="text-sm text-corp-muted">
            No measure yet. Add one, or record that the measure is not yet known or not applicable.
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
  const identified = draft.status === 'identified';
  const quantitative = draft.kind === 'quantitative';
  const field = (
    name: keyof typeof measureFieldLabels,
    kind: 'text' | 'textarea' | 'date' | 'value',
  ) => {
    const meta = measureFieldLabels[name];
    const value = draft[name];
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-${name}`} className="text-sm font-semibold text-corp-ink">
          {meta.label}
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
            type={kind === 'date' ? 'date' : 'text'}
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
    <fieldset aria-label={title} className="space-y-3 border border-corp-line bg-white p-3">
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
      <div className="space-y-1">
        <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
          Do you have a measure for this action?
        </label>
        <NativeSelect
          id={`${id}-status`}
          value={draft.status}
          disabled={disabled}
          onChange={(e) => onChange({ status: e.target.value as MeasureStatus })}
          className="rounded-none border-corp-line"
        >
          {measureStatuses.map((s) => (
            <option key={s} value={s}>
              {measureStatusLabels[s]}
            </option>
          ))}
        </NativeSelect>
        {!identified ? (
          <p className="text-xs text-corp-muted">
            No value is needed. Come back and change this if a measure becomes known or relevant.
          </p>
        ) : null}
      </div>
      {field('name', 'text')}
      {identified ? (
        <>
          {field('importance', 'textarea')}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${id}-kind`} className="text-sm font-semibold text-corp-ink">
                Type of measure
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
              <div className="space-y-1">
                <label htmlFor={`${id}-direction`} className="text-sm font-semibold text-corp-ink">
                  Which way is better?
                </label>
                <p className="text-xs text-corp-muted">
                  A lower error rate or a shorter turnaround time is an improvement.
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
            ) : null}
          </div>
          {quantitative ? field('unit', 'text') : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {field('baselineValue', quantitative ? 'value' : 'textarea')}
            {field('baselineOn', 'date')}
            {field('targetValue', quantitative ? 'value' : 'textarea')}
            {field('targetOn', 'date')}
            {field('actualValue', quantitative ? 'value' : 'textarea')}
            {field('actualOn', 'date')}
          </div>
          {field('source', 'text')}
          {field('influences', 'textarea')}
          <div className="space-y-1">
            <label htmlFor={`${id}-support`} className="text-sm font-semibold text-corp-ink">
              How is the result supported?
            </label>
            <NativeSelect
              id={`${id}-support`}
              value={draft.support}
              disabled={disabled}
              onChange={(e) => onChange({ support: e.target.value as EvidenceSupport })}
              className="rounded-none border-corp-line"
            >
              {evidenceSupports.map((s) => (
                <option key={s} value={s}>
                  {evidenceSupportLabels[s]}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-corp-muted">{evidenceSupportHints[draft.support]}</p>
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

// ------------------------------------------------------------------ evidence dialog

interface EvidenceDraft {
  key: string;
  id?: string;
  type: EvidenceType;
  description: string;
  evidenceOn: string;
  support: EvidenceSupport;
  supportedBy: string;
  reference: string;
}

function emptyEvidence(): EvidenceDraft {
  return {
    key: nextKey(),
    type: 'example',
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
            Save evidence
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="border-l-4 border-corp-accent bg-corp-accent-soft/40 p-3 text-xs text-corp-text">
          {confidentialityNotice} Nothing is uploaded here: describe the evidence, and name a
          document or link only if you choose to.
        </p>
        {problem ? (
          <p
            role="alert"
            className="border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm font-semibold text-brand-danger"
          >
            {problem}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-corp-muted">
            No evidence yet. An example of what you did differently is enough to start.
          </p>
        ) : null}
        {rows.map((e, index) => (
          <EvidenceForm
            key={e.key}
            draft={e}
            index={index}
            disabled={busy}
            onChange={(patch) => update(e.key, patch)}
            onRemove={() => setRows((list) => list.filter((x) => x.key !== e.key))}
          />
        ))}
        <button
          type="button"
          disabled={busy || rows.length >= 20}
          onClick={() => setRows((list) => [...list, emptyEvidence()])}
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
  disabled,
  onChange,
  onRemove,
}: {
  draft: EvidenceDraft;
  index: number;
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
        <label htmlFor={`${id}-type`} className="text-sm font-semibold text-corp-ink">
          What kind of evidence is it?
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
      <div className="space-y-1">
        <label htmlFor={`${id}-description`} className="text-sm font-semibold text-corp-ink">
          Description (required)
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
          <label htmlFor={`${id}-on`} className="text-sm font-semibold text-corp-ink">
            Date (if known)
          </label>
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
          <label htmlFor={`${id}-reference`} className="text-sm font-semibold text-corp-ink">
            Reference (optional)
          </label>
          <p className="text-xs text-corp-muted">A link or the name of a document, if you wish.</p>
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
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-corp-ink">How is it supported?</legend>
        {evidenceSupports.map((s) => (
          <label key={s} className="flex min-h-tap items-start gap-2 text-sm text-corp-ink">
            <input
              type="radio"
              name={`${id}-support`}
              value={s}
              checked={draft.support === s}
              disabled={disabled}
              onChange={() => onChange({ support: s })}
              className="mt-1 size-5 shrink-0 accent-corp-green"
            />
            <span>
              <span className="font-semibold">{evidenceSupportLabels[s]}</span>
              <span className="block text-xs text-corp-muted">{evidenceSupportHints[s]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {draft.support === 'supported' ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-by`} className="text-sm font-semibold text-corp-ink">
            Supported by
          </label>
          <p className="text-xs text-corp-muted">
            A role or a document is enough, for example “line manager” or “monthly report”.
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
      ) : null}
    </fieldset>
  );
}
