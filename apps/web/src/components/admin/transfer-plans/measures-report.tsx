'use client';

import {
  actionProgressLabels,
  compareMeasure,
  evidenceSupportLabels,
  evidenceSupports,
  evidenceTypeLabels,
  improvementDirectionLabels,
  measureKindLabels,
  measureOutcomeLabels,
  measureStatusLabels,
  measureSummaries,
  measureSummaryLabels,
  type MeasureReportRow,
  type MeasureSummary,
} from '@mbc/shared';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { EvidenceLine, MeasureLine } from '@/components/account/measures-evidence';
import {
  consoleButton,
  Panel,
  StatePanel,
  StatusPill,
  TableScroll,
} from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

interface MeasuresReportProps {
  eventId: string;
  slug: string;
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Measures and evidence across every planned action of the event (backlog E14-4, E16-6,
 * S13.3). Each row is one action: what its measures say, each measure read in its own unit
 * and direction, and how many evidence records are self-reported or supported by another
 * source. Evidence text stays out of the table and the CSV until the admin loads it, which
 * the API audits. Nothing here calls a result verified or infers business impact from a plan.
 */
export function MeasuresReport({ eventId, slug }: MeasuresReportProps) {
  const [rows, setRows] = useState<MeasureReportRow[] | null>(null);
  const [withEvidence, setWithEvidence] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [filter, setFilter] = useState<'all' | MeasureSummary>('all');
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ rows: MeasureReportRow[] }>(`/events/${eventId}/transfer-plans/measures`).then(
      (r) => {
        if (cancelled) return;
        setRows(r.rows);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The measures could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function loadEvidence() {
    setLoadingEvidence(true);
    try {
      const r = await apiFetch<{ rows: MeasureReportRow[] }>(
        `/events/${eventId}/transfer-plans/measures?evidence=true`,
      );
      setRows(r.rows);
      setWithEvidence(true);
      setError(null);
    } catch (e) {
      setError(describeError(e, 'The evidence could not be loaded.'));
    } finally {
      setLoadingEvidence(false);
    }
  }

  if (error && !rows) {
    return (
      <StatePanel
        kind="error"
        title="Measures unavailable"
        description={error.message}
        requestId={error.requestId}
      />
    );
  }
  if (!rows) return <StatePanel kind="loading" title="Loading measures…" />;

  const counts = Object.fromEntries(measureSummaries.map((s) => [s, 0])) as Record<
    MeasureSummary,
    number
  >;
  const evidence = Object.fromEntries(evidenceSupports.map((s) => [s, 0])) as Record<
    (typeof evidenceSupports)[number],
    number
  >;
  for (const r of rows) {
    counts[r.summary] += 1;
    for (const s of evidenceSupports) evidence[s] += r.evidence[s] ?? 0;
  }
  const shown = rows.filter((r) => filter === 'all' || r.summary === filter);

  function exportCsv() {
    const header = [
      'Delegate',
      'Organisation',
      'Plan status',
      'Action',
      'First priority',
      'Progress',
      'Measures summary',
      'Measure status',
      'Measure',
      'Why it matters',
      'Kind',
      'Unit',
      'Direction of improvement',
      'Baseline',
      'Baseline date',
      'Target',
      'Target date',
      'Actual result',
      'Actual result date',
      'Reading',
      'Result support',
      'Information source',
      'Other influencing factors',
      'Evidence self-reported (count)',
      'Evidence supported by another source (count)',
      ...(withEvidence ? ['Evidence'] : []),
    ];
    const lines: string[] = [];
    for (const r of shown) {
      const base = [
        r.delegate.name,
        r.delegate.organisation,
        r.planStatus,
        r.action.action,
        r.action.isPriority ? 'yes' : 'no',
        actionProgressLabels[r.action.progressStatus],
        measureSummaryLabels[r.summary],
      ];
      const tail = [
        r.evidence.self_reported ?? 0,
        r.evidence.supported ?? 0,
        ...(withEvidence
          ? [
              (r.evidenceRecords ?? [])
                .map(
                  (e) =>
                    `${evidenceTypeLabels[e.type]} (${evidenceSupportLabels[e.support]}${e.evidenceOn ? `, ${e.evidenceOn}` : ''}): ${e.description}${e.reference ? ` [${e.reference}]` : ''}`,
                )
                .join(' | '),
            ]
          : []),
      ];
      const measures = r.measures.length > 0 ? r.measures : [null];
      for (const m of measures) {
        const comparison = m ? compareMeasure(m) : null;
        lines.push(
          [
            ...base,
            m ? measureStatusLabels[m.status] : '',
            m?.name,
            m?.importance,
            m ? measureKindLabels[m.kind] : '',
            m?.unit,
            m ? improvementDirectionLabels[m.direction] : '',
            m?.baselineValue,
            m?.baselineOn,
            m?.targetValue,
            m?.targetOn,
            m?.actualValue,
            m?.actualOn,
            comparison
              ? comparison.outcome === 'not_comparable'
                ? `${measureOutcomeLabels.not_comparable}: ${comparison.reason ?? ''}`
                : measureOutcomeLabels[comparison.outcome]
              : '',
            m ? evidenceSupportLabels[m.support] : '',
            m?.source,
            m?.influences,
            ...tail,
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-measures-and-evidence.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel flush>
      <div className="space-y-3 border-b border-corp-line p-4">
        <div>
          <h3 className="font-semibold text-corp-ink">Measures and evidence</h3>
          <p className="mt-1 text-sm text-corp-muted">
            One row per planned action. Results are read in each measure’s own unit and direction of
            improvement; a lower value counts as better where the delegate said so. Everything is
            self-reported unless a result or an evidence record is marked “supported by another
            source”, and neither label means independently verified. A planned action or a
            self-reported result is not evidence of business impact.
          </p>
        </div>
        <dl className="grid gap-2 text-xs text-corp-text sm:grid-cols-3">
          {measureSummaries.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between gap-2 border border-corp-line px-2 py-1"
            >
              <dt>{measureSummaryLabels[s]}</dt>
              <dd className="font-semibold text-corp-ink">{counts[s]}</dd>
            </div>
          ))}
          {evidenceSupports.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between gap-2 border border-corp-line px-2 py-1"
            >
              <dt>Evidence {evidenceSupportLabels[s].toLowerCase()}</dt>
              <dd className="font-semibold text-corp-ink">{evidence[s]}</dd>
            </div>
          ))}
        </dl>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-brand-danger">
            {error.message}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="space-y-1 md:w-64">
            <label htmlFor={`${id}-filter`} className="text-sm font-semibold text-corp-ink">
              Actions whose measures are
            </label>
            <NativeSelect
              id={`${id}-filter`}
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-none border-corp-line"
            >
              <option value="all">Any</option>
              {measureSummaries.map((s) => (
                <option key={s} value={s}>
                  {measureSummaryLabels[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {!withEvidence ? (
            <button
              type="button"
              disabled={loadingEvidence}
              onClick={() => void loadEvidence()}
              className={consoleButton({ variant: 'secondary' })}
            >
              {loadingEvidence ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              Load evidence text
            </button>
          ) : (
            <p className="text-xs text-corp-muted md:self-center">
              Evidence text is shown and goes into the export. Loading it was recorded in the audit
              log.
            </p>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={shown.length === 0}
            className={consoleButton({ variant: 'ghost' })}
          >
            <DownloadIcon aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="p-4 text-sm text-corp-muted">
          {rows.length === 0 ? 'No planned action yet.' : 'No action matches this filter.'}
        </p>
      ) : (
        <TableScroll>
          <table className="w-full text-sm">
            <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              <tr>
                <th className="px-4 py-2">Delegate</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Measures</th>
                <th className="px-4 py-2">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-corp-line">
              {shown.map((r) => (
                <tr key={r.action.id} className="align-top">
                  <td className="px-4 py-2">
                    <p className="font-semibold text-corp-ink">{r.delegate.name}</p>
                    <p className="text-xs text-corp-muted">{r.delegate.organisation ?? '—'}</p>
                  </td>
                  <td className="max-w-xs px-4 py-2 text-corp-text">
                    <p>{r.action.action.trim() || 'No action written'}</p>
                    <p className="mt-1 flex flex-wrap gap-1 text-xs">
                      {r.action.isPriority ? (
                        <StatusPill tone="positive">First priority</StatusPill>
                      ) : null}
                      <StatusPill tone="neutral">
                        {actionProgressLabels[r.action.progressStatus]}
                      </StatusPill>
                    </p>
                  </td>
                  <td className="max-w-md px-4 py-2">
                    <StatusPill tone={r.summary === 'with_result' ? 'positive' : 'neutral'}>
                      {measureSummaryLabels[r.summary]}
                    </StatusPill>
                    {r.measures.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {r.measures.map((m) => (
                          <li key={m.id}>
                            <MeasureLine measure={m} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="max-w-md px-4 py-2 text-xs text-corp-text">
                    {evidenceSupports
                      .filter((s) => (r.evidence[s] ?? 0) > 0)
                      .map((s) => `${r.evidence[s]} ${evidenceSupportLabels[s].toLowerCase()}`)
                      .join(' · ') || 'None'}
                    {r.evidenceRecords && r.evidenceRecords.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {r.evidenceRecords.map((e) => (
                          <li key={e.id}>
                            <EvidenceLine record={e} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
