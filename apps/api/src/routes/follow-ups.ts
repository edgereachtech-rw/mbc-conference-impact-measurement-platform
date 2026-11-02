import {
  defaultWaveOpensAt,
  followUpScheduleRequestSchema,
  followUpWaveOf,
  FOLLOW_UP_OPEN_DAYS,
  FOLLOW_UP_REMINDER_AFTER_DAYS,
  FOLLOW_UP_REMINDER_LIMIT,
  waveLabel,
  type FollowUpWaveView,
} from '@mbc/shared';
import { Router, type Response } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The follow-up schedule (backlog E12-1, E12-13).
 *
 * A follow-up wave is a round of the follow-up assessment: one row of the stage with its own
 * dates, its own questions and its own invitations. Creating the schedule gives each wave a
 * default opening date — 30, 60 and 90 days after the event's last day, at 09:00 in the event's
 * zone — and leaves it a draft for the admin to review and move; the dates are a default, never
 * a rule.
 *
 * Waves are created **empty**: the questions are the event's own content, as for every other
 * stage, and an enabled wave with no questions cannot be scheduled or opened. ITTEC's approved
 * follow-up wording is loaded into its waves by `db:seed` as that event's data.
 */
export function followUpRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);
  const eligible = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

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
        where: { eventId, registrationStatus: { in: [...eligible()] } },
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
            const opensAt = defaultWaveOpensAt(
              isoDate(event.endsOn),
              definition.dueAfterDays,
              event.timezone,
            );
            const closesAt = new Date(opensAt.getTime() + FOLLOW_UP_OPEN_DAYS * 86_400_000);
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
                reminderAfterDays: FOLLOW_UP_REMINDER_AFTER_DAYS,
                reminderLimit: FOLLOW_UP_REMINDER_LIMIT,
              },
            });
          }
          await audit(tx, {
            action: 'event.follow_ups_scheduled',
            entityType: 'event',
            entityId: event.id,
            eventId: event.id,
            actorUserId: principal.userId,
            newValue: { waves: create, defaultOpenDays: FOLLOW_UP_OPEN_DAYS },
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

  return router;
}
