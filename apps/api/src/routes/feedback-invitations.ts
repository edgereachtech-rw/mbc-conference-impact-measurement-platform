import { feedbackInvitationSendSchema, type FeedbackInvitationState } from '@mbc/shared';
import { Router, type Response } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { validate } from '../lib/validate.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderSessionFeedback } from '../mail/templates/index.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  mailConfig: () => MailConfig;
  mailer: () => Mailer;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Logger;
  now?: () => Date;
}

/** One pass emails at most this many, so a packed session goes out in reviewable batches. */
const BATCH = 300;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Emailing the session feedback form (task of 2026-11-03).
 *
 * The form had a link and a QR code on screen; this puts it in the inbox of the people who were
 * in the room. Only delegates with a recorded attendance for that session are written to, because
 * the form refuses a submission without one — inviting anybody else would be sending them to a
 * door that will not open.
 */
export function feedbackInvitationRouter({
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

  async function loadSession(eventId: string, sessionId: string) {
    if (!UUID.test(sessionId)) throw new HttpError(404, 'not_found', 'Session not found.');
    const session = await prisma().eventSession.findFirst({
      where: { id: sessionId, eventId },
      select: {
        id: true,
        title: true,
        speaker: true,
        startTime: true,
        endTime: true,
        feedbackEnabled: true,
        feedbackCode: true,
        feedbackOpenedAt: true,
        feedbackClosedAt: true,
        eventDateId: true,
        eventDate: { select: { date: true } },
        event: {
          select: {
            id: true,
            name: true,
            status: true,
            startsOn: true,
            endsOn: true,
            timezone: true,
            location: true,
          },
        },
      },
    });
    if (!session) throw new HttpError(404, 'not_found', 'Session not found.');
    return session;
  }

  type Session = Awaited<ReturnType<typeof loadSession>>;

  /** Why the form cannot be emailed, or null when it can. */
  function blocker(session: Session): string | null {
    if (session.event.status === 'archived') return 'This event is archived.';
    if (!session.feedbackEnabled || !session.feedbackCode) {
      return 'Turn session feedback on for this session first; that is what creates the link.';
    }
    // The form opens and closes by hand (2026-11-07): an email only makes sense while it is open.
    if (session.feedbackClosedAt) return 'The feedback form for this session has closed.';
    if (!session.feedbackOpenedAt) {
      return 'Start feedback for this session first; delegates can only answer once it is open.';
    }
    return null;
  }

  async function stateOf(session: Session): Promise<FeedbackInvitationState> {
    const attendee: Prisma.DelegateWhereInput = {
      // Attendees are the delegates checked in on the session's day (2026-11-07).
      attendanceRecords: {
        some: { eventDateId: session.eventDateId, status: { in: ['attended', 'partial'] } },
      },
      registrationStatus: { in: [...eligible()] },
    };
    const [attended, invited, submitted, notSent, notSubmitted, last] = await Promise.all([
      prisma().delegate.count({ where: attendee }),
      prisma().delegate.count({
        where: {
          ...attendee,
          feedbackInvitations: { some: { sessionId: session.id, status: 'sent' } },
        },
      }),
      prisma().delegate.count({
        where: { ...attendee, sessionFeedback: { some: { sessionId: session.id } } },
      }),
      prisma().delegate.count({
        where: {
          ...attendee,
          feedbackInvitations: { none: { sessionId: session.id, status: 'sent' } },
        },
      }),
      prisma().delegate.count({
        where: { ...attendee, sessionFeedback: { none: { sessionId: session.id } } },
      }),
      prisma().sessionFeedbackInvitation.findFirst({
        where: { sessionId: session.id, status: 'sent' },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
    ]);
    const reason = blocker(session);
    return {
      sendable: reason === null,
      reason,
      attended,
      invited,
      submitted,
      notSent,
      notSubmitted,
      lastSentAt: last?.sentAt?.toISOString() ?? null,
    };
  }

  const whenLine = (session: Session) =>
    `${new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: session.event.timezone,
    }).format(session.eventDate.date)}, ${session.startTime}-${session.endTime}`;

  router.get(
    '/events/:eventId/feedback/sessions/:sessionId/invitations',
    guard,
    async (req, res) => {
      requireAdmin(res);
      const session = await loadSession(String(req.params.eventId), String(req.params.sessionId));
      res.json(await stateOf(session));
    },
  );

  router.post(
    '/events/:eventId/feedback/sessions/:sessionId/invitations/send',
    guard,
    validate(feedbackInvitationSendSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const session = await loadSession(String(req.params.eventId), String(req.params.sessionId));
      const at = clock();
      const reason = blocker(session);
      if (reason) throw new HttpError(409, 'not_sendable', reason);

      const { scope } = req.body;
      const recipients = await prisma().delegate.findMany({
        where: {
          attendanceRecords: {
            some: { eventDateId: session.eventDateId, status: { in: ['attended', 'partial'] } },
          },
          registrationStatus: { in: [...eligible()] },
          ...(scope === 'not_sent'
            ? { feedbackInvitations: { none: { sessionId: session.id, status: 'sent' } } }
            : {}),
          ...(scope === 'not_submitted'
            ? { sessionFeedback: { none: { sessionId: session.id } } }
            : {}),
        },
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });

      const branding = brandingForEvent(mailConfig(), session.event);
      const formUrl = `${config.appUrl.replace(/\/+$/, '')}/feedback/${session.feedbackCode}`;
      let justSent = 0;
      let justFailed = 0;
      const transport = mailer();
      for (const delegate of recipients) {
        const rendered = renderSessionFeedback(branding, {
          recipientName: delegate.name,
          sessionTitle: session.title,
          whenLine: whenLine(session),
          speaker: session.speaker ?? undefined,
          formUrl,
        });
        try {
          await transport.send({
            to: delegate.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          await prisma().sessionFeedbackInvitation.create({
            data: { sessionId: session.id, delegateId: delegate.id, status: 'sent', sentAt: at },
          });
          justSent += 1;
        } catch (error) {
          await prisma().sessionFeedbackInvitation.create({
            data: {
              sessionId: session.id,
              delegateId: delegate.id,
              status: 'failed',
              // The reason, never the address.
              error: error instanceof Error ? error.name : 'send_failed',
            },
          });
          justFailed += 1;
        }
      }

      await audit(prisma(), {
        action: 'feedback.invitations_sent',
        entityType: 'event_session',
        entityId: session.id,
        eventId: session.event.id,
        actorUserId: principal.userId,
        newValue: { scope, sent: justSent, failed: justFailed },
        ...clientOf(res),
      });
      if (justSent || justFailed) {
        logger.info({ sent: justSent, failed: justFailed }, 'session feedback invitations');
      }

      res.status(201).json({ ...(await stateOf(session)), justSent, justFailed });
    },
  );

  return router;
}
