import {
  dateIn,
  nextReminderAfter,
  planOutcomeLabels,
  planTitleOf,
  reminderFrequencyLabels,
  type ReminderPreference,
} from '@mbc/shared';
import type { PgBoss } from 'pg-boss';

import type { PrismaClient } from '../db.js';
import type { Logger } from '../lib/logger.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderImpactCheck, renderTransferPlanReminder } from '../mail/templates/index.js';

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

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const formatDay = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d)
    : undefined;

/**
 * Sends every action reminder that is due (decision 2026-11-11: reminders belong to each
 * planned action, and only remind). An action is due when its frequency is not "none" and its
 * next time has passed; it is skipped for good once it is completed, applied or applied
 * consistently, and while its plan is completed, Transfer Planning is hidden, the event is not
 * active or the delegate is no longer registered. Each attempt is logged on the action and the
 * next time is computed from the delegate's preference (frequency, chosen days, time of day,
 * window), so a failed send does not repeat every minute. Counts only in logs; never addresses
 * or plan text.
 */
export async function sendDueTransferPlanReminders(deps: ReminderDeps) {
  const at = (deps.now ?? (() => new Date()))();
  const prisma = deps.prisma();
  const due = await prisma.transferPlanAction.findMany({
    where: {
      reminderFrequency: { not: 'none' },
      nextReminderAt: { lte: at },
      progressStatus: { notIn: ['completed', 'applied', 'applied_consistently'] },
      plan: {
        status: { not: 'completed' },
        // No reminder while the organisers hide Transfer Planning (2026-11-08); the schedule
        // stands, so reminders resume at the next interval once it is shown.
        event: {
          status: 'active',
          OR: [
            { transferPlanVisibility: 'shown' },
            { transferPlanVisibility: 'scheduled', transferPlanShownFrom: { lte: at } },
          ],
        },
        delegate: { registrationStatus: { in: ['active', 'test'] } },
      },
    },
    include: {
      plan: {
        select: {
          id: true,
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
        },
      },
    },
    take: 200,
  });
  const appUrl = deps.appUrl.replace(/\/$/, '');
  let sent = 0;
  let failed = 0;
  for (const action of due) {
    const scheduledFor = action.nextReminderAt ?? at;
    const preference: ReminderPreference = {
      frequency: action.reminderFrequency,
      startOn: isoDate(action.reminderStartOn),
      endOn: isoDate(action.reminderEndOn),
      time: action.reminderTime,
      days: action.reminderDays,
    };
    const { event, delegate } = action.plan;
    const branding = brandingForEvent(deps.mailConfig, event);
    const rendered = renderTransferPlanReminder(branding, {
      recipientName: delegate.name,
      actionName: action.title.trim() || action.action.trim() || 'Your planned action',
      actionText: action.title.trim() && action.action.trim() ? action.action.trim() : undefined,
      firstStep: action.firstStep.trim() || undefined,
      targetOn: formatDay(action.targetOn),
      frequency: reminderFrequencyLabels[action.reminderFrequency].toLowerCase(),
      planUrl: `${appUrl}/account/events/${event.id}#transfer-plan`,
    });
    // Move the pointer first so a crash mid-send cannot resend the same reminder. Null once
    // the window has closed: the reminders stop by themselves.
    const next = nextReminderAfter(preference, at, event.timezone);
    await prisma.transferPlanAction.update({
      where: { id: action.id },
      data: { nextReminderAt: next },
    });
    try {
      await deps.mailer.send({
        to: delegate.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await prisma.transferPlanReminderLog.create({
        data: {
          planId: action.plan.id,
          actionId: action.id,
          scheduledFor,
          sentAt: at,
          status: 'sent',
          kind: 'reminder',
        },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.transferPlanReminderLog.create({
        data: {
          planId: action.plan.id,
          actionId: action.id,
          scheduledFor,
          status: 'failed',
          kind: 'reminder',
          error: error instanceof Error ? error.message.slice(0, 500) : 'send failed',
        },
      });
    }
  }
  if (due.length) deps.logger.info({ due: due.length, sent, failed }, 'transfer plan reminders');
  const checks = await sendDueImpactChecks(deps, at);
  return { due: due.length, sent, failed, impactChecks: checks };
}

/**
 * Impact checks that have fallen due on completed plans (2026-11-06): one email per check,
 * marked as notified before the send so a crash cannot repeat it. The delegate answers on the
 * plan page; nothing here changes the plan's outcome.
 */
async function sendDueImpactChecks(deps: ReminderDeps, at: Date) {
  const prisma = deps.prisma();
  const due = await prisma.transferPlanImpactCheck.findMany({
    where: {
      notifiedAt: null,
      answeredAt: null,
      dueOn: { lte: new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`) },
      plan: {
        status: 'completed',
        event: { status: 'active' },
        delegate: { registrationStatus: { in: ['active', 'test'] } },
      },
    },
    include: {
      plan: {
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
        },
      },
    },
    take: 200,
  });
  let sent = 0;
  let failed = 0;
  for (const check of due) {
    const { plan } = check;
    // Local-date due dates: a check due today in the event's zone goes out today there.
    if (isoDate(check.dueOn)! > dateIn(at, plan.event.timezone)) continue;
    await prisma.transferPlanImpactCheck.update({
      where: { id: check.id },
      data: { notifiedAt: at },
    });
    const branding = brandingForEvent(deps.mailConfig, plan.event);
    const rendered = renderImpactCheck(branding, {
      recipientName: plan.delegate.name,
      planTitle: planTitleOf(plan),
      outcome: planOutcomeLabels[plan.outcome],
      sustaining: plan.outcome === 'impact_demonstrated',
      planUrl: `${deps.appUrl.replace(/\/$/, '')}/account/events/${plan.event.id}#transfer-plan`,
    });
    try {
      await deps.mailer.send({
        to: plan.delegate.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await prisma.transferPlanReminderLog.create({
        data: {
          planId: plan.id,
          scheduledFor: check.dueOn,
          sentAt: at,
          status: 'sent',
          kind: 'impact_check',
        },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.transferPlanReminderLog.create({
        data: {
          planId: plan.id,
          scheduledFor: check.dueOn,
          status: 'failed',
          kind: 'impact_check',
          error: error instanceof Error ? error.message.slice(0, 500) : 'send failed',
        },
      });
    }
  }
  if (due.length) deps.logger.info({ due: due.length, sent, failed }, 'impact checks');
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
