import { waveLabel } from '@mbc/shared';
import type { PgBoss } from 'pg-boss';

import type { PrismaClient } from '../db.js';
import type { Logger } from '../lib/logger.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderFollowUpInvitation } from '../mail/templates/index.js';

export interface FollowUpInvitationDeps {
  prisma: () => PrismaClient;
  mailer: Mailer;
  mailConfig: MailConfig;
  /** Base URL of the web app, for the link to the form. */
  appUrl: string;
  logger: Logger;
  now?: () => Date;
  /** Whether a registration with status `test` is eligible, as everywhere else. */
  allowTestRegistrations?: boolean;
}

export const FOLLOW_UP_INVITATION_JOB = 'follow-up-invitations';

/** How many emails one pass will send, so a large event spreads over several runs. */
const BATCH = 200;

const dayInMs = 86_400_000;

/**
 * Sends the follow-up invitations and chasers that are due (backlog E12-14).
 *
 * A wave invites everyone eligible once its opening time has passed, and chases whoever has not
 * submitted every `reminderAfterDays` up to `reminderLimit` times. Both are driven by rows in
 * `assessment_invitation`, written before the send: that row is the record of what was sent and
 * the lock that stops it being sent twice, so a crash part-way through a batch never doubles up.
 *
 * A wave that is a draft, disabled, closed or without questions sends nothing — the same gate the
 * screens apply, so scheduling a wave is never the thing that starts emailing people.
 */
export async function sendDueFollowUpInvitations(deps: FollowUpInvitationDeps) {
  const at = (deps.now ?? (() => new Date()))();
  const prisma = deps.prisma();
  const statuses = deps.allowTestRegistrations
    ? (['active', 'test'] as const)
    : (['active'] as const);

  const waves = await prisma.assessmentStageConfig.findMany({
    where: {
      stage: 'follow_up',
      enabled: true,
      status: { in: ['scheduled', 'open'] },
      opensAt: { lte: at },
      OR: [{ closesAt: null }, { closesAt: { gt: at } }],
      event: { status: 'active' },
      questions: { some: { retiredAt: null } },
    },
    include: {
      event: {
        select: {
          id: true,
          name: true,
          startsOn: true,
          endsOn: true,
          timezone: true,
          location: true,
        },
      },
    },
    orderBy: { wave: 'asc' },
  });

  let invited = 0;
  let reminded = 0;
  let failed = 0;

  for (const wave of waves) {
    const label = waveLabel('follow_up', wave.wave, wave.dueAfterDays);
    const branding = brandingForEvent(deps.mailConfig, wave.event);
    const formUrl = `${deps.appUrl.replace(/\/$/, '')}/account/events/${wave.event.id}#assessment-follow_up-${wave.wave}`;
    const deadline = wave.closesAt
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: wave.event.timezone,
        }).format(wave.closesAt)
      : undefined;

    async function send(
      delegate: { id: string; name: string; email: string },
      kind: 'invitation' | 'reminder',
      sequence: number,
      scheduledFor: Date,
    ) {
      // The row first: it is the lock. A duplicate key means another pass already has this one.
      try {
        await prisma.assessmentInvitation.create({
          data: {
            stageConfigId: wave.id,
            delegateId: delegate.id,
            kind,
            sequence,
            scheduledFor,
            status: 'sending',
          },
        });
      } catch {
        return false;
      }
      const rendered = renderFollowUpInvitation(branding, {
        recipientName: delegate.name,
        waveLabel: label,
        formUrl,
        deadline,
        reminder: kind === 'reminder',
      });
      try {
        await deps.mailer.send({
          to: delegate.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        await prisma.assessmentInvitation.update({
          where: {
            stageConfigId_delegateId_kind_sequence: {
              stageConfigId: wave.id,
              delegateId: delegate.id,
              kind,
              sequence,
            },
          },
          data: { sentAt: at, status: 'sent' },
        });
        return true;
      } catch (error) {
        await prisma.assessmentInvitation.update({
          where: {
            stageConfigId_delegateId_kind_sequence: {
              stageConfigId: wave.id,
              delegateId: delegate.id,
              kind,
              sequence,
            },
          },
          // The reason, never the address: a failed send is reported as a count and a code.
          data: {
            status: 'failed',
            error: error instanceof Error ? error.name : 'send_failed',
          },
        });
        failed += 1;
        return false;
      }
    }

    // First invitations: everyone eligible who has not had one for this wave.
    const uninvited = await prisma.delegate.findMany({
      where: {
        eventId: wave.event.id,
        registrationStatus: { in: [...statuses] },
        assessmentInvitations: { none: { stageConfigId: wave.id, kind: 'invitation' } },
      },
      select: { id: true, name: true, email: true },
      take: BATCH - invited - reminded,
    });
    for (const delegate of uninvited) {
      if (await send(delegate, 'invitation', 0, wave.opensAt ?? at)) invited += 1;
    }
    if (invited + reminded >= BATCH) break;

    // Chasers: invited, not submitted, and the next one is due.
    if (!wave.reminderAfterDays || wave.reminderLimit < 1) continue;
    const pending = await prisma.assessmentInvitation.findMany({
      where: {
        stageConfigId: wave.id,
        kind: 'invitation',
        status: 'sent',
        delegate: {
          registrationStatus: { in: [...statuses] },
          assessmentResponses: { none: { stageConfigId: wave.id, submittedAt: { not: null } } },
        },
      },
      select: {
        sentAt: true,
        delegate: { select: { id: true, name: true, email: true } },
        delegateId: true,
      },
      take: BATCH - invited - reminded,
    });
    for (const row of pending) {
      const sentAt = row.sentAt ?? wave.opensAt ?? at;
      const already = await prisma.assessmentInvitation.count({
        where: { stageConfigId: wave.id, delegateId: row.delegateId, kind: 'reminder' },
      });
      if (already >= wave.reminderLimit) continue;
      const sequence = already + 1;
      const due = new Date(sentAt.getTime() + sequence * wave.reminderAfterDays * dayInMs);
      if (due > at) continue;
      if (await send(row.delegate, 'reminder', sequence, due)) reminded += 1;
    }
    if (invited + reminded >= BATCH) break;
  }

  // Counts only: never an address, a name or an answer.
  if (invited || reminded || failed) {
    deps.logger.info({ invited, reminded, failed, waves: waves.length }, 'follow-up invitations');
  }
  return { invited, reminded, failed };
}

export async function registerFollowUpInvitations(deps: FollowUpInvitationDeps & { boss: PgBoss }) {
  const { boss, ...rest } = deps;
  await boss.createQueue(FOLLOW_UP_INVITATION_JOB);
  await boss.schedule(FOLLOW_UP_INVITATION_JOB, '*/15 * * * *');
  await boss.work(FOLLOW_UP_INVITATION_JOB, async () => {
    await sendDueFollowUpInvitations(rest);
  });
  deps.logger.info({ job: FOLLOW_UP_INVITATION_JOB }, 'follow-up invitation job registered');
}
