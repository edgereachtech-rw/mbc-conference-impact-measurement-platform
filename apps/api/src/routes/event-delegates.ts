import {
  delegateListQuerySchema,
  delegateListStatuses,
  type DelegateListItem,
  type DelegateListQuery,
  type DelegateListStatus,
} from '@mbc/shared';
import { Router } from 'express';

import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { DELEGATE_READ_ROLES, hasRole } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const LIST_FIELDS = {
  id: true,
  name: true,
  email: true,
  organisation: true,
  jobTitle: true,
  country: true,
  attendanceFormat: true,
  capacity: true,
  registrationStatus: true,
  registrationSource: true,
  externalRegistrationId: true,
  identityId: true,
  signedUpAt: true,
  importedAt: true,
  createdAt: true,
} as const;

/**
 * Delegate listing per event for the admin console (E2-6 subset): search, filter by status and
 * format, sort, paginate. Admin-only; every record of the event is in scope for an admin (E3-6).
 */
export function eventDelegateRouter({ prisma, middleware }: Deps): Router {
  const router = Router();

  router.get(
    '/events/:eventId/delegates',
    middleware.requireRole(...DELEGATE_READ_ROLES),
    async (req, res) => {
      if (!hasRole(principalOf(res), DELEGATE_READ_ROLES)) {
        throw new HttpError(403, 'forbidden', 'Admins only.');
      }
      const parsed = delegateListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new HttpError(422, 'validation_failed', detail);
      }
      const query: DelegateListQuery = parsed.data;
      const eventId = String(req.params.eventId);
      const event = await prisma().event.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (!event) throw new HttpError(404, 'not_found', 'Event not found.');

      const where: Prisma.DelegateWhereInput = {
        eventId,
        ...(query.status ? { registrationStatus: query.status } : {}),
        ...(query.attendanceFormat ? { attendanceFormat: query.attendanceFormat } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
                { organisation: { contains: query.q, mode: 'insensitive' } },
                { externalRegistrationId: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const orderBy: Prisma.DelegateOrderByWithRelationInput[] = [
        { [query.sort]: query.direction } as Prisma.DelegateOrderByWithRelationInput,
        { id: 'asc' },
      ];
      const [rows, total, grouped] = await Promise.all([
        prisma().delegate.findMany({
          where,
          select: LIST_FIELDS,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma().delegate.count({ where }),
        prisma().delegate.groupBy({
          by: ['registrationStatus'],
          where: { eventId },
          _count: { _all: true },
        }),
      ]);
      const counts = Object.fromEntries(delegateListStatuses.map((s) => [s, 0])) as Record<
        DelegateListStatus,
        number
      >;
      for (const g of grouped) counts[g.registrationStatus as DelegateListStatus] = g._count._all;
      const delegates: DelegateListItem[] = rows.map((r) => ({
        ...r,
        signedUpAt: r.signedUpAt ? r.signedUpAt.toISOString() : null,
        importedAt: r.importedAt ? r.importedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));
      res.json({ delegates, page: query.page, pageSize: query.pageSize, total, counts });
    },
  );

  return router;
}
