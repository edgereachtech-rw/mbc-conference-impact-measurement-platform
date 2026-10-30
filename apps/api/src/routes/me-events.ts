import { overallAttendance, type MyEvent } from '@mbc/shared';
import { Router } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import type { PrismaClient } from '../db.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

/**
 * Visibility pending OQ-25 (backlog D7): whether cancelled registrations and archived events
 * appear in My Events is not decided. Until it is, both are left out, which exposes nothing the
 * decision could later restrict; the records stay in place and every request is authorised on the
 * server, so a later decision changes only this filter.
 */
export const MY_EVENTS_VISIBILITY = {
  cancelledRegistrations: 'hidden',
  archivedEvents: 'hidden',
  pendingDecision: 'OQ-25',
} as const;

const EVENT_SELECT = {
  id: true,
  slug: true,
  name: true,
  theme: true,
  startsOn: true,
  endsOn: true,
  timezone: true,
  location: true,
  format: true,
  status: true,
} as const;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Today's date (UTC) as YYYY-MM-DD; event dates are stored without a time. */
function today(now: Date): string {
  return isoDate(now);
}

/**
 * My Events (E3-10, D7): every event with a registration linked to the caller's identity. Records
 * are resolved from the session's identity on the server; the event id in the path is only
 * accepted when such a registration exists, otherwise 404. Ordering (decided): upcoming events
 * first, soonest first, then past events with the most recent first.
 */
export function meEventsRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const eligibleStatuses = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  async function myEvents(identityId: string | null): Promise<MyEvent[]> {
    if (!identityId) return [];
    const registrations = await prisma().delegate.findMany({
      where: {
        identityId,
        registrationStatus: { in: [...eligibleStatuses()] },
        event: { status: { not: 'archived' } },
      },
      select: {
        id: true,
        registrationStatus: true,
        attendanceFormat: true,
        capacity: true,
        organisation: true,
        jobTitle: true,
        country: true,
        signedUpAt: true,
        event: {
          select: {
            ...EVENT_SELECT,
            dates: { select: { id: true, attendanceClosedAt: true } },
          },
        },
        attendanceRecords: { select: { eventDateId: true, status: true } },
      },
    });
    const current = today(clock());
    const events: MyEvent[] = registrations.map((r) => ({
      id: r.event.id,
      slug: r.event.slug,
      name: r.event.name,
      theme: r.event.theme,
      startsOn: isoDate(r.event.startsOn),
      endsOn: isoDate(r.event.endsOn),
      timezone: r.event.timezone,
      location: r.event.location,
      format: r.event.format,
      period: isoDate(r.event.endsOn) >= current ? 'upcoming' : 'past',
      registration: {
        id: r.id,
        status: r.registrationStatus as 'active' | 'test',
        attendanceFormat: r.attendanceFormat,
        capacity: r.capacity,
        organisation: r.organisation,
        jobTitle: r.jobTitle,
        country: r.country,
        signedUpAt: r.signedUpAt ? r.signedUpAt.toISOString() : null,
      },
      attendance: {
        status: overallAttendance(
          r.event.dates.map((d) => ({
            closed: d.attendanceClosedAt !== null,
            daily:
              r.attendanceRecords.find((a) => a.eventDateId === d.id)?.status ?? 'not_checked_in',
          })),
        ),
      },
    }));
    events.sort((a, b) => {
      if (a.period !== b.period) return a.period === 'upcoming' ? -1 : 1;
      if (a.period === 'upcoming')
        return a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0;
      return a.endsOn > b.endsOn ? -1 : a.endsOn < b.endsOn ? 1 : 0;
    });
    return events;
  }

  /** Delegates only: staff accounts have no identity and use the admin screens instead. */
  function identityOf(res: Parameters<typeof principalOf>[0]): string | null {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'My Events is for registered delegates.');
    }
    return principal.identityId;
  }

  router.get('/me/events', middleware.requireAuth, async (_req, res) => {
    res.json({ events: await myEvents(identityOf(res)) });
  });

  router.get('/me/events/:eventId', middleware.requireAuth, async (req, res) => {
    const events = await myEvents(identityOf(res));
    const event = events.find((e) => e.id === String(req.params.eventId));
    if (!event) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    res.json({ event });
  });

  return router;
}
