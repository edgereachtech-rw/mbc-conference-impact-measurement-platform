import {
  delegateMessageMaxRecipients,
  delegateMessageSendSchema,
  findUnknownPlaceholders,
  placeholderValuesFor,
  renderMessageBody,
  substitutePlaceholders,
  type DelegateMessageDetail,
  type DelegateMessageSend,
  type DelegateMessageSendResult,
  type DelegateMessageSummary,
} from '@mbc/shared';
import { Router } from 'express';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canMessageDelegates, MESSAGE_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderAdminMessage } from '../mail/templates/index.js';

interface Deps {
  prisma: () => PrismaClient;
  mailer: () => Mailer;
  mailConfig: () => MailConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  logger: Pick<Logger, 'info' | 'error'>;
  now?: () => Date;
}

const SUMMARY_FIELDS = {
  id: true,
  subject: true,
  status: true,
  recipientCount: true,
  sentCount: true,
  failedCount: true,
  createdByUserId: true,
  createdAt: true,
  completedAt: true,
} as const;

type SummaryRow = Prisma.DelegateMessageGetPayload<{ select: typeof SUMMARY_FIELDS }>;

/**
 * Messages from an admin to selected delegates of one event (E2-14). The admin picks recipients by
 * ticking registrations or by the listing filter, writes subject and body with per-recipient
 * placeholders, and the route sends one branded email per distinct address, records the outcome
 * per recipient and audits the send without any address. Admin-only on the server.
 */
export function messageRouter({
  prisma,
  mailer,
  mailConfig,
  middleware,
  logger,
  now,
}: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());

  async function loadEvent(eventId: string) {
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        status: true,
        startsOn: true,
        endsOn: true,
        timezone: true,
        location: true,
      },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  async function summariesOf(rows: SummaryRow[]): Promise<DelegateMessageSummary[]> {
    const actorIds = [...new Set(rows.map((r) => r.createdByUserId))];
    const actors = actorIds.length
      ? await prisma().userAccount.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailOf = new Map(actors.map((a) => [a.id, a.email]));
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      recipientCount: r.recipientCount,
      sentCount: r.sentCount,
      failedCount: r.failedCount,
      sentBy: emailOf.get(r.createdByUserId) ?? null,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    }));
  }

  router.post(
    '/events/:eventId/messages',
    middleware.requireRole(...MESSAGE_ROLES),
    (req, _res, next) => {
      const parsed = delegateMessageSendSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        next(new HttpError(422, 'validation_failed', detail));
        return;
      }
      req.body = parsed.data;
      next();
    },
    async (req, res) => {
      const principal = principalOf(res);
      if (!canMessageDelegates(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
      const event = await loadEvent(String(req.params.eventId));
      if (event.status === 'archived') {
        throw new HttpError(
          409,
          'event_archived',
          'Messages cannot be sent for an archived event.',
        );
      }
      const { subject, body, recipients } = req.body as DelegateMessageSend;

      const unknown = findUnknownPlaceholders(`${subject}\n${body}`);
      if (unknown.length) {
        throw new HttpError(
          422,
          'unknown_placeholder',
          `Unknown placeholder${unknown.length === 1 ? '' : 's'}: ${unknown.map((k) => `{{${k}}}`).join(', ')}. Use firstName, name, email, organisation or eventName.`,
        );
      }

      // Resolve the audience. Merged duplicates are never messaged: the person is reached through
      // the registration they were merged into.
      let where: Prisma.DelegateWhereInput;
      if ('delegateIds' in recipients) {
        const ids = [...new Set(recipients.delegateIds)];
        where = { eventId: event.id, id: { in: ids }, registrationStatus: { not: 'duplicate' } };
        const found = await prisma().delegate.count({ where });
        if (found !== ids.length) {
          throw new HttpError(
            404,
            'not_found',
            'One or more selected registrations do not belong to this event or are merged duplicates.',
          );
        }
      } else {
        const { status, attendanceFormat, q } = recipients.filter;
        if (status === 'duplicate') {
          throw new HttpError(
            422,
            'duplicates_not_messaged',
            'Merged duplicate registrations cannot be messaged.',
          );
        }
        where = {
          eventId: event.id,
          registrationStatus: status ? status : { not: 'duplicate' },
          ...(attendanceFormat ? { attendanceFormat } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                  { organisation: { contains: q, mode: 'insensitive' } },
                  { externalRegistrationId: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
      }
      const candidates = await prisma().delegate.findMany({
        where,
        select: { id: true, name: true, email: true, organisation: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: delegateMessageMaxRecipients + 1,
      });
      if (candidates.length > delegateMessageMaxRecipients) {
        throw new HttpError(
          422,
          'too_many_recipients',
          `A message can go to at most ${delegateMessageMaxRecipients} delegates at once. Narrow the selection and send in batches.`,
        );
      }
      const seen = new Set<string>();
      const targets = candidates.filter((d) => {
        const key = d.email.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const skipped = candidates.length - targets.length;
      if (targets.length === 0) {
        throw new HttpError(422, 'no_recipients', 'No delegates match the selection.');
      }

      const selection: Prisma.InputJsonValue =
        'delegateIds' in recipients
          ? { kind: 'ids', count: new Set(recipients.delegateIds).size }
          : { kind: 'filter', filter: recipients.filter };
      const message = await prisma().$transaction(async (tx) => {
        const created = await tx.delegateMessage.create({
          data: {
            eventId: event.id,
            createdByUserId: principal.userId,
            subject,
            body,
            recipientSelection: selection,
            recipientCount: targets.length,
          },
          select: { id: true },
        });
        await tx.delegateMessageRecipient.createMany({
          data: targets.map((d) => ({ messageId: created.id, delegateId: d.id })),
        });
        return created;
      });

      const branding = brandingForEvent(mailConfig(), event);
      let sent = 0;
      let failed = 0;
      for (const delegate of targets) {
        const values = placeholderValuesFor({ ...delegate, eventName: branding.eventName });
        const rendered = renderAdminMessage(branding, {
          subject: substitutePlaceholders(subject, values),
          body: renderMessageBody(body, values),
        });
        try {
          const result = await mailer().send({
            to: delegate.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          await prisma().delegateMessageRecipient.update({
            where: { messageId_delegateId: { messageId: message.id, delegateId: delegate.id } },
            data: { status: 'sent', sentAt: clock(), providerMessageId: result.messageId },
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          logger.error(
            { messageId: message.id, delegateId: delegate.id, err: error },
            'delegate message could not be sent',
          );
          await prisma().$transaction(async (tx) => {
            await tx.delegateMessageRecipient.update({
              where: { messageId_delegateId: { messageId: message.id, delegateId: delegate.id } },
              data: { status: 'failed', failureReason: 'delivery_failed' },
            });
            await audit(tx, {
              action: 'message.send_failed',
              entityType: 'delegate_message',
              entityId: message.id,
              eventId: event.id,
              actorUserId: principal.userId,
              newValue: { delegateId: delegate.id },
              ...clientOf(res),
            });
          });
        }
      }

      const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partially_failed';
      await prisma().$transaction(async (tx) => {
        await tx.delegateMessage.update({
          where: { id: message.id },
          data: { status, sentCount: sent, failedCount: failed, completedAt: clock() },
        });
        await audit(tx, {
          action: 'message.sent',
          entityType: 'delegate_message',
          entityId: message.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: {
            status,
            recipientCount: targets.length,
            sent,
            failed,
            skipped,
            selection,
          },
          ...clientOf(res),
        });
      });
      logger.info(
        { eventId: event.id, messageId: message.id, sent, failed },
        'delegate message sent',
      );
      const result: DelegateMessageSendResult = {
        messageId: message.id,
        total: targets.length,
        sent,
        failed,
        skipped,
      };
      res.status(201).json(result);
    },
  );

  router.get(
    '/events/:eventId/messages',
    middleware.requireRole(...MESSAGE_ROLES),
    async (req, res) => {
      if (!canMessageDelegates(principalOf(res)))
        throw new HttpError(403, 'forbidden', 'Admins only.');
      const event = await loadEvent(String(req.params.eventId));
      const rows = await prisma().delegateMessage.findMany({
        where: { eventId: event.id },
        select: SUMMARY_FIELDS,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100,
      });
      res.json({ messages: await summariesOf(rows) });
    },
  );

  router.get(
    '/events/:eventId/messages/:messageId',
    middleware.requireRole(...MESSAGE_ROLES),
    async (req, res) => {
      if (!canMessageDelegates(principalOf(res)))
        throw new HttpError(403, 'forbidden', 'Admins only.');
      const event = await loadEvent(String(req.params.eventId));
      const row = await prisma().delegateMessage.findFirst({
        where: { id: String(req.params.messageId), eventId: event.id },
        select: {
          ...SUMMARY_FIELDS,
          body: true,
          recipients: {
            select: {
              delegateId: true,
              status: true,
              sentAt: true,
              delegate: { select: { name: true, email: true } },
            },
            orderBy: { delegate: { name: 'asc' } },
          },
        },
      });
      if (!row) throw new HttpError(404, 'not_found', 'Message not found.');
      const [summary] = await summariesOf([row]);
      const detail: DelegateMessageDetail = {
        ...summary!,
        body: row.body,
        recipients: row.recipients.map((r) => ({
          delegateId: r.delegateId,
          name: r.delegate.name,
          email: r.delegate.email,
          status: r.status,
          sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        })),
      };
      res.json({ message: detail });
    },
  );

  return router;
}
