import { staffCreateSchema, staffPatchSchema } from '@mbc/shared';
import { Router } from 'express';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canManageStaff, STAFF_ADMIN_ROLES } from '../auth/policies.js';
import type { AuthService } from '../auth/service.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

interface Deps {
  prisma: () => PrismaClient;
  auth: AuthService;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const STAFF_FIELDS = {
  id: true,
  email: true,
  role: true,
  status: true,
  lastSignInAt: true,
  createdAt: true,
} as const;

/** Staff account administration (E3-9): admins create, re-role and deactivate staff accounts. */
export function staffRouter({ prisma, auth, middleware }: Deps): Router {
  const router = Router();
  const adminOnly = middleware.requireRole(...STAFF_ADMIN_ROLES);

  router.get('/staff', adminOnly, async (_req, res) => {
    const staff = await prisma().userAccount.findMany({
      where: { role: { not: 'delegate' } },
      select: STAFF_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ staff });
  });

  router.post('/staff', adminOnly, validate(staffCreateSchema), async (req, res) => {
    const principal = principalOf(res);
    if (!canManageStaff(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    const { email, role } = req.body;

    const existing = await prisma().userAccount.findUnique({ where: { email } });
    if (existing)
      throw new HttpError(409, 'conflict', 'An account with this email already exists.');

    const created = await prisma().$transaction(async (tx) => {
      const account = await tx.userAccount.create({ data: { email, role }, select: STAFF_FIELDS });
      await audit(tx, {
        action: 'staff.created',
        entityType: 'user_account',
        entityId: account.id,
        actorUserId: principal.userId,
        newValue: { role },
        ...clientOf(res),
      });
      return account;
    });
    res.status(201).json({ account: created });
  });

  router.patch('/staff/:id', adminOnly, validate(staffPatchSchema), async (req, res) => {
    const principal = principalOf(res);
    const id = String(req.params.id);
    if (id === principal.userId && req.body.status === 'inactive') {
      throw new HttpError(409, 'conflict', 'You cannot deactivate your own account.');
    }

    const updated = await prisma().$transaction(async (tx) => {
      const before = await tx.userAccount.findUnique({ where: { id }, select: STAFF_FIELDS });
      if (!before || before.role === 'delegate') {
        throw new HttpError(404, 'not_found', 'Staff account not found.');
      }
      const after = await tx.userAccount.update({
        where: { id },
        data: req.body,
        select: STAFF_FIELDS,
      });
      await audit(tx, {
        action: 'staff.updated',
        entityType: 'user_account',
        entityId: id,
        actorUserId: principal.userId,
        oldValue: { role: before.role, status: before.status },
        newValue: { role: after.role, status: after.status },
        ...clientOf(res),
      });
      return after;
    });

    // A deactivated or re-roled user must not keep an old session alive.
    if (updated.status === 'inactive' || req.body.role) await auth.revokeAllSessions(id);
    res.json({ account: updated });
  });

  return router;
}
