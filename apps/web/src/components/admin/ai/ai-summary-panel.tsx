'use client';

import { AI_SUMMARY_TITLE, type AiSummaryView } from '@mbc/shared';
import { CopyIcon, Loader2Icon, SparklesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { consoleButton, Panel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface AiSummaryPanelProps {
  /** The stage's API address, e.g. /events/:id/assessments/pre_conference. */
  base: string;
  /** "?wave=2" or "" (round 1). */
  roundQuery: string;
  /** The batch the page's downloads cover; '' for everyone. */
  batch: string;
  batchName: string | null;
  /** Submitted responses now, to say when a summary is out of date. */
  submitted: number;
  timezone: string;
  readOnly?: boolean;
}

/** A query string with the round and the batch. */
function queryOf(roundQuery: string, batch: string) {
  const params = new URLSearchParams(roundQuery.replace(/^\?/, ''));
  if (batch) params.set('batch', batch);
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * The written summary of an assessment's results (2026-11-25): written by AI from the figures on
 * this page only (no names, emails or answers leave the platform), saved for the batch chosen
 * for downloads, and printed in that scope's PDF, Word and Excel exports.
 */
export function AiSummaryPanel({
  base,
  roundQuery,
  batch,
  batchName,
  submitted,
  timezone,
  readOnly,
}: AiSummaryPanelProps) {
  const [state, setState] = useState<{ enabled: boolean; summary: AiSummaryView | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = `${base}/ai-summary${queryOf(roundQuery, batch)}`;

  useEffect(() => {
    let live = true;
    apiFetch<{ enabled: boolean; summary: AiSummaryView | null }>(url).then(
      (r) => {
        if (!live) return;
        setError(null);
        setState(r);
      },
      () => live && setState({ enabled: false, summary: null }),
    );
    return () => {
      live = false;
    };
  }, [url]);

  if (!state || (!state.enabled && !state.summary)) return null;

  async function write() {
    setBusy(true);
    setError(null);
    try {
      setState(
        await apiFetch<{ enabled: boolean; summary: AiSummaryView | null }>(url, {
          method: 'POST',
          body: '{}',
        }),
      );
    } catch (e) {
      setError(describeError(e, 'The summary could not be written.').message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(summary: AiSummaryView) {
    const text = [summary.overview, '', ...summary.findings.map((f) => `• ${f}`)].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copying is not allowed in this browser; select the text instead.');
    }
  }

  const summary = state.summary;
  // The page's figures are for everyone; a batch's summary is not compared with them.
  const stale = !batch && summary !== null && summary.basedOn !== submitted;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-corporate text-sm font-semibold text-corp-ink">
            <SparklesIcon className="size-4 text-corp-accent-text" aria-hidden="true" />
            {AI_SUMMARY_TITLE}
            {batchName ? ` · ${batchName}` : ''}
          </h3>
          <p className="mt-1 text-xs text-corp-muted">
            Written from the figures above only: no names, emails or answers are sent. It is added
            to the PDF, Word and Excel downloads{batchName ? ' of this batch' : ''}.
          </p>
        </div>
        {state.enabled && !readOnly ? (
          <button
            type="button"
            disabled={busy || submitted === 0}
            onClick={() => void write()}
            className={consoleButton({ variant: summary ? 'ghost' : 'accent', size: 'sm' })}
          >
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <SparklesIcon aria-hidden="true" />
            )}
            {busy ? 'Writing…' : summary ? 'Write again' : 'Write a summary'}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      {submitted === 0 && !summary ? (
        <p className="mt-2 text-sm text-corp-muted">
          A summary can be written once the first response is submitted.
        </p>
      ) : null}
      {summary ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-corp-text">{summary.overview}</p>
          {summary.findings.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-corp-text">
              {summary.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-corp-muted">
              Written {formatInstant(summary.generatedAt, timezone)} from {summary.basedOn}{' '}
              submitted response{summary.basedOn === 1 ? '' : 's'}.
              {stale ? ` There are ${submitted} now: write it again to include them.` : ''}
            </p>
            <button
              type="button"
              onClick={() => void copy(summary)}
              className={consoleButton({ variant: 'ghost', size: 'sm' })}
            >
              <CopyIcon aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
