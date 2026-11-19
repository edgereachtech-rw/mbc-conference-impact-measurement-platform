import { assessmentStages, type AssessmentStage } from '@mbc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StageWorkspace } from '@/components/admin/event-setup/stage-workspace';
import { AdminContent, AdminPageHeader, StatusPill } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { loadAdminEvent } from '@/lib/admin-events';
import {
  formatInstant,
  stageLabels,
  stagePurpose,
  stageStatusLabels,
  targetLabels,
} from '@/lib/events';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Assessment stage' };

/** One assessment stage of an event: its questions and its submissions, on a page of its own. */
export default async function StagePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; stage: string }>;
  searchParams: Promise<{ wave?: string }>;
}) {
  const [{ eventId, stage }, query] = await Promise.all([params, searchParams]);
  if (!(assessmentStages as readonly string[]).includes(stage)) notFound();
  const stageKey = stage as AssessmentStage;
  const selectedWave =
    stageKey === 'follow_up' ? Math.max(1, Math.min(4, Number(query.wave) || 1)) : 1;
  const session = await getSession();
  const access = importsAccess(session);
  const event = access === 'allowed' ? await loadAdminEvent(eventId) : null;
  if (access === 'allowed' && !event) notFound();
  const view =
    event?.assessmentStages.find((s) => s.stage === stageKey && s.wave === selectedWave) ?? null;
  const heading =
    stageKey === 'follow_up'
      ? view?.waveLabel || `Follow-up round ${selectedWave}`
      : stageLabels[stageKey];

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[
          { label: 'Overview', href: '/admin' },
          { label: 'Events', href: '/admin/events' },
          { label: event?.name ?? 'Event', href: event ? `/admin/events/${event.id}` : undefined },
          { label: heading },
        ]}
        eyebrow={event ? `${event.name} · ${event.code}` : undefined}
        title={heading}
        description={
          stageKey === 'follow_up'
            ? `Wave ${selectedWave} · ${
                stagePurpose[stageKey] || 'Post-conference follow-up questions and responses.'
              }`
            : stagePurpose[stageKey] || undefined
        }
        meta={
          event && view ? (
            <>
              <StatusPill tone={view.enabled ? 'positive' : 'neutral'}>
                {view.enabled ? stageStatusLabels[view.status] : 'Disabled'}
              </StatusPill>
              <StatusPill tone={view.questionCount > 0 ? 'positive' : 'attention'}>
                {view.questionCount} question{view.questionCount === 1 ? '' : 's'}
              </StatusPill>
              {stageKey === 'follow_up' ? (
                <StatusPill tone="neutral">
                  {view.enabled ? 'Enabled' : 'Draft'} · {view.reminderLimit} reminder
                  {view.reminderLimit === 1 ? '' : 's'}
                </StatusPill>
              ) : null}
              <span className="text-xs text-corp-muted">
                {view.dueAfterDays !== null ? `${view.dueAfterDays} days after the event · ` : ''}
                {formatInstant(view.opensAt, event.timezone)} to{' '}
                {formatInstant(view.closesAt, event.timezone)}
              </span>
              {stageKey === 'follow_up' ? (
                <span className="text-xs text-corp-muted">
                  {targetLabels[view.target]}
                  {view.targetGroup ? ` · ${view.targetGroup}` : ''} · Reminders
                  {view.reminderAfterDays === null
                    ? ' not scheduled'
                    : ` after ${view.reminderAfterDays} days, up to ${view.reminderLimit}`}
                </span>
              ) : null}
            </>
          ) : null
        }
        actions={
          event ? (
            <Link
              href={`/admin/events/${event.id}`}
              className={consoleButton({ variant: 'secondary' })}
            >
              Back to the event
            </Link>
          ) : null
        }
      />
      <AdminContent>
        {access !== 'allowed' || !event ? (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">Admins only</p>
            <p className="mt-1 text-sm">Assessments are managed by M.Bryan admins.</p>
          </div>
        ) : (
          <StageWorkspace event={event} stage={stageKey} wave={selectedWave} />
        )}
      </AdminContent>
    </>
  );
}
