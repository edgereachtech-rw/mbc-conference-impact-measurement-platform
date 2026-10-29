import { delegatePatchSchema, type DelegatePatch } from '@mbc/shared';
import { Router } from 'express';

import type { createAuthMiddleware } from '../auth/middleware.js';
import { principalOf } from '../auth/middleware.js';
import {
  canReadDelegate,
  canWriteDelegate,
  DELEGATE_READ_ROLES,
  DELEGATE_WRITE_ROLES,
} from '../auth/policies.js';
import { clientOf } from '../auth/middleware.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const DELEGATE_FIELDS = {
  id: true,
  eventId: true,
  name: true,
  email: true,
  organisation: true,
  jobTitle: true,
  country: true,
  attendanceFormat: true,
  capacity: true,
  registrationStatus: true,
  signedUpAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const EDITABLE = [
  'name',
  'organisation',
  'jobTitle',
  'country',
  'attendanceFormat',
  'capacity',
  'registrationStatus',
] as const;

/**
 * Delegate records (E2-4 subset, E3-6). `/me/delegate` is the delegate's own record, resolved
 * from the session, never from a client-supplied id. `/delegates/:id` is staff-only.
 */
export function delegateRouter({ prisma, middleware }: Deps): Router {
  const router = Router();

  router.get('/me/delegate', middleware.requireDelegate, async (_req, res) => {
    const principal = principalOf(res);
    const delegate = await prisma().delegate.findUnique({
      where: { id: principal.delegateId ?? '' },
      select: DELEGATE_FIELDS,
    });
    if (!delegate || !canReadDelegate(principal, delegate.id)) {
      throw new HttpError(404, 'not_found', 'Delegate record not found.');
    }
    res.json({ delegate });
  });

  router.get('/delegates/:id', middleware.requireRole(...DELEGATE_READ_ROLES), async (req, res) => {
    const principal = principalOf(res);
    const delegate = await prisma().delegate.findUnique({
      where: { id: String(req.params.id) },
      select: DELEGATE_FIELDS,
    });
    if (!delegate || !canReadDelegate(principal, delegate.id)) {
      throw new HttpError(404, 'not_found', 'Delegate record not found.');
    }
    res.json({ delegate });
  });

  router.patch(
    '/delegates/:id',
    middleware.requireRole(...DELEGATE_WRITE_ROLES),
    validate(delegatePatchSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canWriteDelegate(principal)) throw new HttpError(403, 'forbidden', 'Read-only role.');
      const id = String(req.params.id);
      const patch = req.body as DelegatePatch;

      const updated = await prisma().$transaction(async (tx) => {
        const before = await tx.delegate.findUnique({ where: { id }, select: DELEGATE_FIELDS });
        if (!before) throw new HttpError(404, 'not_found', 'Delegate record not found.');
        const after = await tx.delegate.update({
          where: { id },
          data: patch,
          select: DELEGATE_FIELDS,
        });
        const oldValue: Record<string, string | null> = {};
        const newValue: Record<string, string | null> = {};
        for (const field of EDITABLE) {
          if (field in patch && before[field] !== after[field]) {
            oldValue[field] = before[field];
            newValue[field] = after[field];
          }
        }
        // E2-4 / E17-4: who, when, old and new value (names are personal data by design here).
        await audit(tx, {
          action: 'delegate.updated',
          entityType: 'delegate',
          entityId: id,
          eventId: before.eventId,
          actorUserId: principal.userId,
          oldValue: oldValue as Prisma.InputJsonValue,
          newValue: newValue as Prisma.InputJsonValue,
          ...clientOf(res),
        });
        return after;
      });
      res.json({ delegate: updated });
    },
  );

  return router;
}
