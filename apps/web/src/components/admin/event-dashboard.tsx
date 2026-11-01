'use client';

import type { EventDashboard as Dashboard } from '@mbc/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { consoleButton, Panel, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant, stageLabels, stageStatusLabels, stageWhen } from '@/lib/events';
import { describeError } from '@/lib/imports';

import { ReportWorkspace } from './reports/report-workspace';

interface EventDashboardProps {
  eventId: string;
  timezone: string;
}

const statusLabels: Record<keyof Dashboard['delegates']['byStatus'], string> = {
  active: 'Active',
  pending: 'Pending',
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
  test: 'Test',
};

const windowText: Record<Dashboard['stages'][number]['window'], string> = {
  hidden: 'Not shown to delegates',
  upcoming: 'Opens later',
  open: 'Open to delegates',
  closed: 'Closed',
};

/**
 * The event's dashboard (task of 2026-10-31, §2): the whole reporting document, from delegate
 * participation to expectations and results, with the filters of §6. Underneath it, the two
 * things that belong to running the event rather than reporting on it: how the registrations
 * stand, the messages sent, and the way in to each assessment stage.
 */
export function EventDashboard({ eventId, timezone }: EventDashboardProps) {
  return (
    <div className="space-y-8">
      <ReportWorkspace eventId={eventId} timezone={timezone} kinds={['dashboard']} />
      <EventAdminPanels eventId={eventId} timezone={timezone} />
    </div>
  );
}

/** Registrations by status, the messages sent, and a link into every assessment stage. */
function EventAdminPanels({ eventId, timezone }: EventDashboardProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ dashboard: Dashboard }>(`/events/${eventId}/dashboard`).then(
      (r) => {
        if (!cancelled) setDashboard(r.dashboard);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The event panels could not be loaded.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-brand-danger">
        {error}
      </p>
    );
  }
  if (!dashboard) return null;
  const { delegates, stages, messages, event } = dashboard;

  return (
    <div className="space-y-6">
      <section aria-labelledby="dashboard-stages" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="dashboard-stages" className="font-corporate text-h3 text-corp-ink">
            Assessment configuration
          </h2>
          <Link
            href={`/admin/events/${event.id}`}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            Configure stages
          </Link>
        </div>
        <div className="grid gap-3 xl:grid-cols-4">
          {stages.map((s) => (
            <Panel key={s.stage}>
              <article aria-label={stageLabels[s.stage]} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="neutral">{stageWhen[s.stage]}</StatusPill>
                  <StatusPill tone={s.enabled ? 'positive' : 'neutral'}>
                    {s.enabled ? stageStatusLabels[s.status] : 'Disabled'}
                  </StatusPill>
                  {s.enabled ? (
                    <StatusPill tone={s.window === 'open' ? 'positive' : 'attention'}>
                      {windowText[s.window]}
                    </StatusPill>
                  ) : null}
                </div>
                <h3 className="font-corporate text-base font-semibold text-corp-ink">
                  {stageLabels[s.stage]}
                </h3>
                <p className="text-xs text-corp-muted">
                  {s.enabled
                    ? `${formatInstant(s.opensAt, timezone)} to ${formatInstant(s.closesAt, timezone)} · ${s.questions} question${s.questions === 1 ? '' : 's'}`
                    : 'Not used for this event'}
                </p>
                <Link
                  href={`/admin/events/${event.id}/assessments/${s.stage}`}
                  className={consoleButton({ variant: 'secondary', size: 'sm' })}
                >
                  Questions and submissions
                </Link>
              </article>
            </Panel>
          ))}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <h2 className="font-corporate text-sm font-semibold text-corp-ink">
            Registrations by status
          </h2>
          <dl
            aria-label="Registrations by status"
            className="mt-2 divide-y divide-corp-line text-sm"
          >
            {(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((key) => (
              <div key={key} className="flex items-center justify-between py-1.5">
                <dt className="text-corp-text">{statusLabels[key]}</dt>
                <dd className="font-semibold text-corp-ink tabular-nums">
                  {delegates.byStatus[key] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-corp-muted">
            Only active registrations (and test ones where the platform allows them) are counted in
            the report above; cancelled, pending and duplicate registrations are excluded
            everywhere.
          </p>
        </Panel>
        <Panel>
          <h2 className="font-corporate text-sm font-semibold text-corp-ink">Messages</h2>
          <dl aria-label="Messages" className="mt-2 divide-y divide-corp-line text-sm">
            {(
              [
                ['Messages sent', messages.sent],
                ['Recipients', messages.recipients],
                ['Delivered', messages.delivered],
                ['Failed', messages.failed],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-1.5">
                <dt className="text-corp-text">{label}</dt>
                <dd className="font-semibold text-corp-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-corp-muted">
            {messages.last
              ? `Last: “${messages.last.subject}”, ${formatInstant(messages.last.createdAt, timezone)}.`
              : 'No message sent yet.'}
          </p>
        </Panel>
      </div>
    </div>
  );
}
