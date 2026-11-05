import {
  reportApproveSchema,
  reportDefaultSections,
  reportKindMeta,
  reportKinds,
  reportQuerySchema,
  reportSections,
  type EventReport,
  type ReportKind,
  type ReportSection,
} from '@mbc/shared';
import { Router, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canConfigureEvents, REPORT_ROLES } from '../auth/policies.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { figureStatuses } from '../lib/eligible.js';
import { HttpError } from '../lib/errors.js';
import { parseBlocks } from '../export/blocks.js';
import { toDocx } from '../export/docx.js';
import { toPdf } from '../export/pdf.js';
import { MEDIA_TYPES, toXlsx, type DownloadFormat } from '../export/xlsx.js';
import { organiserName } from '../mail/branding.js';
import { redactForAudience } from '../reports/audience.js';
import { buildReport, organisationsOf } from '../reports/build.js';
import { renderCsv, renderMarkdown, reportSheets } from '../reports/render.js';
import type { EligibleStatuses } from './assessments.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Event dashboards and reports (task of 2026-10-31; backlog E15, E16): one builder, five
 * kinds. Internal kinds (dashboard, immediate conference report, follow-up report) are for
 * admins on screen and to download. External kinds (organisation, sponsor or partner) are
 * redacted to aggregates and cannot be downloaded until an admin has approved that kind, scope
 * and set of sections; nothing is ever sent anywhere by the platform. Every view of an external
 * report and every download is audited with counts, never content.
 */
export function reportRouter({ prisma, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const guard = middleware.requireRole(...REPORT_ROLES);
  /** Who a report counts: the event's own choice about test delegates, never the sign-in flag. */
  async function eligibleFor(eventId: string): Promise<EligibleStatuses> {
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: { countTestDelegates: true },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return figureStatuses(event);
  }

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canConfigureEvents(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
    const event = await prisma().event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }

  function kindOf(raw: string): ReportKind {
    if (!(reportKinds as readonly string[]).includes(raw)) {
      throw new HttpError(404, 'not_found', 'No such report.');
    }
    return raw as ReportKind;
  }

  function queryOf(raw: unknown) {
    const parsed = reportQuerySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new HttpError(
        422,
        'validation_failed',
        parsed.error.issues[0]?.message ?? 'Bad query.',
      );
    }
    return parsed.data;
  }

  /** The latest approval still in force for this kind and scope. */
  async function approvalFor(eventId: string, kind: ReportKind, scope: string) {
    const row = await prisma().eventReportApproval.findFirst({
      where: { eventId, kind, scope, revokedAt: null },
      orderBy: { approvedAt: 'desc' },
    });
    if (!row) return null;
    const by = await prisma().userAccount.findUnique({
      where: { id: row.approvedByUserId },
      select: { email: true },
    });
    const sections = (Array.isArray(row.sections) ? row.sections : []).filter(
      (s): s is ReportSection => (reportSections as readonly string[]).includes(String(s)),
    );
    return {
      id: row.id,
      sections,
      note: row.note,
      approvedAt: row.approvedAt.toISOString(),
      approvedBy: by?.email ?? null,
    };
  }

  async function reportOf(
    eventId: string,
    kind: ReportKind,
    query: z.infer<typeof reportQuerySchema>,
  ): Promise<EventReport> {
    const meta = reportKindMeta[kind];
    if (kind === 'organisation' && !query.organisation) {
      throw new HttpError(422, 'validation_failed', 'An organisation report needs ?organisation=.');
    }
    const requested = query.sections?.length ? query.sections : reportDefaultSections[kind];
    // Keep report order whatever order the query named them in.
    const sections = reportSections.filter((s) => requested.includes(s));
    const built = await buildReport({
      db: prisma(),
      eligible: await eligibleFor(eventId),
      now: clock(),
      eventId,
      filters: {
        attendanceFormat: query.format ?? null,
        organisation: query.organisation || null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
      sections,
    });
    const redacted = redactForAudience(built, kind);
    let approval: EventReport['approval'] = null;
    if (meta.audience === 'external') {
      const current = await approvalFor(
        eventId,
        kind,
        kind === 'organisation' ? query.organisation! : '',
      );
      approval = {
        required: true,
        current,
        covers: Boolean(current) && sections.every((s) => current!.sections.includes(s)),
      };
    }
    return { kind, audience: meta.audience, ...redacted, approval };
  }

  router.get('/events/:eventId/reports/organisations', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    res.json({
      organisations: await organisationsOf(prisma(), event.id, await eligibleFor(event.id)),
    });
  });

  router.get('/events/:eventId/reports/:kind', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const kind = kindOf(String(req.params.kind));
    const report = await reportOf(event.id, kind, queryOf(req.query));
    if (report.audience === 'external') {
      await audit(prisma(), {
        action: 'report.viewed',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: {
          kind,
          sections: report.sections,
          population: report.population.registered,
          approved: report.approval?.covers ?? false,
        },
        ...clientOf(res),
      });
    }
    res.json({ report });
  });

  router.post('/events/:eventId/reports/:kind/approve', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const kind = kindOf(String(req.params.kind));
    if (reportKindMeta[kind].audience !== 'external') {
      throw new HttpError(
        422,
        'validation_failed',
        'Only external reports are approved for sharing.',
      );
    }
    const parsed = reportApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(
        422,
        'validation_failed',
        parsed.error.issues[0]?.message ?? 'Bad request.',
      );
    }
    const input = parsed.data;
    if (kind === 'organisation' && !input.organisation) {
      throw new HttpError(422, 'validation_failed', 'Name the organisation the report is for.');
    }
    const scope = kind === 'organisation' ? input.organisation! : '';
    const sections = reportSections.filter((s) => input.sections.includes(s));
    const at = clock();
    await prisma().$transaction(async (tx) => {
      await tx.eventReportApproval.updateMany({
        where: { eventId: event.id, kind, scope, revokedAt: null },
        data: { revokedAt: at, revokedByUserId: principal.userId },
      });
      const row = await tx.eventReportApproval.create({
        data: {
          eventId: event.id,
          kind,
          scope,
          sections: sections as unknown as Prisma.InputJsonValue,
          note: input.note,
          approvedAt: at,
          approvedByUserId: principal.userId,
        },
      });
      await audit(tx, {
        action: 'report.approved',
        entityType: 'event_report_approval',
        entityId: row.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: { kind, scope, sections },
        ...clientOf(res),
      });
    });
    res.status(201).json({ approval: await approvalFor(event.id, kind, scope) });
  });

  router.post('/events/:eventId/reports/:kind/revoke', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const kind = kindOf(String(req.params.kind));
    const scope = typeof req.body?.organisation === 'string' ? req.body.organisation.trim() : '';
    const at = clock();
    const revoked = await prisma().$transaction(async (tx) => {
      const result = await tx.eventReportApproval.updateMany({
        where: { eventId: event.id, kind, scope, revokedAt: null },
        data: { revokedAt: at, revokedByUserId: principal.userId },
      });
      if (result.count) {
        await audit(tx, {
          action: 'report.approval_revoked',
          entityType: 'event',
          entityId: event.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: { kind, scope, revoked: result.count },
          ...clientOf(res),
        });
      }
      return result.count;
    });
    res.json({ revoked });
  });

  // Downloads. An external report leaves only once approved for exactly the sections shown.
  router.get('/events/:eventId/reports/:kind/export.:format', guard, async (req, res) => {
    const principal = requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const kind = kindOf(String(req.params.kind));
    const format = String(req.params.format) as DownloadFormat;
    if (!(format in MEDIA_TYPES)) throw new HttpError(404, 'not_found', 'No such format.');
    const report = await reportOf(event.id, kind, queryOf(req.query));
    if (report.approval?.required && !report.approval.covers) {
      throw new HttpError(
        409,
        'approval_required',
        'This report is for an external audience and has not been approved for these sections. Review it and record the approval first.',
      );
    }
    await audit(prisma(), {
      action: 'report.exported',
      entityType: 'event',
      entityId: event.id,
      eventId: event.id,
      actorUserId: principal.userId,
      newValue: {
        kind,
        format,
        sections: report.sections,
        population: report.population.registered,
        approvalId: report.approval?.current?.id ?? null,
      },
      ...clientOf(res),
    });
    // PDF and Word are laid out from the same Markdown an admin reads, so no format can drift.
    const documentMeta = {
      title: `${report.event.name}: ${reportKindMeta[kind].label}`,
      organiser: organiserName(),
      subtitle: `${report.event.name} · ${report.generatedAt}`,
    };
    const body =
      format === 'md'
        ? renderMarkdown(report)
        : format === 'csv'
          ? renderCsv(report)
          : format === 'xlsx'
            ? await toXlsx(reportSheets(report), documentMeta)
            : format === 'pdf'
              ? await toPdf(parseBlocks(renderMarkdown(report)), documentMeta)
              : await toDocx(parseBlocks(renderMarkdown(report)), documentMeta);
    res.setHeader('Content-Type', MEDIA_TYPES[format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.event.code}-${kind}-report.${format}"`,
    );
    res.send(body);
  });

  return router;
}
