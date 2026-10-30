import { Router } from 'express';

import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canRunImports, IMPORT_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { loadEventDetail } from './event-setup.js';

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const EVENT_FIELDS = {
  id: true,
  slug: true,
  name: true,
  eventType: true,
  startsOn: true,
  endsOn: true,
  timezone: true,
  format: true,
  status: true,
} as const;

/**
 * Event listing for the admin import screen (E2-1 step 1: select the event). Admin-only, like the
 * import routes it serves; conference setup proper (E1) arrives later and may widen this.
 */
export function eventRouter({ prisma, middleware }: Deps): Router {
  const router = Router();

  router.get('/events', middleware.requireRole(...IMPORT_ROLES), async (_req, res) => {
    if (!canRunImports(principalOf(res))) throw new HttpError(403, 'forbidden', 'Admins only.');
    const events = await prisma().event.findMany({
      select: EVENT_FIELDS,
      orderBy: [{ startsOn: 'desc' }, { name: 'asc' }],
    });
    res.json({ events });
  });

  router.get('/events/:eventId', middleware.requireRole(...IMPORT_ROLES), async (req, res) => {
    if (!canRunImports(principalOf(res))) throw new HttpError(403, 'forbidden', 'Admins only.');
    const event = await loadEventDetail(prisma(), String(req.params.eventId));
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    res.json({ event });
  });

  return router;
}
