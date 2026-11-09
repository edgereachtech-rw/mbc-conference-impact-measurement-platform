import {
  actionProgressLabels,
  dateIn,
  inFinalReminderWeek,
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

/**
 * Sends every transfer plan reminder that is due: plans with a frequency other than "none"
 * whose next_reminder_at has passed, not yet completed, for delegates still registered, in
 * active events. Each attempt is logged on the plan and the next time is computed from the
 * delegate's preference (frequency, chosen days, time of day, window), so a failed send does
 * not repeat every minute. In the last seven days of a window the email says the reminders are
 * about to stop and asks the delegate to complete the plan or extend them (2026-11-06).
 *
 * Each reminder asks the delegate to update where each action stands, listing the actions
 * with their current status and when it was last recorded (decision 2026-11-09). An occurrence
 * sends nothing (the pointer still moves) when there is nothing to update: every action is
 * completed or no longer applicable, or every action's status was recorded after the last
 * reminder went out. Counts only in logs; never addresses or plan text.
 */
export async function sendDueTransferPlanReminders(deps: ReminderDeps) {
  const at = (deps.now ?? (() => new Date()))();
  const prisma = deps.prisma();
  const due = await prisma.transferPlan.findMany({
    where: {
      reminderFrequency: { not: 'none' },
      nextReminderAt: { lte: at },
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
      actions: {
        orderBy: { order: 'asc' },
        select: {
          title: true,
          action: true,
          isPriority: true,
          progressStatus: true,
          progress: { orderBy: { recordedAt: 'desc' }, take: 1, select: { recordedAt: true } },
        },
      },
      // The last occurrence, sent or skipped: statuses recorded since then are fresh.
      reminders: {
        where: { status: { in: ['sent', 'skipped'] } },
        orderBy: { scheduledFor: 'desc' },
        take: 1,
        select: { scheduledFor: true, sentAt: true },
      },
    },
    take: 200,
  });
  const appUrl = deps.appUrl.replace(/\/$/, '');
  const daysBetween = (from: Date, to: Date) =>
    Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const plan of due) {
    const scheduledFor = plan.nextReminderAt ?? at;
    const preference: ReminderPreference = {
      frequency: plan.reminderFrequency,
      startOn: isoDate(plan.reminderStartOn),
      endOn: isoDate(plan.reminderEndOn),
      time: plan.reminderTime,
      days: plan.reminderDays,
    };
    const written = plan.actions.filter((a) => a.action.trim() !== '');
    const last = plan.reminders[0];
    const lastReminder = last ? (last.sentAt ?? last.scheduledFor) : null;
    const nothingLeft =
      written.length > 0 &&
      written.every(
        (a) => a.progressStatus === 'completed' || a.progressStatus === 'no_longer_applicable',
      );
    const allFresh =
      lastReminder !== null &&
      written.length > 0 &&
      written.every((a) => (a.progress[0]?.recordedAt ?? new Date(0)) > lastReminder);
    if (nothingLeft || allFresh) {
      // Nothing to ask for at this occurrence: logged as skipped (so the next one knows what
      // "since the last reminder" means), and the next one is scheduled as usual.
      await prisma.transferPlan.update({
        where: { id: plan.id },
        data: { nextReminderAt: nextReminderAfter(preference, at, plan.event.timezone) },
      });
      await prisma.transferPlanReminderLog.create({
        data: { planId: plan.id, scheduledFor, status: 'skipped', kind: 'reminder' },
      });
      skipped += 1;
      continue;
    }
    const finalWeek = inFinalReminderWeek(preference, at, plan.event.timezone);
    const branding = brandingForEvent(deps.mailConfig, plan.event);
    const rendered = renderTransferPlanReminder(branding, {
      recipientName: plan.delegate.name,
      planTitle: planTitleOf(plan),
      planUrl: `${appUrl}/account/events/${plan.event.id}#transfer-plan`,
      frequency: reminderFrequencyLabels[plan.reminderFrequency].toLowerCase(),
      actions: written.map((a) => {
        const last = a.progress[0]?.recordedAt ?? null;
        const days = last ? daysBetween(last, at) : null;
        return {
          name: a.title.trim() || a.action.trim(),
          status: actionProgressLabels[a.progressStatus].toLowerCase(),
          updated:
            days === null
              ? 'no status recorded yet'
              : days === 0
                ? 'updated today'
                : `last updated ${days} day${days === 1 ? '' : 's'} ago`,
          isPriority: a.isPriority,
        };
      }),
      finalWeek:
        finalWeek && preference.endOn
          ? {
              endsOn: new Intl.DateTimeFormat('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(`${preference.endOn}T00:00:00.000Z`)),
            }
          : undefined,
    });
    // Move the pointer first so a crash mid-send cannot resend the same reminder. Null once
    // the window has closed: the reminders stop by themselves.
    const next = nextReminderAfter(preference, at, plan.event.timezone);
    await prisma.transferPlan.update({ where: { id: plan.id }, data: { nextReminderAt: next } });
    const kind = finalWeek ? 'final_week' : 'reminder';
    try {
      await deps.mailer.send({
        to: plan.delegate.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await prisma.transferPlanReminderLog.create({
        data: { planId: plan.id, scheduledFor, sentAt: at, status: 'sent', kind },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.transferPlanReminderLog.create({
        data: {
          planId: plan.id,
          scheduledFor,
          status: 'failed',
          kind,
          error: error instanceof Error ? error.message.slice(0, 500) : 'send failed',
        },
      });
    }
  }
  if (due.length) {
    deps.logger.info({ due: due.length, sent, failed, skipped }, 'transfer plan reminders');
  }
  const checks = await sendDueImpactChecks(deps, at);
  return { due: due.length, sent, failed, skipped, impactChecks: checks };
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
