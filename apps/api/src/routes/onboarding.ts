import { onboardingSendRequestSchema, type OnboardingState } from '@mbc/shared';
import { Router, type Response } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { batchScopeOf, inBatch, type BatchScope } from '../lib/batch-scope.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { validate } from '../lib/validate.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { buildOnboardingPack } from '../onboarding/pack.js';
import { emailCustomisationFor } from '../mail/customisation.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  /** A thunk: mail settings are read when something is actually sent, never at startup. */
  mailConfig: () => MailConfig;
  mailer: () => Mailer;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Logger;
  now?: () => Date;
}

/** One pass sends at most this many, so a large event goes out in reviewable batches. */
const BATCH = 250;

/**
 * Sending the onboarding pack (task of 2026-11-03).
 *
 * An admin presses send; nothing is triggered by an import, because a wrong file would otherwise
 * email real people. Every attempt is recorded against the delegate, so a second send can skip
 * whoever already has one, and the audit entry carries counts — never an address.
 */
export function onboardingRouter({
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
  const eligible = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string) {
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        status: true,
        startsOn: true,
        endsOn: true,
        timezone: true,
        location: true,
        eventType: true,
        dates: { orderBy: { date: 'asc' }, select: { id: true, date: true } },
      },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  /**
   * The earlier event each of these delegates already took part in on the platform, by delegate
   * id (2026-11-19): the same person (identity) registered for another event that started
   * before this one. The pack then says their account carries over. One query for the batch.
   */
  async function returningFromFor(
    delegates: Array<{ id: string; identityId: string | null }>,
    event: { id: string; startsOn: Date },
  ): Promise<Map<string, string>> {
    const identityIds = delegates.map((d) => d.identityId).filter((x): x is string => Boolean(x));
    if (identityIds.length === 0) return new Map();
    const earlier = await prisma().delegate.findMany({
      where: {
        identityId: { in: identityIds },
        eventId: { not: event.id },
        registrationStatus: { in: ['active', 'test'] },
        event: { startsOn: { lt: event.startsOn }, status: { not: 'draft' } },
      },
      select: { identityId: true, event: { select: { name: true, startsOn: true } } },
      orderBy: { event: { startsOn: 'desc' } },
    });
    const latestByIdentity = new Map<string, string>();
    for (const row of earlier) {
      if (row.identityId && !latestByIdentity.has(row.identityId)) {
        latestByIdentity.set(row.identityId, row.event.name);
      }
    }
    const out = new Map<string, string>();
    for (const d of delegates) {
      const name = d.identityId ? latestByIdentity.get(d.identityId) : undefined;
      if (name) out.set(d.id, name);
    }
    return out;
  }

  /** The figures of the event, or of one batch's delegates (2026-11-23). */
  async function stateOf(eventId: string, batch: BatchScope | null): Promise<OnboardingState> {
    const where = { eventId, registrationStatus: { in: [...eligible()] }, ...inBatch(batch) };
    const [eligibleCount, sent, failed, notSignedIn, last] = await Promise.all([
      prisma().delegate.count({ where }),
      prisma().delegate.count({
        where: { ...where, onboardingSends: { some: { status: 'sent' } } },
      }),
      prisma().delegate.count({
        where: {
          ...where,
          onboardingSends: { some: { status: 'failed' }, none: { status: 'sent' } },
        },
      }),
      prisma().delegate.count({ where: { ...where, signedUpAt: null } }),
      prisma().onboardingSend.findFirst({
        where: { status: 'sent', delegate: { eventId, ...inBatch(batch) } },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
    ]);
    return {
      eligible: eligibleCount,
      sent,
      pending: eligibleCount - sent,
      failed,
      notSignedIn,
      lastSentAt: last?.sentAt?.toISOString() ?? null,
    };
  }

  router.get('/events/:eventId/onboarding', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    res.json(await stateOf(event.id, await batchScopeOf(prisma(), event.id, req.query.batch)));
  });

  router.post(
    '/events/:eventId/onboarding/send',
    guard,
    validate(onboardingSendRequestSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      if (event.status === 'archived') {
        throw new HttpError(409, 'event_archived', 'An archived event sends nothing.');
      }
      const { scope, delegateIds } = req.body;
      const batch = await batchScopeOf(prisma(), event.id, req.body.batch);

      const recipients = await prisma().delegate.findMany({
        where: {
          eventId: event.id,
          registrationStatus: { in: [...eligible()] },
          ...inBatch(batch),
          ...(scope === 'not_yet_sent' ? { onboardingSends: { none: { status: 'sent' } } } : {}),
          // Not signed in even once on this event's registration (2026-11-23).
          ...(scope === 'not_signed_in' ? { signedUpAt: null } : {}),
          ...(scope === 'selected' ? { id: { in: delegateIds ?? [] } } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          identityId: true,
          batch: { select: { eventDateId: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      const returning = await returningFromFor(recipients, event);
      const custom = await emailCustomisationFor(prisma(), event.id, 'onboarding');

      let justSent = 0;
      let justFailed = 0;
      const transport = mailer();
      for (const delegate of recipients) {
        const at = clock();
        try {
          // A delegate in a batch gets that day's code alone (2026-11-19).
          const message = await buildOnboardingPack(
            {
              ...event,
              dates: event.dates.filter(
                (d) => !delegate.batch || delegate.batch.eventDateId === d.id,
              ),
            },
            { ...delegate, returningFrom: returning.get(delegate.id) ?? null },
            {
              mailConfig: mailConfig(),
              hashSecret: config.hashSecret,
              appUrl: config.appUrl,
            },
            undefined,
            custom,
          );
          await transport.send(message);
          await prisma().onboardingSend.create({
            data: { delegateId: delegate.id, status: 'sent', sentAt: at },
          });
          justSent += 1;
        } catch (error) {
          await prisma().onboardingSend.create({
            data: {
              delegateId: delegate.id,
              status: 'failed',
              // The reason, never the address: a failure is a count and a code.
              error: error instanceof Error ? error.name : 'send_failed',
            },
          });
          justFailed += 1;
        }
      }

      await audit(prisma(), {
        action: 'onboarding.sent',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: {
          scope,
          sent: justSent,
          failed: justFailed,
          limit: BATCH,
          ...(batch ? { batch: batch.name } : {}),
        },
        ...clientOf(res),
      });
      if (justSent || justFailed) {
        logger.info({ sent: justSent, failed: justFailed }, 'onboarding packs sent');
      }

      res.status(201).json({ ...(await stateOf(event.id, batch)), justSent, justFailed });
    },
  );

  return router;
}
