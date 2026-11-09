import { waveLabel } from '@mbc/shared';
import type { PgBoss } from 'pg-boss';

import type { PrismaClient } from '../db.js';
import type { Logger } from '../lib/logger.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderFollowUpInvitation } from '../mail/templates/index.js';

export interface FollowUpSendDeps {
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

/** How many emails one call will send, so a large event spreads over several clicks or runs. */
const BATCH = 500;

export const FOLLOW_UP_INVITATION_JOB = 'follow-up-invitations';

export type FollowUpSendMode = 'invite' | 'remind';

/**
 * Sends a follow-up wave's emails on the organisers' request (backlog E12-14; decision
 * 2026-11-09: nothing about a follow-up is sent on its own).
 *
 * `invite` emails every eligible delegate who has not yet been invited to the wave; being
 * invited is what makes the follow-up appear for them and lets them answer it. `remind` emails
 * every invited delegate who has not submitted. Both are driven by rows in
 * `assessment_invitation`, written before the send: that row is the record of what was sent and
 * the lock that stops it being sent twice, so a repeated click or a crash part-way through never
 * doubles up. Counts only are returned and logged; never an address.
 */
export async function sendFollowUpEmails(
  deps: FollowUpSendDeps,
  waveId: string,
  mode: FollowUpSendMode,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const at = (deps.now ?? (() => new Date()))();
  const prisma = deps.prisma();
  const statuses = deps.allowTestRegistrations
    ? (['active', 'test'] as const)
    : (['active'] as const);
  const wave = await prisma.assessmentStageConfig.findUniqueOrThrow({
    where: { id: waveId },
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
  });
  const label = waveLabel('follow_up', wave.wave, wave.dueAfterDays) || 'Post-conference follow-up';
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

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  async function send(
    delegate: { id: string; name: string; email: string },
    kind: 'invitation' | 'reminder',
    sequence: number,
  ) {
    // The row first: it is the lock. A duplicate key means another call already has this one.
    try {
      await prisma.assessmentInvitation.create({
        data: {
          stageConfigId: wave.id,
          delegateId: delegate.id,
          kind,
          sequence,
          scheduledFor: at,
          status: 'sending',
        },
      });
    } catch {
      skipped += 1;
      return;
    }
    const rendered = renderFollowUpInvitation(branding, {
      recipientName: delegate.name,
      waveLabel: label,
      formUrl,
      deadline,
      reminder: kind === 'reminder',
    });
    const where = {
      stageConfigId_delegateId_kind_sequence: {
        stageConfigId: wave.id,
        delegateId: delegate.id,
        kind,
        sequence,
      },
    };
    try {
      await deps.mailer.send({
        to: delegate.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await prisma.assessmentInvitation.update({ where, data: { sentAt: at, status: 'sent' } });
      sent += 1;
    } catch (error) {
      // The reason, never the address: a failed send is reported as a count and a code.
      await prisma.assessmentInvitation.update({
        where,
        data: { status: 'failed', error: error instanceof Error ? error.name : 'send_failed' },
      });
      failed += 1;
    }
  }

  if (mode === 'invite') {
    const uninvited = await prisma.delegate.findMany({
      where: {
        eventId: wave.event.id,
        registrationStatus: { in: [...statuses] },
        assessmentInvitations: {
          none: { stageConfigId: wave.id, kind: 'invitation', status: { in: ['sent', 'sending'] } },
        },
      },
      select: { id: true, name: true, email: true },
      take: BATCH,
    });
    for (const delegate of uninvited) await send(delegate, 'invitation', 0);
  } else {
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
      select: { delegate: { select: { id: true, name: true, email: true } } },
      take: BATCH,
    });
    for (const row of pending) {
      const already = await prisma.assessmentInvitation.count({
        where: { stageConfigId: wave.id, delegateId: row.delegate.id, kind: 'reminder' },
      });
      await send(row.delegate, 'reminder', already + 1);
    }
  }

  if (sent || failed || skipped) {
    deps.logger.info({ wave: wave.wave, mode, sent, failed, skipped }, 'follow-up emails');
  }
  return { sent, failed, skipped };
}

/**
 * Sends the invitations the organisers scheduled (decision 2026-11-09): every wave whose
 * `inviteAt` has passed and has not been sent yet, provided it is enabled, scheduled or open and
 * has questions; a wave not ready at the time waits until it is. The wave is stamped
 * `invitesSentAt` before the emails go, so a crash cannot send it twice; a batch left over is
 * finished by the organisers' "Send the invitation", which reaches whoever has not been invited.
 */
export async function sendScheduledFollowUpInvitations(deps: FollowUpSendDeps) {
  const at = (deps.now ?? (() => new Date()))();
  const prisma = deps.prisma();
  const due = await prisma.assessmentStageConfig.findMany({
    where: {
      stage: 'follow_up',
      inviteAt: { lte: at },
      invitesSentAt: null,
      enabled: true,
      status: { in: ['scheduled', 'open'] },
      questions: { some: { retiredAt: null } },
      event: { status: 'active' },
    },
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const wave of due) {
    await prisma.assessmentStageConfig.update({
      where: { id: wave.id },
      data: { invitesSentAt: at },
    });
    const result = await sendFollowUpEmails(deps, wave.id, 'invite');
    sent += result.sent;
    failed += result.failed;
  }
  if (due.length) deps.logger.info({ waves: due.length, sent, failed }, 'scheduled follow-ups');
  return { waves: due.length, sent, failed };
}

export async function registerFollowUpInvitations(deps: FollowUpSendDeps & { boss: PgBoss }) {
  const { boss, ...rest } = deps;
  await boss.createQueue(FOLLOW_UP_INVITATION_JOB);
  await boss.schedule(FOLLOW_UP_INVITATION_JOB, '*/5 * * * *');
  await boss.work(FOLLOW_UP_INVITATION_JOB, async () => {
    await sendScheduledFollowUpInvitations(rest);
  });
  deps.logger.info({ job: FOLLOW_UP_INVITATION_JOB }, 'follow-up invitation job registered');
}
