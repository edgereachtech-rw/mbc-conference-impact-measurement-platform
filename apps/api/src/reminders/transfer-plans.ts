import { nextReminderAfter, reminderFrequencyLabels } from '@mbc/shared';
import type { PgBoss } from 'pg-boss';

import type { PrismaClient } from '../db.js';
import type { Logger } from '../lib/logger.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderTransferPlanReminder } from '../mail/templates/index.js';

export interface ReminderDeps {
  prisma: () => PrismaClient;
  mailer: Mailer;
  mailConfig: MailConfig;
  /** Base URL of the web app, for the link to the plan. */
  appUrl: string;
  logger: Logger;
  now?: () => Date;
}

export const TRANSFER_PLAN_REMINDER_JOB = 'transfer-plan-reminders';

/**
 * Sends every transfer plan reminder that is due: plans with a frequency other than "none"
 * whose next_reminder_at has passed, for delegates still registered, in active events. Each
 * attempt is logged on the plan and the next time is computed from the frequency, so a failed
 * send does not repeat every minute. Counts only in logs; never addresses or plan text.
 */
export async function sendDueTransferPlanReminders(deps: ReminderDeps) {
  const at = (deps.now ?? (() => new Date()))();
  const prisma = deps.prisma();
  const due = await prisma.transferPlan.findMany({
    where: {
      reminderFrequency: { not: 'none' },
      nextReminderAt: { lte: at },
      event: { status: 'active' },
      delegate: { registrationStatus: { in: ['active', 'test'] } },
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
      delegate: { select: { name: true, email: true } },
      actions: { orderBy: { order: 'asc' }, select: { action: true, isPriority: true } },
    },
    take: 200,
  });
  let sent = 0;
  let failed = 0;
  for (const plan of due) {
    const scheduledFor = plan.nextReminderAt ?? at;
    const branding = brandingForEvent(deps.mailConfig, plan.event);
    const priority = plan.actions.find((a) => a.isPriority) ?? plan.actions[0];
    const rendered = renderTransferPlanReminder(branding, {
      recipientName: plan.delegate.name,
      priorityAction: priority?.action.trim() || undefined,
      planUrl: `${deps.appUrl.replace(/\/$/, '')}/account/events/${plan.event.id}#transfer-plan`,
      frequency: reminderFrequencyLabels[plan.reminderFrequency].toLowerCase(),
    });
    // Move the pointer first so a crash mid-send cannot resend the same reminder.
    const next = nextReminderAfter(plan.reminderFrequency, at, null);
    await prisma.transferPlan.update({ where: { id: plan.id }, data: { nextReminderAt: next } });
    try {
      await deps.mailer.send({
        to: plan.delegate.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await prisma.transferPlanReminderLog.create({
        data: { planId: plan.id, scheduledFor, sentAt: at, status: 'sent' },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.transferPlanReminderLog.create({
        data: {
          planId: plan.id,
          scheduledFor,
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 500) : 'send failed',
        },
      });
    }
  }
  if (due.length) deps.logger.info({ due: due.length, sent, failed }, 'transfer plan reminders');
  return { due: due.length, sent, failed };
}

/** Registers the job with pg-boss: a run every 15 minutes plus the worker that performs it. */
export async function registerTransferPlanReminders(deps: ReminderDeps & { boss: PgBoss }) {
  const { boss, ...rest } = deps;
  await boss.createQueue(TRANSFER_PLAN_REMINDER_JOB);
  await boss.schedule(TRANSFER_PLAN_REMINDER_JOB, '*/15 * * * *');
  await boss.work(TRANSFER_PLAN_REMINDER_JOB, async () => {
    await sendDueTransferPlanReminders(rest);
  });
  deps.logger.info({ job: TRANSFER_PLAN_REMINDER_JOB }, 'reminder job registered');
}
