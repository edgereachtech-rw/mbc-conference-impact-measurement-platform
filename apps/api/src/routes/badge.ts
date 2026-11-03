import { Router, type Response } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { logoDataUri } from '../badge/logo.js';
import { renderBadgeSvg } from '../badge/render.js';
import type { PrismaClient } from '../db.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { organiserName } from '../mail/branding.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Logger;
}

/**
 * The delegate's "I will be attending" card (task of 2026-11-03).
 *
 * Served as SVG from the delegate's own registration: the event's logo, dates and venue, their
 * name and the organisation that nominated them. A delegate can only ever fetch their own, and
 * only for an event they are registered for — the card carries their name, so it is their record
 * like any other.
 */
export function badgeRouter({ prisma, config, middleware, logger }: Deps): Router {
  const router = Router();
  const eligible = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  /** "NOVEMBER 12-13 2026": the event's own dates, in its own zone, as the card prints them. */
  function dateLine(startsOn: Date, endsOn: Date, timezone: string): string {
    const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: timezone });
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: timezone });
    const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: timezone });
    const sameMonth = month.format(startsOn) === month.format(endsOn);
    const days =
      day.format(startsOn) === day.format(endsOn)
        ? day.format(startsOn)
        : sameMonth
          ? `${day.format(startsOn)}-${day.format(endsOn)}`
          : `${day.format(startsOn)} ${month.format(startsOn)} - ${day.format(endsOn)}`;
    return `${month.format(endsOn)} ${days} ${year.format(endsOn)}`.toUpperCase();
  }

  async function myRegistration(res: Response, eventId: string) {
    const principal = principalOf(res);
    if (principal.role !== 'delegate' || !principal.identityId) {
      throw new HttpError(403, 'forbidden', 'The card belongs to delegates.');
    }
    const delegate = await prisma().delegate.findFirst({
      where: {
        eventId,
        identityId: principal.identityId,
        registrationStatus: { in: [...eligible()] },
      },
      select: {
        name: true,
        nominatingOrganisation: true,
        event: {
          select: {
            name: true,
            startsOn: true,
            endsOn: true,
            timezone: true,
            location: true,
            imageUrl: true,
            status: true,
          },
        },
      },
    });
    if (!delegate || delegate.event.status === 'archived') {
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    }
    return delegate;
  }

  router.get('/me/events/:eventId/badge.svg', middleware.requireAuth, async (req, res) => {
    const delegate = await myRegistration(res, String(req.params.eventId));
    const event = delegate.event;
    const svg = renderBadgeSvg({
      eventName: event.name,
      dateLine: dateLine(event.startsOn, event.endsOn, event.timezone),
      venueLine: event.location ?? undefined,
      delegateName: delegate.name,
      sponsor: delegate.nominatingOrganisation ?? undefined,
      organiser: organiserName(),
      logoDataUri: (await logoDataUri(event.imageUrl, logger)) ?? undefined,
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    // The card carries the delegate's name: never cached by a proxy, only by their own browser.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(svg);
  });

  return router;
}
