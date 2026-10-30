import { assessmentStages, type AssessmentStage } from '@mbc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StageWorkspace } from '@/components/admin/event-setup/stage-workspace';
import { AdminContent, AdminPageHeader, StatusPill } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { loadAdminEvent } from '@/lib/admin-events';
import { formatInstant, stageLabels, stagePurpose, stageStatusLabels } from '@/lib/events';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Assessment stage' };

/** One assessment stage of an event: its questions and its submissions, on a page of its own. */
export default async function StagePage({
  params,
}: {
  params: Promise<{ eventId: string; stage: string }>;
}) {
  const { eventId, stage } = await params;
  if (!(assessmentStages as readonly string[]).includes(stage)) notFound();
  const stageKey = stage as AssessmentStage;
  const session = await getSession();
  const access = importsAccess(session);
  const event = access === 'allowed' ? await loadAdminEvent(eventId) : null;
  if (access === 'allowed' && !event) notFound();
  const view = event?.assessmentStages.find((s) => s.stage === stageKey) ?? null;

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[
          { label: 'Overview', href: '/admin' },
          { label: 'Events', href: '/admin/events' },
          { label: event?.name ?? 'Event', href: event ? `/admin/events/${event.id}` : undefined },
          { label: stageLabels[stageKey] },
        ]}
        eyebrow={event ? `${event.name} · ${event.code}` : undefined}
        title={stageLabels[stageKey]}
        description={stagePurpose[stageKey]}
        meta={
          event && view ? (
            <>
              <StatusPill tone={view.enabled ? 'positive' : 'neutral'}>
                {view.enabled ? stageStatusLabels[view.status] : 'Disabled'}
              </StatusPill>
              <StatusPill tone={view.questionCount > 0 ? 'positive' : 'attention'}>
                {view.questionCount} question{view.questionCount === 1 ? '' : 's'}
              </StatusPill>
              <span className="text-xs text-corp-muted">
                {formatInstant(view.opensAt, event.timezone)} to{' '}
                {formatInstant(view.closesAt, event.timezone)}
              </span>
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
          <StageWorkspace event={event} stage={stageKey} />
        )}
      </AdminContent>
    </>
  );
}
