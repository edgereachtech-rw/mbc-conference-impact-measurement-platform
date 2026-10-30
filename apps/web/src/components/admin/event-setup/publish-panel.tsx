'use client';

import { eventPublishIssues, type EventDetail, type EventStatus } from '@mbc/shared';
import { CheckCircle2Icon, CircleAlertIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';

import { consoleButton, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { eventStatusLabels, formatDateShort, stageLabels } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface PublishPanelProps {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}

/** Review and publication (brief section 7.5): what is set, what blocks publishing, and the status actions. */
export function PublishPanel({ event, onSaved }: PublishPanelProps) {
  const [busy, setBusy] = useState<EventStatus | null>(null);
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const issues = eventPublishIssues(event);
  const enabledStages = event.assessmentStages.filter((s) => s.enabled);

  async function setStatus(status: EventStatus) {
    setBusy(status);
    setFailure(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      onSaved(result.event);
    } catch (e) {
      setFailure(describeError(e, 'The status could not be changed.'));
    } finally {
      setBusy(null);
    }
  }

  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    {
      label: 'Event dates',
      value: event.dates.length
        ? event.dates.map((d) => formatDateShort(d.date)).join(', ')
        : 'None selected',
      ok: event.dates.length > 0,
    },
    {
      label: 'Venue',
      value: event.location ?? (event.format === 'virtual' ? 'Online event' : 'Not set'),
      ok: Boolean(event.location) || event.format === 'virtual',
    },
    {
      label: 'Sessions',
      value: event.sessions.length
        ? `${event.sessions.length} scheduled`
        : 'None (sessions are optional)',
      ok: true,
    },
    {
      label: 'Assessment stages',
      value: enabledStages.length
        ? enabledStages.map((s) => stageLabels[s.stage]).join(', ')
        : 'None enabled (allowed)',
      ok: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-corp-text">Current status</span>
        <StatusPill tone={event.status === 'active' ? 'positive' : 'neutral'}>
          {eventStatusLabels[event.status]}
        </StatusPill>
      </div>
      <ul
        className="divide-y divide-corp-line rounded-none border border-corp-line bg-white"
        aria-label="Review"
      >
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-3 p-4">
            {row.ok ? (
              <CheckCircle2Icon
                className="mt-0.5 size-5 shrink-0 text-corp-green-text"
                aria-hidden="true"
              />
            ) : (
              <CircleAlertIcon
                className="mt-0.5 size-5 shrink-0 text-brand-danger"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-corp-ink">{row.label}</p>
              <p className="text-sm text-corp-text">{row.value}</p>
            </div>
          </li>
        ))}
      </ul>
      {issues.length ? (
        <div
          role="alert"
          className="rounded-none border border-brand-danger/40 bg-white p-4 text-sm"
        >
          <p className="font-semibold text-brand-danger">Before publishing</p>
          <ul className="mt-1 list-disc pl-5 text-corp-text">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="rounded-none border border-brand-danger/40 bg-white p-3 text-sm"
        >
          <p className="font-semibold text-brand-danger">{failure.message}</p>
          {failure.requestId ? (
            <p className="mt-1 text-xs text-corp-muted">Request id {failure.requestId}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {event.status === 'draft' ? (
          <button
            type="button"
            disabled={busy !== null || issues.length > 0}
            onClick={() => void setStatus('active')}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy === 'active' ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Publish event
          </button>
        ) : null}
        {event.status === 'active' ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setStatus('draft')}
            className={consoleButton({ variant: 'secondary' })}
          >
            Unpublish (back to draft)
          </button>
        ) : null}
        {event.status !== 'archived' ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setStatus('archived')}
            className={consoleButton({ variant: 'ghost' })}
          >
            Archive event
          </button>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setStatus('draft')}
            className={consoleButton({ variant: 'secondary' })}
          >
            Restore to draft
          </button>
        )}
      </div>
      <p className="text-xs text-corp-muted">
        Published events are visible to their delegates in My Events and can receive imports and
        messages. Archived events are read-only and hidden from delegates.
      </p>
    </div>
  );
}
