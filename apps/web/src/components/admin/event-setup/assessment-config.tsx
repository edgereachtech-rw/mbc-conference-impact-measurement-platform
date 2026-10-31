'use client';

import {
  assessmentStageConfigSchema,
  assessmentStageStatuses,
  assessmentTargets,
  stageWindowState,
  type AssessmentStage,
  type AssessmentStageView,
  type EventDetail,
  type StageSummary,
} from '@mbc/shared';
import { ListChecksIcon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

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
 * independently. Windows are entered in the event's time zone and stored as instants. Each
 * stage's questions and submissions live on the stage's own page, linked from its card.
 */
export function AssessmentConfig({ event, onSaved }: AssessmentConfigProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-corp-text">
        Each stage applies only when it is enabled here; no stage is mandatory. Times are in{' '}
        <span className="font-semibold text-corp-ink">{event.timezone}</span>. Attendance is
        recorded separately and never inferred from a submitted assessment.
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        {event.assessmentStages.map((stage) => (
          <StageCard key={stage.stage} event={event} stage={stage} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}

const TONE: Record<AssessmentStage, 'positive' | 'neutral' | 'attention'> = {
  pre_conference: 'neutral',
  during_conference: 'positive',
  end_of_conference: 'positive',
  follow_up: 'attention',
};

function StageCard({
  event,
  stage,
  onSaved,
}: {
  event: EventDetail;
  stage: AssessmentStageView;
  onSaved: (event: EventDetail) => void;
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
  const [summary, setSummary] = useState<StageSummary | null>(null);
  const countsApply = stage.enabled && stage.questionCount > 0;
  // What delegates see right now, computed the same way the API does it. The clock is read
  // when the counts arrive (after mount and after each save), so the line follows the stored
  // window rather than the unsaved draft and the server and client render the same markup.
  const [now, setNow] = useState<Date | null>(null);
  const seen = now ? stageWindowState(stage, now) : stage.enabled ? null : 'hidden';
  const seenText =
    seen === null
      ? null
      : seen === 'hidden'
        ? 'Not shown to delegates.'
        : seen === 'upcoming'
          ? `Delegates see "Opens later" until ${formatInstant(stage.opensAt, event.timezone)}; it opens by itself then.`
          : seen === 'closed'
            ? 'Closed to delegates.'
            : `Open to delegates${stage.closesAt ? ` until ${formatInstant(stage.closesAt, event.timezone)}` : ''}.`;

  // Response counts for an enabled stage with questions; refreshed whenever the stage changes.
  useEffect(() => {
    let cancelled = false;
    if (!countsApply) return undefined;
    apiFetch<{ summary?: StageSummary }>(
      `/events/${event.id}/assessments/${stage.stage}/summary`,
    ).then(
      (result) => {
        if (cancelled) return;
        setSummary(result.summary ?? null);
        setNow(new Date());
      },
      () => {
        // The counts are informational; the stage still configures without them.
        if (!cancelled) setNow(new Date());
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, stage.stage, countsApply, stage.updatedAt]);

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
    <>
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
          {stage.enabled && seenText ? (
            <p
              className={`text-xs font-semibold ${seen === 'open' ? 'text-corp-green-text' : 'text-corp-muted'}`}
            >
              {seenText}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={stage.questionCount > 0 ? 'positive' : stage.enabled ? 'attention' : 'neutral'}
            >
              {stage.questionCount} question{stage.questionCount === 1 ? '' : 's'}
            </StatusPill>
            <Link
              href={`/admin/events/${event.id}/assessments/${stage.stage}`}
              className={consoleButton({ variant: 'secondary', size: 'sm' })}
            >
              <ListChecksIcon aria-hidden="true" /> Questions and submissions
            </Link>
          </div>
          {countsApply && summary ? (
            <dl
              aria-label="Responses"
              className="grid grid-cols-3 gap-2 rounded-none border border-corp-line bg-corp-surface p-2 text-center"
            >
              <div>
                <dt className="text-[0.65rem] font-semibold tracking-[0.08em] text-corp-muted uppercase">
                  Invited
                </dt>
                <dd className="text-base font-semibold text-corp-ink tabular-nums">
                  {summary.invited}
                </dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-semibold tracking-[0.08em] text-corp-muted uppercase">
                  Started
                </dt>
                <dd className="text-base font-semibold text-corp-ink tabular-nums">
                  {summary.started}
                </dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-semibold tracking-[0.08em] text-corp-muted uppercase">
                  Submitted
                </dt>
                <dd className="text-base font-semibold text-corp-ink tabular-nums">
                  {summary.submitted}
                  {summary.responseRate !== null ? (
                    <span className="text-xs font-medium text-corp-muted">
                      {' '}
                      ({summary.responseRate}%)
                    </span>
                  ) : null}
                </dd>
              </div>
              {summary.knowledge ? (
                <div className="col-span-3 border-t border-corp-line pt-1 text-xs text-corp-text">
                  Knowledge score:{' '}
                  {summary.knowledge.averageScore === null
                    ? 'no complete answers yet'
                    : `average ${summary.knowledge.averageScore} of ${summary.knowledge.questions} (${summary.knowledge.averagePercent}%) from ${summary.knowledge.respondents} submitted`}
                </div>
              ) : null}
            </dl>
          ) : null}
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
    </>
  );
}
