import { delegateAccountStatusSchema, type DelegateAccountStatus } from '@mbc/shared';
import { Router } from 'express';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canManageStaff, STAFF_ADMIN_ROLES } from '../auth/policies.js';
import type { ClientContext } from '../auth/service.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';
import { validate } from '../lib/validate.js';

export interface AccountStatusHooks {
  /** Test hook: runs inside the transaction after acceptance and before any write. */
  beforeAccountStatusWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
}

interface Deps {
  prisma: () => PrismaClient;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Pick<Logger, 'error'>;
  now?: () => Date;
  hooks?: AccountStatusHooks;
}

const ACCOUNT_FIELDS = { id: true, role: true, status: true, lastSignInAt: true } as const;

type RefusalReason = 'unknown_account' | 'staff_account' | 'no_change';

/**
 * Delegate account status (E2-13): admin-only, server-authorised on every request. Deactivation
 * revokes every session at once; reactivation only clears the inactive status (the delegate still
 * needs an eligible registration and the normal passwordless verification; no session is
 * restored). Success writes `identity.account_status_changed` inside the transaction; a refusal
 * writes `identity.account_status_refused` and a failure after acceptance writes
 * `identity.account_status_failed`, both outside it (D9 audit contract).
 */
export function delegateAccountRouter({ prisma, middleware, logger, now, hooks }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());

  async function refused(
    accountId: string,
    actorUserId: string,
    client: ClientContext,
    request: DelegateAccountStatus,
    reason: RefusalReason,
  ): Promise<never> {
    try {
      await audit(prisma(), {
        action: 'identity.account_status_refused',
        entityType: 'user_account',
        entityId: accountId,
        actorUserId,
        newValue: { requestedStatus: request.status, reason, reasonCategory: request.reason },
        ...client,
      });
    } catch (error) {
      logger.error({ accountId, reason }, 'account status refusal could not be audited');
      captureException(error, { requestId: `account-status:${accountId}` });
    }
    if (reason === 'unknown_account') {
      throw new HttpError(404, 'not_found', 'Delegate account not found.');
    }
    if (reason === 'staff_account') {
      throw new HttpError(
        409,
        'account_status_refused',
        'Staff accounts are managed under Staff, not here.',
      );
    }
    throw new HttpError(409, 'account_status_refused', 'The account already has that status.');
  }

  router.patch(
    '/delegate-accounts/:accountId',
    middleware.requireRole(...STAFF_ADMIN_ROLES),
    validate(delegateAccountStatusSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!canManageStaff(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const accountId = String(req.params.accountId);
      const request = req.body as DelegateAccountStatus;
      const client = clientOf(res);

      const account = await prisma().userAccount.findUnique({
        where: { id: accountId },
        select: ACCOUNT_FIELDS,
      });
      if (!account) return refused(accountId, principal.userId, client, request, 'unknown_account');
      if (account.role !== 'delegate')
        return refused(accountId, principal.userId, client, request, 'staff_account');
      if (account.status === request.status)
        return refused(accountId, principal.userId, client, request, 'no_change');

      let sessionsRevoked = 0;
      try {
        const updated = await prisma().$transaction(async (tx) => {
          const before = await tx.userAccount.findUniqueOrThrow({
            where: { id: accountId },
            select: ACCOUNT_FIELDS,
          });
          if (before.status === request.status)
            throw new HttpError(
              409,
              'account_status_refused',
              'The account already has that status.',
            );
          await hooks?.beforeAccountStatusWrite?.(tx);
          const after = await tx.userAccount.update({
            where: { id: accountId },
            data: { status: request.status },
            select: ACCOUNT_FIELDS,
          });
          if (request.status === 'inactive') {
            // Every device is signed out at once; nothing is restored on reactivation.
            const revoked = await tx.authSession.updateMany({
              where: { userAccountId: accountId, revokedAt: null },
              data: { revokedAt: clock() },
            });
            sessionsRevoked = revoked.count;
          }
          await audit(tx, {
            action: 'identity.account_status_changed',
            entityType: 'user_account',
            entityId: accountId,
            actorUserId: principal.userId,
            oldValue: { status: before.status },
            newValue: { status: after.status, reasonCategory: request.reason, sessionsRevoked },
            ...client,
          });
          return after;
        });
        res.json({ account: updated, sessionsRevoked });
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) {
          return refused(accountId, principal.userId, client, request, 'no_change');
        }
        logger.error(
          { accountId, name: error instanceof Error ? error.name : 'unknown' },
          'account status change failed; rolled back',
        );
        captureException(error, { requestId: `account-status:${accountId}` });
        try {
          await audit(prisma(), {
            action: 'identity.account_status_failed',
            entityType: 'user_account',
            entityId: accountId,
            actorUserId: principal.userId,
            newValue: { requestedStatus: request.status, reason: 'internal_error' },
            ...client,
          });
        } catch (auditError) {
          logger.error({ accountId }, 'account status failure could not be audited');
          captureException(auditError, { requestId: `account-status:${accountId}` });
        }
        throw new HttpError(
          500,
          'account_status_failed',
          'The status could not be changed. Nothing was changed; you can try again.',
        );
      }
    },
  );

  return router;
}
