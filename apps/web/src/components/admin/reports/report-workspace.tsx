'use client';

import {
  participationModes,
  reportDefaultSections,
  reportKindMeta,
  reportSectionLabels,
  reportSections,
  type EventReport,
  type ReportKind,
  type ReportSection,
} from '@mbc/shared';
import { DownloadIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { consoleButton, Panel, StatePanel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch, apiUrl } from '@/lib/api';
import { describeError } from '@/lib/imports';

import { ReportView } from './report-view';

interface Props {
  eventId: string;
  timezone: string;
  /** The report kinds this workspace offers; the first is the one it opens with. */
  kinds: readonly ReportKind[];
  readOnly?: boolean;
}

/**
 * What has been loaded, and for which report. `for` is the kind and query it answers, so a
 * change of filters shows the loading state again without the effect having to reset it.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; for: string; report: EventReport }
  | { kind: 'error'; for: string; message: string; requestId?: string };

const formatLabels: Record<(typeof participationModes)[number], string> = {
  physical: 'In person only',
  virtual: 'Online only',
};

/**
 * The organisers' reporting workspace (task of 2026-10-31, §2, §4, §6): choose the report, the
 * delegates and the period, choose which sections it carries, read it, record M.Bryan's approval
 * for an external audience, and download it. Nothing is ever sent anywhere: an approved report is
 * a file the organisers then share themselves.
 */
export function ReportWorkspace({ eventId, timezone, kinds, readOnly = false }: Props) {
  const [kind, setKind] = useState<ReportKind>(kinds[0]!);
  const [sections, setSections] = useState<ReportSection[]>([...reportDefaultSections[kinds[0]!]]);
  const [format, setFormat] = useState<'' | (typeof participationModes)[number]>('');
  const [organisation, setOrganisation] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [organisations, setOrganisations] = useState<Array<{ name: string; nominees: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const id = useId();
  const meta = reportKindMeta[kind];
  const needsOrganisation = kind === 'organisation';

  const query = useMemo(() => {
    const params = new URLSearchParams();
    const chosen = reportSections.filter((s) => sections.includes(s));
    if (chosen.join(',') !== reportDefaultSections[kind].join(',')) {
      params.set('sections', chosen.join(','));
    }
    if (format) params.set('format', format);
    if (organisation) params.set('organisation', organisation);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [sections, kind, format, organisation, from, to]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    apiFetch<{ organisations: Array<{ name: string; nominees: number }> }>(
      `/events/${eventId}/reports/organisations`,
    ).then(
      (r) => setOrganisations(r.organisations),
      () => setOrganisations([]),
    );
  }, [eventId]);

  // An organisation report needs its organisation before anything can be built.
  const awaitingOrganisation = needsOrganisation && !organisation;

  /** The report the state must answer to count as loaded. */
  const signature = `${kind}${query}`;

  useEffect(() => {
    if (awaitingOrganisation) return;
    let cancelled = false;
    apiFetch<{ report: EventReport }>(`/events/${eventId}/reports/${kind}${query}`).then(
      (r) => {
        if (!cancelled) setState({ kind: 'ready', for: signature, report: r.report });
      },
      (e: unknown) => {
        if (!cancelled) {
          const failure = describeError(e, 'The report could not be built.');
          setState({
            kind: 'error',
            for: signature,
            message: failure.message,
            requestId: failure.requestId,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, kind, query, signature, attempt, awaitingOrganisation]);

  function chooseKind(next: ReportKind) {
    setKind(next);
    setSections([...reportDefaultSections[next]]);
    setNotice(null);
  }

  async function approve() {
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch(`/events/${eventId}/reports/${kind}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          organisation: needsOrganisation ? organisation : undefined,
          sections: reportSections.filter((s) => sections.includes(s)),
          note,
        }),
      });
      setNote('');
      setNotice(
        'Approved for sharing. The download is now available; the platform sends nothing itself.',
      );
      refresh();
    } catch (e) {
      setNotice(describeError(e, 'The approval could not be recorded.').message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch(`/events/${eventId}/reports/${kind}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ organisation: needsOrganisation ? organisation : '' }),
      });
      setNotice('Approval withdrawn. The report cannot be downloaded until it is approved again.');
      refresh();
    } catch (e) {
      setNotice(describeError(e, 'The approval could not be withdrawn.').message);
    } finally {
      setBusy(false);
    }
  }

  // Only state that answers the report now on screen counts; anything else is still loading.
  const current = state.kind !== 'loading' && state.for === signature ? state : null;
  const report = !awaitingOrganisation && current?.kind === 'ready' ? current.report : null;
  const downloadable = !report?.approval?.required || report.approval.covers;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="space-y-4">
          {kinds.length > 1 ? (
            <div
              role="tablist"
              aria-label="Report"
              className="-mx-gutter flex gap-1 overflow-x-auto px-gutter md:mx-0 md:px-0"
            >
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => chooseKind(k)}
                  className={consoleButton({ variant: kind === k ? 'dark' : 'ghost', size: 'sm' })}
                >
                  {reportKindMeta[k].label}
                </button>
              ))}
            </div>
          ) : null}
          <div>
            <p className="font-semibold text-corp-ink">{meta.label}</p>
            <p className="text-sm text-corp-muted">{meta.description}</p>
            {meta.audience === 'external' ? (
              <p className="mt-1 text-xs text-brand-danger">
                External audience: aggregates only, and M.Bryan must approve it before it can be
                downloaded or shared.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label htmlFor={`${id}-format`} className="text-sm font-semibold text-corp-ink">
                Attendance format
              </label>
              <NativeSelect
                id={`${id}-format`}
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
                className="rounded-none border-corp-line"
              >
                <option value="">Every delegate</option>
                {participationModes.map((m) => (
                  <option key={m} value={m}>
                    {formatLabels[m]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-org`} className="text-sm font-semibold text-corp-ink">
                Nominating organisation
              </label>
              <NativeSelect
                id={`${id}-org`}
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                className="rounded-none border-corp-line"
              >
                <option value="">{needsOrganisation ? 'Choose one…' : 'Every organisation'}</option>
                {organisations.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name} ({o.nominees})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-from`} className="text-sm font-semibold text-corp-ink">
                Period from
              </label>
              <input
                id={`${id}-from`}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-to`} className="text-sm font-semibold text-corp-ink">
                Period to
              </label>
              <input
                id={`${id}-to`}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-corp-muted">
            The period applies to progress records, measure results, evidence and follow-up
            responses. Participation and event-time results cover the whole event.
          </p>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-corp-ink">Sections to include</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {reportSections.map((s) => (
                <label key={s} className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
                  <input
                    type="checkbox"
                    checked={sections.includes(s)}
                    onChange={(e) =>
                      setSections((list) =>
                        e.target.checked ? [...list, s] : list.filter((x) => x !== s),
                      )
                    }
                    className="size-5 shrink-0 accent-corp-green"
                  />
                  {reportSectionLabels[s]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className={consoleButton({ variant: 'secondary', size: 'sm' })}
            >
              <RefreshCwIcon aria-hidden="true" /> Refresh
            </button>
            {report && downloadable ? (
              <>
                <a
                  href={apiUrl(`/events/${eventId}/reports/${kind}/export.md${query}`)}
                  className={consoleButton({ variant: 'ghost', size: 'sm' })}
                >
                  <DownloadIcon aria-hidden="true" /> Download the report
                </a>
                <a
                  href={apiUrl(`/events/${eventId}/reports/${kind}/export.csv${query}`)}
                  className={consoleButton({ variant: 'ghost', size: 'sm' })}
                >
                  <DownloadIcon aria-hidden="true" /> Download the figures (CSV)
                </a>
              </>
            ) : null}
            {report?.approval?.required ? (
              <StatusPill tone={report.approval.covers ? 'positive' : 'attention'}>
                {report.approval.covers ? 'Approved for sharing' : 'Not approved'}
              </StatusPill>
            ) : null}
          </div>

          {report?.approval?.required && !readOnly ? (
            <div className="space-y-2 border-t border-corp-line pt-3">
              <p className="text-sm font-semibold text-corp-ink">Review before sharing</p>
              <p className="text-xs text-corp-muted">
                Read the report below, then record the approval. It covers exactly the sections
                ticked above{needsOrganisation && organisation ? ` for ${organisation}` : ''};
                changing them needs a fresh approval. The platform never publishes or emails a
                report.
              </p>
              <div className="space-y-1">
                <label htmlFor={`${id}-note`} className="text-sm font-semibold text-corp-ink">
                  What was agreed (optional)
                </label>
                <input
                  id={`${id}-note`}
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="For example: agreed with the organisation on 1 December"
                  className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    busy || !report || (needsOrganisation && !organisation) || sections.length === 0
                  }
                  onClick={() => void approve()}
                  className={consoleButton({ variant: 'accent', size: 'sm' })}
                >
                  {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                  Approve these sections for sharing
                </button>
                {report.approval.current ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke()}
                    className={consoleButton({ variant: 'secondary', size: 'sm' })}
                  >
                    Withdraw the approval
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
        </div>
      </Panel>

      {awaitingOrganisation ? (
        <StatePanel
          kind="empty"
          title="Choose the organisation"
          description="An organisation report is for one nominating organisation. Choose which one above; it is then built from that organisation’s nominees only."
        />
      ) : null}
      {!awaitingOrganisation && !current ? (
        <StatePanel kind="loading" title="Building the report…" />
      ) : null}
      {!awaitingOrganisation && current?.kind === 'error' ? (
        <StatePanel
          kind="error"
          title="Report unavailable"
          description={current.message}
          requestId={current.requestId}
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
      ) : null}
      {report ? <ReportView report={report} timezone={timezone} /> : null}
    </div>
  );
}
