import { invitationSendSchema, type InvitationSend } from '@mbc/shared';
import { Router } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canManageStaff, STAFF_ADMIN_ROLES } from '../auth/policies.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { genericBranding, loadEventBranding } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderInvitation } from '../mail/templates/index.js';

interface Deps {
  prisma: () => PrismaClient;
  mailer: () => Mailer;
  config: AuthConfig;
  mailConfig: () => MailConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Pick<Logger, 'info' | 'error'>;
  now?: () => Date;
}

/**
 * Invitation validity in days. Not a product decision in the backlog, so there is no default: the
 * setting must be present (development and staging use a rehearsal value) or sending is refused.
 */
export function invitationTtlDays(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.INVITATION_TTL_DAYS?.trim();
  if (!raw) return null;
  const days = Number(raw);
  return Number.isInteger(days) && days > 0 ? days : null;
}

/**
 * Invitations (E3-1): a single-use link tied to the imported registration that opens the normal
 * sign-in flow with the email pre-filled. No separate account step exists: accepted means first
 * sign-in (set by the verification). Resending revokes the previous open invitation. Admin-only.
 */
export function invitationRouter({
  prisma,
  mailer,
  config,
  mailConfig,
  middleware,
  logger,
  now,
}: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());

  router.post(
    '/events/:eventId/invitations',
    middleware.requireRole(...STAFF_ADMIN_ROLES),
    (req, _res, next) => {
      const parsed = invitationSendSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        next(new HttpError(422, 'validation_failed', 'delegateIds: a list of registration ids.'));
        return;
      }
      req.body = parsed.data;
      next();
    },
    async (req, res) => {
      const principal = principalOf(res);
      if (!canManageStaff(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const ttlDays = invitationTtlDays();
      if (!ttlDays) {
        throw new HttpError(
          409,
          'invitations_not_configured',
          'INVITATION_TTL_DAYS is not set; invitations cannot be sent until the validity period is configured.',
        );
      }
      const eventId = String(req.params.eventId);
      const event = await prisma().event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          name: true,
          status: true,
          startsOn: true,
          endsOn: true,
          location: true,
        },
      });
      if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
      if (event.status === 'archived')
        throw new HttpError(
          409,
          'event_archived',
          'Invitations cannot be sent for an archived event.',
        );

      const { delegateIds } = req.body as InvitationSend;
      const eligible = config.allowTestRegistrations
        ? (['active', 'test'] as const)
        : (['active'] as const);
      const targets = await prisma().delegate.findMany({
        where: {
          eventId,
          registrationStatus: { in: [...eligible] },
          identityId: { not: null },
          ...(delegateIds ? { id: { in: delegateIds } } : {}),
        },
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: 'asc' },
      });
      if (delegateIds && targets.length !== new Set(delegateIds).size) {
        throw new HttpError(
          404,
          'not_found',
          'One or more registrations are not eligible registrations of this event.',
        );
      }

      const branding =
        (await loadEventBranding(prisma(), mailConfig())) ?? genericBranding(mailConfig());
      const eventSummary = `${event.startsOn.toISOString().slice(0, 10)} to ${event.endsOn.toISOString().slice(0, 10)}${event.location ? `, ${event.location}` : ''}`;
      const now = clock();
      const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
      let sent = 0;
      let failed = 0;
      for (const delegate of targets) {
        const rawToken = generateToken();
        const invitation = await prisma().$transaction(async (tx) => {
          await tx.invitation.updateMany({
            where: { delegateId: delegate.id, status: { in: ['pending', 'sent'] } },
            data: { status: 'revoked' },
          });
          return tx.invitation.create({
            data: { delegateId: delegate.id, tokenHash: hashToken(rawToken), expiresAt },
            select: { id: true },
          });
        });
        const rendered = renderInvitation(branding, {
          recipientName: delegate.name,
          inviteUrl: `${config.appUrl}/signin?invite=${encodeURIComponent(rawToken)}`,
          expiresInMinutes: ttlDays * 24 * 60,
          eventSummary,
        });
        try {
          await mailer().send({
            to: delegate.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          await prisma().$transaction(async (tx) => {
            await tx.invitation.update({
              where: { id: invitation.id },
              data: { status: 'sent', sentAt: now },
            });
            await audit(tx, {
              action: 'invitation.sent',
              entityType: 'invitation',
              entityId: invitation.id,
              eventId,
              actorUserId: principal.userId,
              newValue: { delegateId: delegate.id, expiresAt: expiresAt.toISOString() },
              ...clientOf(res),
            });
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          logger.error(
            { invitationId: invitation.id, err: error },
            'invitation email could not be sent',
          );
          await audit(prisma(), {
            action: 'invitation.send_failed',
            entityType: 'invitation',
            entityId: invitation.id,
            eventId,
            actorUserId: principal.userId,
            newValue: { delegateId: delegate.id },
            ...clientOf(res),
          });
        }
      }
      logger.info({ eventId, sent, failed }, 'invitations sent');
      res.json({ sent, failed, total: targets.length });
    },
  );

  // The sign-in page resolves an invitation link to the email it pre-fills. Opening the link does
  // not consume it (mail scanners prefetch links); accepted is set by the first sign-in.
  router.get('/auth/invitations/:token', async (req, res) => {
    const token = String(req.params.token);
    if (token.length < 20 || token.length > 256)
      throw new HttpError(404, 'not_found', 'Invitation not found.');
    const invitation = await prisma().invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        status: true,
        expiresAt: true,
        delegate: { select: { email: true, event: { select: { name: true, status: true } } } },
      },
    });
    const now = clock();
    if (
      !invitation ||
      (invitation.status !== 'sent' && invitation.status !== 'pending') ||
      (invitation.expiresAt && invitation.expiresAt <= now) ||
      invitation.delegate.event.status === 'archived'
    ) {
      throw new HttpError(
        404,
        'not_found',
        'This invitation link is no longer valid. Sign in with your registered email instead.',
      );
    }
    res.json({ email: invitation.delegate.email, eventName: invitation.delegate.event.name });
  });

  return router;
}
