import {
  emailCustomisationSchema,
  emailKindInfo,
  emailKinds,
  unknownEmailPlaceholders,
  type EmailCustomisation,
  type EmailKind,
  type EventEmailsResponse,
} from '@mbc/shared';
import { Router, type Response } from 'express';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, EVENT_SETUP_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import { emailCustomisationFor, eventEmailViews, renderSample } from '../mail/customisation.js';

interface Deps {
  prisma: () => PrismaClient;
  /** A thunk: mail settings are read when needed, never at startup. */
  mailConfig: () => MailConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

/**
 * The organisers' own wording for the emails of one event (decision 2026-11-19). Every kind is
 * listed with the platform's wording, the stored one and a preview; a kind is saved on its own,
 * and a preview of unsaved wording is rendered on request. The structure of each email, its
 * facts and its button stay the platform's; only the words around them change.
 */
export function eventEmailsRouter({ prisma, mailConfig, middleware }: Deps): Router {
  const router = Router();
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string) {
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        status: true,
        eventType: true,
        startsOn: true,
        endsOn: true,
        timezone: true,
        location: true,
      },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  function kindOf(raw: unknown): EmailKind {
    const kind = String(raw);
    if (!(emailKinds as readonly string[]).includes(kind)) {
      throw new HttpError(404, 'not_found', 'Unknown kind of email.');
    }
    return kind as EmailKind;
  }

  /** A placeholder the kind does not understand would reach delegates as typed: refused. */
  function assertPlaceholders(kind: EmailKind, custom: EmailCustomisation) {
    const allowed = emailKindInfo[kind].placeholders;
    const unknown = new Set<string>();
    for (const text of [
      custom.subject,
      custom.title,
      custom.intro,
      custom.closing,
      custom.buttonLabel,
    ]) {
      if (text) for (const key of unknownEmailPlaceholders(text, allowed)) unknown.add(key);
    }
    if (unknown.size) {
      throw new HttpError(
        422,
        'unknown_placeholder',
        `Unknown placeholder${unknown.size === 1 ? '' : 's'}: ${[...unknown].map((k) => `{{${k}}}`).join(', ')}. This email understands ${allowed.map((k) => `{{${k}}}`).join(', ')}.`,
      );
    }
  }

  router.get('/events/:eventId/emails', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const body: EventEmailsResponse = {
      emails: await eventEmailViews(prisma(), mailConfig(), event),
    };
    res.json(body);
  });

  router.put(
    '/events/:eventId/emails/:kind',
    guard,
    validate(emailCustomisationSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      if (event.status === 'archived') {
        throw new HttpError(409, 'event_archived', 'An archived event cannot be changed.');
      }
      const kind = kindOf(req.params.kind);
      const custom = req.body as EmailCustomisation;
      assertPlaceholders(kind, custom);
      const previous = await emailCustomisationFor(prisma(), event.id, kind);
      const empty = !Object.values(custom).some((v) => v);
      await prisma().$transaction(async (tx) => {
        if (empty) {
          await tx.eventEmailTemplate.deleteMany({ where: { eventId: event.id, kind } });
        } else {
          await tx.eventEmailTemplate.upsert({
            where: { eventId_kind: { eventId: event.id, kind } },
            create: { eventId: event.id, kind, ...custom },
            update: custom,
          });
        }
        await audit(tx, {
          action: 'event.email_wording_changed',
          entityType: 'event',
          entityId: event.id,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: { kind, custom: previous },
          newValue: { kind, custom: empty ? null : custom },
          ...clientOf(res),
        });
      });
      const views = await eventEmailViews(prisma(), mailConfig(), event);
      res.json({ email: views.find((v) => v.kind === kind) });
    },
  );

  // A preview of wording that is not saved yet, so the organisers see it before committing.
  router.post(
    '/events/:eventId/emails/:kind/preview',
    guard,
    validate(emailCustomisationSchema),
    async (req, res) => {
      requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const kind = kindOf(req.params.kind);
      const custom = req.body as EmailCustomisation;
      assertPlaceholders(kind, custom);
      const config = mailConfig();
      const rendered = renderSample(kind, brandingForEvent(config, event), config.appUrl, custom);
      res.json({ subject: rendered.subject, html: rendered.html });
    },
  );

  return router;
}
