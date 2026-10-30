import {
  assessmentStages,
  delegateListStatuses,
  stageWindowState,
  type EventDashboard,
  type StageSummary,
} from '@mbc/shared';
import { Router } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canRunImports, IMPORT_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { stageSummaryFor, type EligibleStatuses } from './assessments.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One summary per event for the admin dashboard page: facts, delegates, every assessment stage
 * with its response counts, and the messages sent. Admin only; nothing personal, only counts.
 */
export function dashboardRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const eligible: EligibleStatuses = config.allowTestRegistrations
    ? ['active', 'test']
    : ['active'];

  router.get(
    '/events/:eventId/dashboard',
    middleware.requireRole(...IMPORT_ROLES),
    async (req, res) => {
      if (!canRunImports(principalOf(res))) throw new HttpError(403, 'forbidden', 'Admins only.');
      const eventId = String(req.params.eventId);
      if (!/^[0-9a-f-]{36}$/i.test(eventId))
        throw new HttpError(404, 'not_found', 'Event not found.');
      const db = prisma();
      const event = await db.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          format: true,
          startsOn: true,
          endsOn: true,
          timezone: true,
          _count: { select: { dates: true, sessions: true, messages: true } },
          assessmentStages: {
            select: {
              id: true,
              eventId: true,
              stage: true,
              enabled: true,
              status: true,
              opensAt: true,
              closesAt: true,
              _count: { select: { questions: { where: { retiredAt: null } } } },
            },
          },
        },
      });
      if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
      const at = clock();

      const [byStatus, signedUp, invited, physical, virtual, messageTotals, lastMessage] =
        await Promise.all([
          db.delegate.groupBy({
            by: ['registrationStatus'],
            where: { eventId },
            _count: { _all: true },
          }),
          db.delegate.count({
            where: {
              eventId,
              registrationStatus: { in: [...eligible] },
              userAccountId: { not: null },
            },
          }),
          db.delegate.count({
            where: {
              eventId,
              registrationStatus: { in: [...eligible] },
              invitations: { some: { sentAt: { not: null } } },
            },
          }),
          db.delegate.count({
            where: {
              eventId,
              registrationStatus: { in: [...eligible] },
              attendanceFormat: 'physical',
            },
          }),
          db.delegate.count({
            where: {
              eventId,
              registrationStatus: { in: [...eligible] },
              attendanceFormat: 'virtual',
            },
          }),
          db.delegateMessage.aggregate({
            where: { eventId },
            _sum: { recipientCount: true, sentCount: true, failedCount: true },
          }),
          db.delegateMessage.findFirst({
            where: { eventId },
            orderBy: { createdAt: 'desc' },
            select: { subject: true, createdAt: true, status: true },
          }),
        ]);
      const statusCounts = Object.fromEntries(delegateListStatuses.map((s) => [s, 0])) as Record<
        (typeof delegateListStatuses)[number],
        number
      >;
      for (const row of byStatus) {
        if (row.registrationStatus in statusCounts) {
          statusCounts[row.registrationStatus as keyof typeof statusCounts] = row._count._all;
        }
      }
      const registered = eligible.reduce((n, s) => n + (statusCounts[s] ?? 0), 0);

      // Every stage is reported, as a disabled draft when the event has no row for it yet.
      const stages: EventDashboard['stages'] = [];
      for (const stage of assessmentStages) {
        const s = event.assessmentStages.find((x) => x.stage === stage) ?? {
          id: '',
          eventId: event.id,
          stage,
          enabled: false,
          status: 'draft' as const,
          opensAt: null,
          closesAt: null,
          _count: { questions: 0 },
        };
        const questions = s._count.questions;
        let summary: Omit<StageSummary, 'statements'> | null = null;
        let nonCompleters = 0;
        if (s.id && s.enabled && questions > 0) {
          const full = await stageSummaryFor(db, s, eligible);
          const { statements: _statements, ...rest } = full;
          summary = rest;
          nonCompleters = Math.max(0, full.invited - full.submitted);
        }
        stages.push({
          stage: s.stage,
          enabled: s.enabled,
          status: s.status,
          opensAt: s.opensAt ? s.opensAt.toISOString() : null,
          closesAt: s.closesAt ? s.closesAt.toISOString() : null,
          window: stageWindowState(s, at),
          questions,
          summary,
          nonCompleters,
        });
      }

      const dashboard: EventDashboard = {
        event: {
          id: event.id,
          name: event.name,
          code: event.slug,
          status: event.status,
          format: event.format,
          startsOn: isoDate(event.startsOn),
          endsOn: isoDate(event.endsOn),
          timezone: event.timezone,
          days: event._count.dates,
          sessions: event._count.sessions,
        },
        delegates: {
          registered,
          signedUp,
          invited,
          physical,
          virtual,
          byStatus: statusCounts,
        },
        stages,
        messages: {
          sent: event._count.messages,
          recipients: messageTotals._sum.recipientCount ?? 0,
          delivered: messageTotals._sum.sentCount ?? 0,
          failed: messageTotals._sum.failedCount ?? 0,
          last: lastMessage
            ? {
                subject: lastMessage.subject,
                createdAt: lastMessage.createdAt.toISOString(),
                status: lastMessage.status,
              }
            : null,
        },
        generatedAt: at.toISOString(),
      };
      res.json({ dashboard });
    },
  );

  return router;
}
