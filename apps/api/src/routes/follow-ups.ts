import {
  defaultWaveWindow,
  followUpInviteScheduleSchema,
  followUpScheduleRequestSchema,
  followUpWaveOf,
  waveLabel,
  type FollowUpOverview,
  type FollowUpOverviewRow,
  type FollowUpWaveView,
} from '@mbc/shared';
import { Router, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import type { Logger } from '../lib/logger.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { sendFollowUpEmails } from '../reminders/follow-ups.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { figureStatuses } from '../lib/eligible.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  mailConfig: () => MailConfig;
  mailer: () => Mailer;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Logger;
  now?: () => Date;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The Transfer Plan post-conference follow-ups (backlog E12-1, E12-13; decision 2026-11-09).
 *
 * A follow-up wave is one row of the `follow_up` stage with its own window, questions,
 * invitations and answers. Creating the schedule gives each wave a default window — days 1 to
 * 30, 31 to 60 and 61 to 90 after the event's last day, the longer-term one from day 91 with no
 * end — and leaves it a draft for the admin to review and move; the windows are a default, never
 * a rule. The delegate's own Transfer Plan reminders point at whichever wave is current, so no
 * chaser is configured by default; an admin may still add one on the wave's card.
 *
 * Waves are created **empty**: the questions are the event's own content, as for every other
 * stage, and an enabled wave with no questions cannot be scheduled or opened. ITTEC's approved
 * follow-up wording is loaded into its waves by `db:seed` as that event's data.
 */
export function followUpRouter({
  prisma,
  config,
  mailConfig,
  mailer,
  middleware,
  logger,
  now,
}: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string, forWrite: boolean) {
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, timezone: true, endsOn: true },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    if (forWrite && event.status === 'archived') {
      throw new HttpError(409, 'event_archived', 'An archived event cannot be changed.');
    }
    return event;
  }

  async function scheduleOf(eventId: string) {
    // The response-rate denominator is a figure, so it follows the event's choice about test
    // delegates; invitations (sending) keep following the sign-in flag.
    const flag = await prisma().event.findUnique({
      where: { id: eventId },
      select: { countTestDelegates: true },
    });
    const counted = figureStatuses(flag ?? { countTestDelegates: false });
    const [rows, eligibleCount] = await Promise.all([
      prisma().assessmentStageConfig.findMany({
        where: { eventId, stage: 'follow_up' },
        orderBy: { wave: 'asc' },
        include: {
          _count: {
            select: {
              questions: { where: { retiredAt: null } },
              responses: { where: { submittedAt: { not: null } } },
            },
          },
        },
      }),
      prisma().delegate.count({
        where: { eventId, registrationStatus: { in: [...counted] } },
      }),
    ]);
    // Invitations are counted per wave: the denominator of a response rate is who was asked.
    const invited = await prisma().assessmentInvitation.groupBy({
      by: ['stageConfigId'],
      where: { stageConfigId: { in: rows.map((r) => r.id) }, kind: 'invitation', status: 'sent' },
      _count: { _all: true },
    });
    const invitedBy = new Map(invited.map((i) => [i.stageConfigId, i._count._all]));

    const waves: FollowUpWaveView[] = rows.map((r) => ({
      id: r.id,
      wave: r.wave,
      label: waveLabel('follow_up', r.wave, r.dueAfterDays),
      dueAfterDays: r.dueAfterDays,
      enabled: r.enabled,
      status: r.status,
      opensAt: r.opensAt?.toISOString() ?? null,
      closesAt: r.closesAt?.toISOString() ?? null,
      questions: r._count.questions,
      invited: invitedBy.get(r.id) ?? 0,
      submitted: r._count.responses,
      reminderAfterDays: r.reminderAfterDays,
      reminderLimit: r.reminderLimit,
      inviteAt: r.inviteAt?.toISOString() ?? null,
      invitesSentAt: r.invitesSentAt?.toISOString() ?? null,
    }));
    return { waves, eligible: eligibleCount };
  }

  router.get('/events/:eventId/assessments/follow-ups', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId), false);
    res.json(await scheduleOf(event.id));
  });

  router.post(
    '/events/:eventId/assessments/follow-ups',
    guard,
    validate(followUpScheduleRequestSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId), true);
      const asked: number[] = req.body.waves;
      const existing = await prisma().assessmentStageConfig.findMany({
        where: { eventId: event.id, stage: 'follow_up' },
        select: { wave: true },
      });
      const have = new Set(existing.map((e) => e.wave));
      const create = asked.filter((w) => !have.has(w));

      if (create.length > 0) {
        await prisma().$transaction(async (tx) => {
          for (const wave of create) {
            const definition = followUpWaveOf(wave);
            if (!definition) throw new HttpError(422, 'unknown_wave', 'Unknown follow-up wave.');
            const { opensAt, closesAt } = defaultWaveWindow(
              isoDate(event.endsOn),
              wave,
              event.timezone,
            );
            await tx.assessmentStageConfig.create({
              data: {
                eventId: event.id,
                stage: 'follow_up',
                wave,
                dueAfterDays: definition.dueAfterDays,
                // A draft until an admin has read the questions and the dates: creating a
                // schedule never starts emailing anyone.
                enabled: false,
                status: 'draft',
                opensAt,
                closesAt,
                // The delegate's own plan reminders do the chasing (2026-11-09).
                reminderAfterDays: null,
                reminderLimit: 0,
              },
            });
          }
          await audit(tx, {
            action: 'event.follow_ups_scheduled',
            entityType: 'event',
            entityId: event.id,
            eventId: event.id,
            actorUserId: principal.userId,
            newValue: { waves: create },
            ...clientOf(res),
          });
        });
      }

      res.status(create.length > 0 ? 201 : 200).json({
        ...(await scheduleOf(event.id)),
        created: create,
        generatedAt: clock().toISOString(),
      });
    },
  );

  /**
   * The organisers send a follow-up (decision 2026-11-09): the invitation to everyone eligible
   * who has not had it, or a reminder to everyone invited who has not answered. Nothing is sent
   * on its own; being sent the invitation is what shows the follow-up to a delegate. A draft,
   * disabled or question-less wave cannot be sent.
   */
  for (const mode of ['invite', 'remind'] as const) {
    router.post(
      `/events/:eventId/assessments/follow-ups/:wave/${mode === 'invite' ? 'invitations' : 'reminders'}`,
      guard,
      async (req, res) => {
        const principal = requireAdmin(res);
        const event = await loadEvent(String(req.params.eventId), true);
        const waveNumber = Number(req.params.wave);
        const wave = Number.isInteger(waveNumber)
          ? await prisma().assessmentStageConfig.findUnique({
              where: {
                eventId_stage_wave: { eventId: event.id, stage: 'follow_up', wave: waveNumber },
              },
              select: {
                id: true,
                status: true,
                invitesSentAt: true,
                _count: { select: { questions: { where: { retiredAt: null } } } },
              },
            })
          : null;
        if (!wave) throw new HttpError(404, 'not_found', 'Follow-up not found.');
        // Sending is what opens a follow-up (card design of 2026-11-09): it only needs questions,
        // and a follow-up the organisers closed stays closed until they reopen it.
        if (wave._count.questions === 0) {
          throw new HttpError(
            409,
            'follow_up_not_ready',
            'Add questions to the follow-up before sending it.',
          );
        }
        if (wave.status === 'closed') {
          throw new HttpError(
            409,
            'follow_up_closed',
            'This follow-up is closed to delegates. Reopen it before sending.',
          );
        }
        const result = await sendFollowUpEmails(
          {
            prisma,
            mailer: mailer(),
            mailConfig: mailConfig(),
            appUrl: config.appUrl,
            logger,
            now: clock,
            allowTestRegistrations: config.allowTestRegistrations,
          },
          wave.id,
          mode,
        );
        await audit(prisma(), {
          action: mode === 'invite' ? 'follow_up.invitations_sent' : 'follow_up.reminders_sent',
          entityType: 'assessment_stage_config',
          entityId: wave.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { wave: waveNumber, ...result },
          ...clientOf(res),
        });
        if (mode === 'invite') {
          // Open to the delegates who were sent it, with no window of its own: it stays open
          // until the organisers close it.
          await prisma().assessmentStageConfig.update({
            where: { id: wave.id },
            data: {
              enabled: true,
              status: 'open',
              opensAt: null,
              closesAt: null,
              ...(wave.invitesSentAt || result.sent === 0 ? {} : { invitesSentAt: clock() }),
            },
          });
        }
        res.json({ ...result, ...(await scheduleOf(event.id)) });
      },
    );
  }

  /** The organisers close a sent follow-up to delegates, or reopen it (card design 2026-11-09). */
  for (const action of ['close', 'reopen'] as const) {
    router.post(
      `/events/:eventId/assessments/follow-ups/:wave/${action}`,
      guard,
      async (req, res) => {
        const principal = requireAdmin(res);
        const event = await loadEvent(String(req.params.eventId), true);
        const waveNumber = Number(req.params.wave);
        const wave = Number.isInteger(waveNumber)
          ? await prisma().assessmentStageConfig.findUnique({
              where: {
                eventId_stage_wave: { eventId: event.id, stage: 'follow_up', wave: waveNumber },
              },
              select: { id: true },
            })
          : null;
        if (!wave) throw new HttpError(404, 'not_found', 'Follow-up not found.');
        await prisma().$transaction(async (tx) => {
          await tx.assessmentStageConfig.update({
            where: { id: wave.id },
            data: action === 'close' ? { status: 'closed' } : { status: 'open', enabled: true },
          });
          await audit(tx, {
            action: action === 'close' ? 'follow_up.closed' : 'follow_up.reopened',
            entityType: 'assessment_stage_config',
            entityId: wave.id,
            eventId: event.id,
            actorUserId: principal.userId,
            newValue: { wave: waveNumber },
            ...clientOf(res),
          });
        });
        res.json(await scheduleOf(event.id));
      },
    );
  }

  /**
   * When the invitation should go out by itself (2026-11-09): the worker job sends it once the
   * time has passed and the wave is ready; null means by hand only. Changing the time after it
   * was sent does not send again.
   */
  router.put(
    '/events/:eventId/assessments/follow-ups/:wave/schedule',
    guard,
    validate(followUpInviteScheduleSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId), true);
      const waveNumber = Number(req.params.wave);
      const input = req.body as z.infer<typeof followUpInviteScheduleSchema>;
      const wave = Number.isInteger(waveNumber)
        ? await prisma().assessmentStageConfig.findUnique({
            where: {
              eventId_stage_wave: { eventId: event.id, stage: 'follow_up', wave: waveNumber },
            },
            select: { id: true },
          })
        : null;
      if (!wave) throw new HttpError(404, 'not_found', 'Follow-up not found.');
      await prisma().$transaction(async (tx) => {
        await tx.assessmentStageConfig.update({
          where: { id: wave.id },
          data: { inviteAt: input.inviteAt ? new Date(input.inviteAt) : null },
        });
        await audit(tx, {
          action: 'follow_up.invitation_scheduled',
          entityType: 'assessment_stage_config',
          entityId: wave.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { wave: waveNumber, inviteAt: input.inviteAt },
          ...clientOf(res),
        });
      });
      res.json(await scheduleOf(event.id));
    },
  );

  /**
   * Every delegate's follow-up responses in one place (decision 2026-11-09): one row per counted
   * delegate, one entry per wave they have started or submitted, with the number of planned
   * actions whose status that wave recorded. Answers themselves stay on each wave's page.
   */
  router.get('/events/:eventId/follow-up-responses', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId), false);
    const { waves, eligible } = await scheduleOf(event.id);
    const flag = await prisma().event.findUnique({
      where: { id: event.id },
      select: { countTestDelegates: true },
    });
    const counted = figureStatuses(flag ?? { countTestDelegates: false });
    const waveById = new Map(waves.map((w) => [w.id, w.wave]));
    const [delegates, responses, statuses] = await Promise.all([
      prisma().delegate.findMany({
        where: { eventId: event.id, registrationStatus: { in: [...counted] } },
        select: { id: true, name: true, organisation: true },
        orderBy: { name: 'asc' },
      }),
      prisma().assessmentResponse.findMany({
        where: { stageConfigId: { in: waves.map((w) => w.id) } },
        select: { stageConfigId: true, delegateId: true, submittedAt: true, updatedAt: true },
      }),
      prisma().transferPlanProgress.groupBy({
        by: ['followUpWave', 'actionId'],
        where: { followUpWave: { not: null }, action: { plan: { eventId: event.id } } },
        _count: { _all: true },
      }),
    ]);
    // Statuses recorded per wave per plan owner: joined through the action's plan.
    const actionOwners = await prisma().transferPlanAction.findMany({
      where: { id: { in: statuses.map((s) => s.actionId) } },
      select: { id: true, plan: { select: { delegateId: true } } },
    });
    const ownerOf = new Map(actionOwners.map((a) => [a.id, a.plan.delegateId]));
    const statusCount = new Map<string, number>();
    for (const s of statuses) {
      const owner = ownerOf.get(s.actionId);
      if (!owner || s.followUpWave === null) continue;
      const key = `${owner}:${s.followUpWave}`;
      statusCount.set(key, (statusCount.get(key) ?? 0) + 1);
    }
    const rows: FollowUpOverviewRow[] = delegates.map((d) => {
      const mine: FollowUpOverviewRow['responses'] = {};
      for (const r of responses) {
        if (r.delegateId !== d.id) continue;
        const wave = waveById.get(r.stageConfigId);
        if (wave === undefined) continue;
        mine[String(wave)] = {
          state: r.submittedAt ? 'submitted' : 'started',
          submittedAt: r.submittedAt?.toISOString() ?? null,
          updatedAt: r.updatedAt.toISOString(),
          statuses: statusCount.get(`${d.id}:${wave}`) ?? 0,
        };
      }
      return { delegateId: d.id, name: d.name, organisation: d.organisation, responses: mine };
    });
    const overview: FollowUpOverview = { waves, rows, eligible };
    res.json(overview);
  });

  return router;
}
