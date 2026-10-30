'use client';

import {
  assessmentStageConfigSchema,
  assessmentStageStatuses,
  assessmentTargets,
  type AssessmentStage,
  type AssessmentStageView,
  type EventDetail,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { QuestionBuilder } from './question-builder';

import { consoleButton, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import {
  formatInstant,
  isoToZonedLocal,
  stageAreas,
  stageLabels,
  stagePurpose,
  stageStatusLabels,
  stageWhen,
  targetLabels,
  zonedLocalToIso,
} from '@/lib/events';
import { describeError } from '@/lib/imports';

interface AssessmentConfigProps {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}

/**
 * Assessment configuration (brief section 6): three stages, each enabled, scheduled and targeted
 * independently. Windows are entered in the event's time zone and stored as instants. Questions
 * arrive with the assessment builder; this screen sets whether and when each stage applies.
 */
export function AssessmentConfig({ event, onSaved }: AssessmentConfigProps) {
  const [questionsFor, setQuestionsFor] = useState<AssessmentStage | null>(null);
  async function refresh() {
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`);
      onSaved(result.event);
    } catch {
      // The next save reloads the event; a failed refresh only delays the count.
    }
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-corp-text">
        Each stage applies only when it is enabled here; no stage is mandatory. Times are in{' '}
        <span className="font-semibold text-corp-ink">{event.timezone}</span>. Attendance is
        recorded separately and never inferred from a submitted assessment.
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        {event.assessmentStages.map((stage) => (
          <StageCard
            key={stage.stage}
            event={event}
            stage={stage}
            onSaved={onSaved}
            questionsOpen={questionsFor === stage.stage}
            onToggleQuestions={() =>
              setQuestionsFor((current) => (current === stage.stage ? null : stage.stage))
            }
          />
        ))}
      </div>
      {questionsFor ? (
        <QuestionBuilder
          key={questionsFor}
          eventId={event.id}
          stage={questionsFor}
          readOnly={event.status === 'archived'}
          onChanged={() => void refresh()}
        />
      ) : null}
    </div>
  );
}

const TONE: Record<AssessmentStage, 'positive' | 'neutral' | 'attention'> = {
  pre_conference: 'neutral',
  during_conference: 'positive',
  follow_up: 'attention',
};

function StageCard({
  event,
  stage,
  onSaved,
  questionsOpen,
  onToggleQuestions,
}: {
  event: EventDetail;
  stage: AssessmentStageView;
  onSaved: (event: EventDetail) => void;
  questionsOpen: boolean;
  onToggleQuestions: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState({
    enabled: stage.enabled,
    opensAt: isoToZonedLocal(stage.opensAt, event.timezone),
    closesAt: isoToZonedLocal(stage.closesAt, event.timezone),
    target: stage.target,
    targetGroup: stage.targetGroup ?? '',
    status: stage.status,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; requestId?: string } | null>(
    null,
  );
  const readOnly = event.status === 'archived';

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setNotice(null);
    setErrors((e) => {
      if (!e[key]) return e;
      const copy = { ...e };
      delete copy[key];
      return copy;
    });
  }

  async function save() {
    const next: Record<string, string> = {};
    const opensAt = draft.opensAt ? zonedLocalToIso(draft.opensAt, event.timezone) : null;
    const closesAt = draft.closesAt ? zonedLocalToIso(draft.closesAt, event.timezone) : null;
    if (draft.opensAt && !opensAt) next.opensAt = 'Enter a complete date and time.';
    if (draft.closesAt && !closesAt) next.closesAt = 'Enter a complete date and time.';
    const payload = {
      enabled: draft.enabled,
      opensAt,
      closesAt,
      target: draft.target,
      targetGroup: draft.targetGroup,
      status: draft.enabled ? draft.status : 'draft',
    };
    const parsed = assessmentStageConfigSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        next[String(issue.path[0] ?? 'form')] ??= issue.message;
    }
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ event: EventDetail }>(
        `/events/${event.id}/assessments/${stage.stage}`,
        { method: 'PUT', body: JSON.stringify(parsed.success ? parsed.data : payload) },
      );
      onSaved(result.event);
      setNotice({ ok: true, text: 'Saved.' });
    } catch (e) {
      const failure = describeError(e, 'The stage could not be saved.');
      setNotice({ ok: false, text: failure.message, requestId: failure.requestId });
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p role="alert" className="text-xs text-brand-danger">
        {errors[key]}
      </p>
    ) : null;
  const inputClass =
    'h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm disabled:opacity-60';

  return (
    <form
      noValidate
      aria-label={stageLabels[stage.stage]}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className={`flex flex-col gap-4 rounded-none border bg-white p-4 md:p-5 ${
        draft.enabled ? 'border-corp-green border-t-4 border-t-corp-accent' : 'border-corp-line'
      }`}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill tone={TONE[stage.stage]}>{stageWhen[stage.stage]}</StatusPill>
          <StatusPill tone={stage.enabled ? 'positive' : 'neutral'}>
            {stage.enabled ? stageStatusLabels[stage.status] : 'Disabled'}
          </StatusPill>
        </div>
        <h3 className="font-corporate text-base font-semibold text-corp-ink">
          {stageLabels[stage.stage]}
        </h3>
        <p className="text-sm text-corp-text">{stagePurpose[stage.stage]}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            tone={stage.questionCount > 0 ? 'positive' : stage.enabled ? 'attention' : 'neutral'}
          >
            {stage.questionCount} question{stage.questionCount === 1 ? '' : 's'}
          </StatusPill>
          <button
            type="button"
            onClick={onToggleQuestions}
            aria-expanded={questionsOpen}
            className={consoleButton({ variant: questionsOpen ? 'dark' : 'secondary', size: 'sm' })}
          >
            {questionsOpen ? 'Hide questions' : 'Manage questions'}
          </button>
        </div>
        {stage.enabled && stage.questionCount === 0 ? (
          <p className="text-xs text-brand-danger">
            Enabled stages need at least one question before they can be scheduled, opened or
            published.
          </p>
        ) : null}
        <details className="text-xs text-corp-muted">
          <summary className="cursor-pointer font-semibold">Possible measurement areas</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {stageAreas[stage.stage].map((area) => (
              <li key={area}>{area}</li>
            ))}
          </ul>
        </details>
      </div>

      <label className="flex min-h-tap items-center gap-2 text-sm font-semibold text-corp-ink">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={readOnly || busy}
          onChange={(e) => set('enabled', e.target.checked)}
          className="size-5 accent-corp-green"
        />
        Enabled for this event
      </label>

      <div className="space-y-1">
        <label htmlFor={`${id}-opens`} className="text-sm font-semibold text-corp-ink">
          Available from
        </label>
        <input
          id={`${id}-opens`}
          type="datetime-local"
          value={draft.opensAt}
          disabled={readOnly || busy || !draft.enabled}
          onChange={(e) => set('opensAt', e.target.value)}
          className={inputClass}
        />
        {fieldError('opensAt')}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-closes`} className="text-sm font-semibold text-corp-ink">
          Deadline
        </label>
        <input
          id={`${id}-closes`}
          type="datetime-local"
          value={draft.closesAt}
          disabled={readOnly || busy || !draft.enabled}
          onChange={(e) => set('closesAt', e.target.value)}
          className={inputClass}
        />
        {fieldError('closesAt')}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-target`} className="text-sm font-semibold text-corp-ink">
          Target participants
        </label>
        <NativeSelect
          id={`${id}-target`}
          value={draft.target}
          disabled={readOnly || busy || !draft.enabled}
          onChange={(e) => set('target', e.target.value as (typeof assessmentTargets)[number])}
          className="rounded-none"
        >
          {assessmentTargets.map((t) => (
            <option key={t} value={t}>
              {targetLabels[t]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {draft.target === 'group' ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-group`} className="text-sm font-semibold text-corp-ink">
            Participant group
          </label>
          <input
            id={`${id}-group`}
            value={draft.targetGroup}
            maxLength={200}
            disabled={readOnly || busy || !draft.enabled}
            onChange={(e) => set('targetGroup', e.target.value)}
            className={inputClass}
          />
          {fieldError('targetGroup')}
        </div>
      ) : null}
      <div className="space-y-1">
        <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
          Status
        </label>
        <NativeSelect
          id={`${id}-status`}
          value={draft.enabled ? draft.status : 'draft'}
          disabled={readOnly || busy || !draft.enabled}
          onChange={(e) =>
            set('status', e.target.value as (typeof assessmentStageStatuses)[number])
          }
          className="rounded-none"
        >
          {assessmentStageStatuses.map((s) => (
            <option key={s} value={s}>
              {stageStatusLabels[s]}
            </option>
          ))}
        </NativeSelect>
        {fieldError('status')}
      </div>

      <p className="text-xs text-corp-muted">
        Stored: {formatInstant(stage.opensAt, event.timezone)} to{' '}
        {formatInstant(stage.closesAt, event.timezone)}
      </p>
      {notice ? (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={notice.ok ? 'text-xs text-corp-green-text' : 'text-xs text-brand-danger'}
        >
          {notice.text}
          {notice.requestId ? ` (request id ${notice.requestId})` : ''}
        </p>
      ) : null}
      {!readOnly ? (
        <button type="submit" disabled={busy} className={`mt-auto ${consoleButton()}`}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          Save stage
        </button>
      ) : null}
    </form>
  );
}
