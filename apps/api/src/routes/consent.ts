import { consentAcceptSchema, noticeParagraphs, type ConsentNotice } from '@mbc/shared';
import { Router, type Response } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
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

/**
 * The privacy notice and its acceptance (backlog E3-7, brief section 6.4).
 *
 * `GET /consent/privacy` is public: the notice is information a delegate is owed before they hand
 * anything over, so it is readable from the sign-in page without an account. The `/me` routes are
 * the delegate's own state and their acceptance. Acceptance is written for every eligible event
 * record of the identity, so each event's record carries the consent that covers it, and is
 * audited; it is never inferred, and a delegate who has accepted an older version is asked again.
 */
export function consentRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const eligible = () =>
    config.allowTestRegistrations ? (['active', 'test'] as const) : (['active'] as const);

  /** The notice in force: the latest version whose effectiveFrom has passed. */
  async function currentNotice(): Promise<ConsentNotice | null> {
    const row = await prisma().consentNotice.findFirst({
      where: { document: 'privacy', effectiveFrom: { lte: clock() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    return {
      document: 'privacy',
      version: row.version,
      title: row.title,
      headline: row.headline,
      paragraphs: noticeParagraphs(row.body),
      effectiveFrom: row.effectiveFrom.toISOString(),
    };
  }

  /** Every eligible event record of the signed-in delegate; staff have none. */
  async function myDelegateIds(res: Response): Promise<string[]> {
    const principal = principalOf(res);
    if (principal.role !== 'delegate' || !principal.identityId) return [];
    const rows = await prisma().delegate.findMany({
      where: {
        identityId: principal.identityId,
        registrationStatus: { in: [...eligible()] },
        event: { status: { not: 'archived' } },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  router.get('/consent/privacy', async (_req, res) => {
    const notice = await currentNotice();
    if (!notice) throw new HttpError(404, 'not_found', 'No privacy notice is published.');
    res.json({ notice });
  });

  router.get('/me/consent', middleware.requireAuth, async (_req, res) => {
    const principal = principalOf(res);
    const notice = await currentNotice();
    if (principal.role !== 'delegate') {
      // Staff accounts are not asked: the notice is written for delegates about their own records.
      res.json({ notice, outstanding: false, acceptedAt: null, acceptedVersion: null });
      return;
    }
    const delegateIds = await myDelegateIds(res);
    const where = { delegateId: { in: delegateIds }, document: 'privacy' } as const;
    // Whether they have accepted THIS version, asked directly: "their most recent acceptance"
    // would be the wrong question, and would turn on tie-breaking when two rows share a moment.
    const onCurrent =
      delegateIds.length > 0 && notice
        ? await prisma().consentRecord.findFirst({ where: { ...where, version: notice.version } })
        : null;
    const latest = delegateIds.length
      ? await prisma().consentRecord.findFirst({
          where,
          orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }],
        })
      : null;
    const shown = onCurrent ?? latest;
    res.json({
      notice,
      // No notice published means nothing to accept: the platform never blocks on missing content.
      outstanding: Boolean(notice) && !onCurrent,
      acceptedAt: shown?.acceptedAt.toISOString() ?? null,
      acceptedVersion: shown?.version ?? null,
    });
  });

  router.post(
    '/me/consent',
    middleware.requireAuth,
    validate(consentAcceptSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (principal.role !== 'delegate') {
        throw new HttpError(403, 'forbidden', 'Only delegates accept the privacy notice.');
      }
      const notice = await currentNotice();
      if (!notice) throw new HttpError(404, 'not_found', 'No privacy notice is published.');
      if (req.body.version !== notice.version) {
        throw new HttpError(
          409,
          'notice_changed',
          'The privacy notice was updated while this page was open. Read it again and accept the current version.',
        );
      }
      const delegateIds = await myDelegateIds(res);
      if (delegateIds.length === 0) {
        throw new HttpError(404, 'not_found', 'No registration of yours is active.');
      }
      const acceptedAt = clock();
      await prisma().$transaction(async (tx) => {
        for (const delegateId of delegateIds) {
          await tx.consentRecord.upsert({
            where: {
              delegateId_document_version: {
                delegateId,
                document: 'privacy',
                version: notice.version,
              },
            },
            create: { delegateId, document: 'privacy', version: notice.version, acceptedAt },
            update: {},
          });
        }
        await audit(tx, {
          action: 'consent.accepted',
          entityType: 'consent_record',
          entityId: delegateIds[0]!,
          actorUserId: principal.userId,
          // The version and how many records it covers; never the notice text or personal data.
          newValue: { document: 'privacy', version: notice.version, records: delegateIds.length },
          ...clientOf(res),
        });
      });
      res.status(201).json({
        notice,
        outstanding: false,
        acceptedAt: acceptedAt.toISOString(),
        acceptedVersion: notice.version,
      });
    },
  );

  return router;
}
