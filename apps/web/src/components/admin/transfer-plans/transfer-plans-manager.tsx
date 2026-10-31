'use client';

import {
  actionProgressLabels,
  actionProgressStatuses,
  appliedStatuses,
  planActionFieldLabels,
  reminderFrequencyLabels,
  type ActionProgressStatus,
  type EventDetail,
  type PlanActionView,
  type TransferPlanAdminDetail,
  type TransferPlanListItem,
  type TransferPlanView,
} from '@mbc/shared';
import { DownloadIcon, EyeIcon, Loader2Icon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import {
  consoleButton,
  Panel,
  StatePanel,
  StatTile,
  StatusPill,
  TableScroll,
} from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatDateShort, formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface TransferPlansManagerProps {
  event: EventDetail;
}

interface ListResponse {
  plans: TransferPlanListItem[];
  sessions: Array<{
    id: string;
    date: string;
    title: string;
    startTime: string;
    endTime: string;
    order: number;
    isFinal: boolean;
  }>;
}
interface ReferencesResponse {
  /** Question keys in the order they are shown; the first is the evaluation's expectation. */
  references: string[];
  questions: Array<{ questionKey: string; prompt: string; type: string }>;
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Transfer plans for the organisers (backlog E9-9, E9-12, E12-12): counts, the Transfer
 * Planning sessions and which one opens submission, which pre-event answers come back as
 * references, and every delegate's plan with its progress; one plan in full, current or as
 * submitted, with its history. Admins only; the API audits every plan viewed.
 */
export function TransferPlansManager({ event }: TransferPlansManagerProps) {
  const [list, setList] = useState<ListResponse | null>(null);
  const [refs, setRefs] = useState<ReferencesResponse | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<'all' | 'draft' | 'submitted'>('all');
  const [search, setSearch] = useState('');
  const [progressFilter, setProgressFilter] = useState<'all' | ActionProgressStatus>('all');
  const [viewing, setViewing] = useState<string | null>(null);
  const readOnly = event.status === 'archived';
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<ListResponse>(`/events/${event.id}/transfer-plans`),
      apiFetch<ReferencesResponse>(`/events/${event.id}/reference-questions`),
    ]).then(
      ([l, r]) => {
        if (cancelled) return;
        setList(l);
        setRefs(r);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The transfer plans could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, version]);

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Transfer plans unavailable"
        description={error.message}
        requestId={error.requestId}
        action={
          <button
            type="button"
            onClick={refresh}
            className={consoleButton({ variant: 'secondary' })}
          >
            Try again
          </button>
        }
      />
    );
  }
  if (!list || !refs) return <StatePanel kind="loading" title="Loading transfer plans…" />;

  const submitted = list.plans.filter((p) => p.status === 'submitted').length;
  const applied = list.plans.reduce(
    (n, p) => n + appliedStatuses.reduce((m, s) => m + (p.progress[s] ?? 0), 0),
    0,
  );
  const actions = list.plans.reduce((n, p) => n + p.actions, 0);
  const reminders = list.plans.filter((p) => p.reminderFrequency !== 'none').length;
  const needle = search.trim().toLowerCase();
  const rows = list.plans.filter((p) => {
    if (status !== 'all' && p.status !== status) return false;
    if (progressFilter !== 'all' && !(p.progress[progressFilter] > 0)) return false;
    if (!needle) return true;
    return [
      p.delegate.name,
      p.delegate.email,
      p.delegate.organisation ?? '',
      p.priorityAction ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  function exportCsv() {
    const header = [
      'Delegate',
      'Email',
      'Organisation',
      'Format',
      'Status',
      'Submitted at',
      'Actions',
      'First priority',
      ...actionProgressStatuses.map((s) => actionProgressLabels[s]),
      'Reminders',
      'Updated at',
    ];
    const lines = rows.map((p) =>
      [
        p.delegate.name,
        p.delegate.email,
        p.delegate.organisation,
        p.delegate.attendanceFormat,
        p.status,
        p.submittedAt,
        p.actions,
        p.priorityAction,
        ...actionProgressStatuses.map((s) => p.progress[s] ?? 0),
        reminderFrequencyLabels[p.reminderFrequency],
        p.updatedAt,
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.slug}-transfer-plans.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Plans started"
          value={list.plans.length}
          hint="Delegates who opened a plan"
        />
        <StatTile
          label="Plans submitted"
          value={submitted}
          tone={submitted > 0 ? 'positive' : 'neutral'}
          hint="Counted as completed plans"
        />
        <StatTile
          label="Actions applied"
          value={applied}
          hint={`of ${actions} planned actions, in their latest status`}
        />
        <StatTile label="Reminders on" value={reminders} hint="Delegates who asked for reminders" />
      </div>

      <Panel>
        <h3 className="font-semibold text-corp-ink">Transfer Planning sessions</h3>
        {list.sessions.length === 0 ? (
          <p className="mt-1 text-sm text-corp-muted">
            No session of type Transfer Planning is scheduled, so delegates can submit at any time.
            Add the sessions under Sessions and schedule and mark the final one there.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-corp-text">
            {list.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {formatDateShort(s.date)}, {s.startTime}–{s.endTime}: {s.title}
                </span>
                {s.isFinal ? <StatusPill tone="positive">Submission opens here</StatusPill> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ReferencesPanel
        eventId={event.id}
        refs={refs}
        readOnly={readOnly}
        onSaved={(references) => {
          setRefs({ ...refs, references });
          setNotice('Reference questions saved.');
        }}
      />

      {notice ? (
        <p role="status" className="text-sm font-semibold text-corp-green-text">
          {notice}
        </p>
      ) : null}

      <Panel flush>
        <div className="flex flex-col gap-3 border-b border-corp-line p-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`${id}-search`} className="text-sm font-semibold text-corp-ink">
              Search
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, organisation or action"
              className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
            />
          </div>
          <div className="space-y-1 md:w-40">
            <label htmlFor={`${id}-status`} className="text-sm font-semibold text-corp-ink">
              Status
            </label>
            <NativeSelect
              id={`${id}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="rounded-none border-corp-line"
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
            </NativeSelect>
          </div>
          <div className="space-y-1 md:w-52">
            <label htmlFor={`${id}-progress`} className="text-sm font-semibold text-corp-ink">
              With an action
            </label>
            <NativeSelect
              id={`${id}-progress`}
              value={progressFilter}
              onChange={(e) => setProgressFilter(e.target.value as typeof progressFilter)}
              className="rounded-none border-corp-line"
            >
              <option value="all">In any status</option>
              {actionProgressStatuses.map((s) => (
                <option key={s} value={s}>
                  {actionProgressLabels[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className={consoleButton({ variant: 'ghost' })}
          >
            <DownloadIcon aria-hidden="true" /> Export CSV
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-corp-muted">
            {list.plans.length === 0
              ? 'No delegate has opened a plan yet.'
              : 'No plan matches these filters.'}
          </p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                <tr>
                  <th className="px-4 py-2">Delegate</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">First priority</th>
                  <th className="px-4 py-2">Progress</th>
                  <th className="px-4 py-2">Reminders</th>
                  <th className="px-4 py-2">Updated</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-corp-line">
                {rows.map((p) => (
                  <tr key={p.delegate.id}>
                    <td className="px-4 py-2">
                      <p className="font-semibold text-corp-ink">{p.delegate.name}</p>
                      <p className="text-xs text-corp-muted">
                        {p.delegate.organisation ?? p.delegate.email}
                      </p>
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill tone={p.status === 'submitted' ? 'positive' : 'neutral'}>
                        {p.status === 'submitted' ? 'Submitted' : 'Draft'}
                      </StatusPill>
                      {p.submittedAt ? (
                        <p className="mt-1 text-xs text-corp-muted">
                          {formatInstant(p.submittedAt, event.timezone)}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-xs px-4 py-2 text-corp-text">
                      <p className="line-clamp-2">{p.priorityAction ?? '—'}</p>
                      <p className="text-xs text-corp-muted">
                        {p.actions} action{p.actions === 1 ? '' : 's'}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-xs text-corp-text">
                      {actionProgressStatuses
                        .filter((s) => p.progress[s] > 0)
                        .map((s) => `${p.progress[s]} ${actionProgressLabels[s].toLowerCase()}`)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-corp-text">
                      {reminderFrequencyLabels[p.reminderFrequency]}
                    </td>
                    <td className="px-4 py-2 text-xs text-corp-muted">
                      {formatInstant(p.updatedAt, event.timezone)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setViewing(p.delegate.id)}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        <EyeIcon aria-hidden="true" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      {viewing ? (
        <PlanDialog
          eventId={event.id}
          delegateId={viewing}
          timezone={event.timezone}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

function ReferencesPanel({
  eventId,
  refs,
  readOnly,
  onSaved,
}: {
  eventId: string;
  refs: ReferencesResponse;
  readOnly: boolean;
  onSaved: (references: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string[]>(refs.references);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = draft.join(',') !== refs.references.join(',');
  const toggle = (questionKey: string, on: boolean) =>
    setDraft((d) => {
      const without = d.filter((k) => k !== questionKey);
      if (!on) return without;
      // Kept in question order so the list reads like the pre-conference form.
      const order = new Map(refs.questions.map((q, i) => [q.questionKey, i]));
      return [...without, questionKey].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    });

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<{ references: string[] }>(
        `/events/${eventId}/reference-questions`,
        { method: 'PUT', body: JSON.stringify({ questionKeys: draft }) },
      );
      onSaved(result.references);
    } catch (e) {
      setProblem(describeError(e, 'The reference questions could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h3 className="font-semibold text-corp-ink">Pre-event answers shown beside the plan</h3>
      <p className="mt-1 text-sm text-corp-muted">
        Tick the pre-conference questions whose answers delegates should see again while planning.
        The first ticked question is the expectation the end-of-conference evaluation asks about
        (“what you hoped to gain”).
      </p>
      {problem ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      {refs.questions.length === 0 ? (
        <p className="mt-3 text-sm text-corp-muted">
          The pre-conference assessment has no questions yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-corp-line" aria-labelledby={`${id}-refs`}>
          <span id={`${id}-refs`} className="sr-only">
            Pre-conference questions
          </span>
          {refs.questions.map((q) => {
            const index = draft.indexOf(q.questionKey);
            return (
              <li key={q.questionKey}>
                <label className="flex min-h-tap items-center gap-3 py-2 text-sm text-corp-ink">
                  <input
                    type="checkbox"
                    checked={index >= 0}
                    disabled={busy || readOnly}
                    onChange={(e) => toggle(q.questionKey, e.target.checked)}
                    className="size-5 shrink-0 accent-corp-green"
                  />
                  <span className="min-w-0 flex-1">{q.prompt}</span>
                  {index === 0 ? (
                    <StatusPill tone="positive">Expectation</StatusPill>
                  ) : index > 0 ? (
                    <StatusPill tone="neutral">{index + 1}</StatusPill>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={busy || !changed}
            onClick={() => void save()}
            className={consoleButton({ variant: 'accent', size: 'sm' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Save references
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function PlanDialog({
  eventId,
  delegateId,
  timezone,
  onClose,
}: {
  eventId: string;
  delegateId: string;
  timezone: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TransferPlanAdminDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'current' | 'submitted'>('current');

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ plan: TransferPlanAdminDetail }>(
      `/events/${eventId}/transfer-plans/${delegateId}`,
    ).then(
      (r) => {
        if (!cancelled) setDetail(r.plan);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The plan could not be loaded.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, delegateId]);

  const plan: TransferPlanView | null =
    detail && view === 'submitted' && detail.snapshot ? detail.snapshot : (detail?.plan ?? null);

  return (
    <Dialog
      title={detail ? detail.delegate.name : 'Transfer plan'}
      description={
        detail
          ? [detail.delegate.organisation, detail.delegate.email].filter(Boolean).join(' · ')
          : undefined
      }
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className={consoleButton({ variant: 'ghost' })}>
          Close
        </button>
      }
    >
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {error}
        </p>
      ) : null}
      {!detail && !error ? <StatePanel kind="loading" title="Loading the plan…" /> : null}
      {detail && plan ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={detail.plan.status === 'submitted' ? 'positive' : 'neutral'}>
              {detail.plan.status === 'submitted'
                ? `Submitted ${formatInstant(detail.plan.submittedAt, timezone)}`
                : 'Draft'}
            </StatusPill>
            <span className="text-xs text-corp-muted">
              Last changed {formatInstant(detail.plan.updatedAt, timezone)} · version{' '}
              {detail.plan.version}
            </span>
            {detail.snapshot ? (
              <div role="group" aria-label="Version" className="ml-auto flex gap-1">
                <button
                  type="button"
                  aria-pressed={view === 'current'}
                  onClick={() => setView('current')}
                  className={consoleButton({
                    variant: view === 'current' ? 'dark' : 'ghost',
                    size: 'sm',
                  })}
                >
                  Current
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'submitted'}
                  onClick={() => setView('submitted')}
                  className={consoleButton({
                    variant: view === 'submitted' ? 'dark' : 'ghost',
                    size: 'sm',
                  })}
                >
                  As submitted
                </button>
              </div>
            ) : null}
          </div>

          {detail.references.length > 0 ? (
            <section aria-label="Pre-event answers" className="border-l-4 border-corp-accent pl-3">
              <p className="font-semibold text-corp-ink">Before the conference</p>
              <dl className="mt-1 space-y-1">
                {detail.references.map((r) => (
                  <div key={r.questionKey}>
                    <dt className="text-xs text-corp-muted">{r.prompt}</dt>
                    <dd className="text-corp-text">{r.answer ?? 'No answer recorded.'}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {plan.actions.length === 0 ? (
            <p className="text-corp-muted">No action written yet.</p>
          ) : (
            <ol className="space-y-4">
              {plan.actions.map((a, i) => (
                <li key={a.id} className="border border-corp-line p-3">
                  <ActionSummary action={a} index={i} timezone={timezone} />
                </li>
              ))}
            </ol>
          )}

          <section aria-label="Reminders">
            <p className="font-semibold text-corp-ink">Reminders</p>
            <p className="text-corp-text">
              {reminderFrequencyLabels[detail.plan.reminder.frequency]}
              {detail.plan.reminder.startOn
                ? ` from ${formatDateShort(detail.plan.reminder.startOn)}`
                : ''}
              {detail.plan.reminder.nextReminderAt
                ? `; next ${formatInstant(detail.plan.reminder.nextReminderAt, timezone)}`
                : ''}
              . {detail.reminders.filter((r) => r.status === 'sent').length} sent.
            </p>
          </section>

          <details>
            <summary className="cursor-pointer font-semibold text-corp-green-text">
              History ({detail.history.length})
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-corp-muted">
              {detail.history.map((h, i) => (
                <li key={i}>
                  {formatInstant(h.at, timezone)} · {h.action.replace('transfer_plan.', '')}
                  {h.by ? ` · ${h.by}` : ''}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </Dialog>
  );
}

function ActionSummary({
  action,
  index,
  timezone,
}: {
  action: PlanActionView;
  index: number;
  timezone: string;
}) {
  const fields = Object.keys(planActionFieldLabels) as Array<keyof typeof planActionFieldLabels>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-corp-ink">
          {index + 1}. {action.action.trim() || 'No action written'}
        </p>
        {action.isPriority ? <StatusPill tone="positive">First priority</StatusPill> : null}
        <StatusPill tone="neutral">{actionProgressLabels[action.progressStatus]}</StatusPill>
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {fields
          .filter((f) => f !== 'action' && action[f])
          .map((f) => (
            <div key={f}>
              <dt className="text-xs text-corp-muted">{planActionFieldLabels[f].label}</dt>
              <dd className="text-corp-text">
                {f === 'startOn' || f === 'targetOn' || f === 'reviewOn'
                  ? formatDateShort(String(action[f]))
                  : String(action[f])}
              </dd>
            </div>
          ))}
      </dl>
      {action.progress.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-corp-green-text">
            Progress ({action.progress.length})
          </summary>
          <ul className="mt-1 space-y-1 text-xs text-corp-text">
            {action.progress.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{actionProgressLabels[p.status]}</span>{' '}
                <span className="text-corp-muted">{formatInstant(p.recordedAt, timezone)}</span>
                {p.note ? ` · ${p.note}` : ''}
                {p.newTargetOn ? ` · new target ${formatDateShort(p.newTargetOn)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
