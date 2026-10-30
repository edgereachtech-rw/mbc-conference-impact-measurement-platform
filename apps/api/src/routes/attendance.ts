import { createHmac } from 'node:crypto';

import {
  attendanceBulkSchema,
  attendanceCloseSchema,
  attendanceCorrectionSchema,
  attendanceListQuerySchema,
  attendanceMarkSchema,
  attendanceScanSchema,
  overallAttendance,
  sessionAttendanceSetSchema,
  type AttendanceDate,
  type AttendanceDateCounts,
  type AttendanceDelegateRef,
  type AttendanceOverview,
  type AttendanceRecordView,
  type AttendanceRow,
  type DailyAttendanceStatus,
  type DelegateAttendanceProfile,
  type MyAttendance,
  type SessionAttendanceList,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { z } from 'zod';

import type { AuthConfig } from '../auth/config.js';
import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canRunImports, IMPORT_ROLES } from '../auth/policies.js';
import { hashToken } from '../auth/tokens.js';
import type { PrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';

interface Deps {
  prisma: () => PrismaClient;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
  now?: () => Date;
}

type Eligible = readonly ('active' | 'test')[];
const UUID = /^[0-9a-f-]{36}$/i;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

function validated<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body ?? {});
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
  };
}

const DELEGATE_SELECT = {
  id: true,
  name: true,
  email: true,
  organisation: true,
  attendanceFormat: true,
  registrationStatus: true,
} as const;

const RECORD_SELECT = {
  id: true,
  delegateId: true,
  eventDateId: true,
  status: true,
  mode: true,
  method: true,
  note: true,
  recordedAt: true,
  recordedByUserId: true,
} as const;
type RecordRow = Prisma.AttendanceRecordGetPayload<{ select: typeof RECORD_SELECT }>;

/**
 * The QR code's content for one delegate on one date: a keyed hash, so it carries no personal
 * data, cannot be guessed, and can be shown again without storing it (only its hash is kept).
 */
export function attendanceToken(secret: string, delegateId: string, eventDateId: string): string {
  return createHmac('sha256', secret)
    .update(`attendance:${delegateId}:${eventDateId}`)
    .digest('base64url');
}

function countsOf(
  delegates: ReadonlyArray<{ id: string }>,
  records: ReadonlyMap<string, RecordRow>,
): AttendanceDateCounts {
  const counts = {
    registered: delegates.length,
    attended: 0,
    partial: 0,
    absent: 0,
    notCheckedIn: 0,
    physical: 0,
    virtual: 0,
    rate: null as number | null,
  };
  for (const d of delegates) {
    const r = records.get(d.id);
    if (!r) counts.notCheckedIn += 1;
    else {
      counts[r.status] += 1;
      if (r.status !== 'absent') counts[r.mode] += 1;
    }
  }
  const present = counts.attended + counts.partial;
  counts.rate = counts.registered ? round1((present / counts.registered) * 100) : null;
  return counts;
}

/**
 * Attendance management (attendance requirements, 2026-10-30), admins only: per-date lists
 * with QR check-in, manual and bulk marking, corrections with an audit trail, closure with
 * absences, session attendance, overviews and per-delegate profiles; plus the delegate's own
 * read-only view with their QR codes.
 */
export function attendanceRouter({ prisma, config, middleware, now }: Deps): Router {
  const router = Router();
  const clock = now ?? (() => new Date());
  const eligible: Eligible = config.allowTestRegistrations ? ['active', 'test'] : ['active'];
  const guard = middleware.requireRole(...IMPORT_ROLES);

  function requireAdmin(res: Response) {
    const principal = principalOf(res);
    if (!canRunImports(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  }

  async function loadEvent(eventId: string) {
    if (!UUID.test(eventId)) throw new HttpError(404, 'not_found', 'Event not found.');
    const event = await prisma().event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        status: true,
        dates: {
          orderBy: { date: 'asc' },
          select: { id: true, date: true, attendanceClosedAt: true },
        },
        sessions: {
          orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            eventDateId: true,
            title: true,
            sessionType: true,
            startTime: true,
            endTime: true,
            eventDate: { select: { date: true } },
          },
        },
      },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    return event;
  }
  type EventRow = Awaited<ReturnType<typeof loadEvent>>;

  function dateOf(event: EventRow, dateId: string) {
    const date = event.dates.find((d) => d.id === dateId);
    if (!date) throw new HttpError(404, 'not_found', 'Event date not found.');
    return date;
  }

  async function registered(eventId: string) {
    return prisma().delegate.findMany({
      where: { eventId, registrationStatus: { in: [...eligible] } },
      select: DELEGATE_SELECT,
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async function emailsOf(userIds: Iterable<string>) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map<string, string>();
    const accounts = await prisma().userAccount.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    });
    return new Map(accounts.map((a) => [a.id, a.email]));
  }

  const recordView = (r: RecordRow, emails: ReadonlyMap<string, string>): AttendanceRecordView => ({
    id: r.id,
    status: r.status,
    mode: r.mode,
    method: r.method,
    note: r.note,
    recordedAt: r.recordedAt.toISOString(),
    recordedBy: emails.get(r.recordedByUserId) ?? null,
  });
  const dailyOf = (r: RecordRow | undefined): DailyAttendanceStatus =>
    r?.status ?? 'not_checked_in';

  async function recordsFor(eventId: string, eventDateId?: string) {
    const rows = await prisma().attendanceRecord.findMany({
      where: { eventId, ...(eventDateId ? { eventDateId } : {}) },
      select: RECORD_SELECT,
    });
    return rows;
  }

  /** Counts per date and the overall picture; shared by the overview route and the dashboard. */
  async function overviewOf(event: EventRow): Promise<AttendanceOverview> {
    const [delegates, records, sessionCounts] = await Promise.all([
      registered(event.id),
      recordsFor(event.id),
      prisma().sessionAttendance.groupBy({
        by: ['sessionId'],
        where: { eventId: event.id },
        _count: { _all: true },
      }),
    ]);
    const byDate = new Map<string, Map<string, RecordRow>>();
    for (const r of records) {
      const m = byDate.get(r.eventDateId) ?? new Map<string, RecordRow>();
      m.set(r.delegateId, r);
      byDate.set(r.eventDateId, m);
    }
    const dates: AttendanceDate[] = event.dates.map((d) => ({
      id: d.id,
      date: isoDate(d.date),
      closedAt: d.attendanceClosedAt ? d.attendanceClosedAt.toISOString() : null,
      counts: countsOf(delegates, byDate.get(d.id) ?? new Map()),
    }));
    const overall = {
      registered: delegates.length,
      attended: 0,
      partial: 0,
      absent: 0,
      pending: 0,
      attendees: 0,
      rate: null as number | null,
    };
    for (const delegate of delegates) {
      const days = event.dates.map((d) => ({
        closed: d.attendanceClosedAt !== null,
        daily: dailyOf(byDate.get(d.id)?.get(delegate.id)),
      }));
      overall[overallAttendance(days)] += 1;
      if (days.some((x) => x.daily === 'attended' || x.daily === 'partial')) overall.attendees += 1;
    }
    overall.rate = overall.registered
      ? round1((overall.attendees / overall.registered) * 100)
      : null;
    const attendedBySession = new Map(sessionCounts.map((s) => [s.sessionId, s._count._all]));
    return {
      dates,
      overall,
      sessions: event.sessions.map((s) => ({
        id: s.id,
        eventDateId: s.eventDateId,
        date: isoDate(s.eventDate.date),
        title: s.title,
        sessionType: s.sessionType,
        startTime: s.startTime,
        endTime: s.endTime,
        attended: attendedBySession.get(s.id) ?? 0,
      })),
      generatedAt: clock().toISOString(),
    };
  }

  /** Validates a scanned code against the event and the selected date; the delegate it names. */
  async function resolveScan(event: EventRow, token: string, eventDateId: string) {
    const date = dateOf(event, eventDateId);
    const found = await prisma().attendanceToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        eventId: true,
        eventDateId: true,
        revokedAt: true,
        delegate: { select: DELEGATE_SELECT },
        eventDate: { select: { date: true } },
      },
    });
    if (!found || found.eventId !== event.id) {
      throw new HttpError(404, 'invalid_code', 'This code is not a delegate code for this event.');
    }
    if (found.revokedAt) throw new HttpError(409, 'code_revoked', 'This code is no longer valid.');
    if (found.eventDateId !== date.id) {
      throw new HttpError(
        409,
        'wrong_date',
        `This code is for ${isoDate(found.eventDate.date)}, not the selected date.`,
      );
    }
    if (!eligible.includes(found.delegate.registrationStatus as Eligible[number])) {
      throw new HttpError(409, 'not_registered', 'This registration is not active.');
    }
    const record = await prisma().attendanceRecord.findUnique({
      where: { delegateId_eventDateId: { delegateId: found.delegate.id, eventDateId: date.id } },
      select: RECORD_SELECT,
    });
    return { date, delegate: found.delegate, record };
  }

  // ---------------------------------------------------------------- admin: overview and lists

  router.get('/events/:eventId/attendance', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    res.json({ overview: await overviewOf(event) });
  });

  router.get('/events/:eventId/attendance/dates/:dateId', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const date = dateOf(event, String(req.params.dateId));
    const query = attendanceListQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(422, 'validation_failed', 'Invalid filters.');
    const [delegates, records] = await Promise.all([
      registered(event.id),
      recordsFor(event.id, date.id),
    ]);
    const byDelegate = new Map(records.map((r) => [r.delegateId, r]));
    const emails = await emailsOf(records.map((r) => r.recordedByUserId));
    const q = query.data.q?.toLowerCase();
    const rows: AttendanceRow[] = delegates
      .filter((d) => !query.data.format || d.attendanceFormat === query.data.format)
      .filter(
        (d) =>
          !q ||
          d.name.toLowerCase().includes(q) ||
          d.email.toLowerCase().includes(q) ||
          (d.organisation ?? '').toLowerCase().includes(q),
      )
      .map((d) => {
        const r = byDelegate.get(d.id);
        return { delegate: d, daily: dailyOf(r), record: r ? recordView(r, emails) : null };
      })
      .filter((row) => !query.data.status || row.daily === query.data.status);
    res.json({
      date: {
        id: date.id,
        date: isoDate(date.date),
        closedAt: date.attendanceClosedAt ? date.attendanceClosedAt.toISOString() : null,
      },
      counts: countsOf(delegates, byDelegate),
      rows,
    });
  });

  // ---------------------------------------------------------------- admin: recording

  async function createRecord(
    res: Response,
    event: EventRow,
    date: EventRow['dates'][number],
    delegate: AttendanceDelegateRef,
    input: {
      status: 'attended' | 'partial';
      method: 'qr' | 'manual' | 'bulk';
      mode?: 'physical' | 'virtual';
      note?: string | null;
    },
  ) {
    const principal = requireAdmin(res);
    const at = clock();
    return prisma().$transaction(async (tx) => {
      const row = await tx.attendanceRecord.create({
        data: {
          eventId: event.id,
          delegateId: delegate.id,
          eventDateId: date.id,
          status: input.status,
          mode: input.mode ?? delegate.attendanceFormat,
          method: input.method,
          note: input.note ?? null,
          recordedByUserId: principal.userId,
          recordedAt: at,
        },
        select: RECORD_SELECT,
      });
      await audit(tx, {
        action: 'attendance.recorded',
        entityType: 'attendance_record',
        entityId: row.id,
        eventId: event.id,
        actorUserId: principal.userId,
        newValue: {
          delegateId: delegate.id,
          eventDateId: date.id,
          date: isoDate(date.date),
          status: row.status,
          mode: row.mode,
          method: row.method,
        },
        ...clientOf(res),
      });
      return row;
    });
  }

  router.post(
    '/events/:eventId/attendance/scan',
    guard,
    validated(attendanceScanSchema),
    async (req, res) => {
      requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const { token, eventDateId } = req.body as z.infer<typeof attendanceScanSchema>;
      const { date, delegate, record } = await resolveScan(event, token, eventDateId);
      const emails = record ? await emailsOf([record.recordedByUserId]) : new Map<string, string>();
      res.json({
        delegate,
        date: { id: date.id, date: isoDate(date.date) },
        record: record ? recordView(record, emails) : null,
      });
    },
  );

  router.post(
    '/events/:eventId/attendance/check-in',
    guard,
    validated(attendanceScanSchema),
    async (req, res) => {
      const event = await loadEvent(String(req.params.eventId));
      const { token, eventDateId } = req.body as z.infer<typeof attendanceScanSchema>;
      const { date, delegate, record } = await resolveScan(event, token, eventDateId);
      if (record) {
        throw new HttpError(
          409,
          'already_recorded',
          'Attendance is already recorded for this date.',
        );
      }
      const row = await createRecord(res, event, date, delegate, {
        status: 'attended',
        method: 'qr',
        mode: 'physical',
      });
      const emails = await emailsOf([row.recordedByUserId]);
      res.status(201).json({ delegate, record: recordView(row, emails) });
    },
  );

  router.post(
    '/events/:eventId/attendance/dates/:dateId/mark',
    guard,
    validated(attendanceMarkSchema),
    async (req, res) => {
      const event = await loadEvent(String(req.params.eventId));
      const date = dateOf(event, String(req.params.dateId));
      const input = req.body as z.infer<typeof attendanceMarkSchema>;
      const delegate = await prisma().delegate.findFirst({
        where: {
          id: input.delegateId,
          eventId: event.id,
          registrationStatus: { in: [...eligible] },
        },
        select: DELEGATE_SELECT,
      });
      if (!delegate) throw new HttpError(404, 'not_found', 'No active registration with this id.');
      const existing = await prisma().attendanceRecord.findUnique({
        where: { delegateId_eventDateId: { delegateId: delegate.id, eventDateId: date.id } },
        select: { id: true },
      });
      if (existing) {
        throw new HttpError(
          409,
          'already_recorded',
          'Attendance is already recorded for this date; use a correction to change it.',
        );
      }
      const row = await createRecord(res, event, date, delegate, {
        status: input.status,
        method: 'manual',
        note: input.note,
      });
      const emails = await emailsOf([row.recordedByUserId]);
      res.status(201).json({ record: recordView(row, emails) });
    },
  );

  router.post(
    '/events/:eventId/attendance/dates/:dateId/bulk',
    guard,
    validated(attendanceBulkSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const date = dateOf(event, String(req.params.dateId));
      const input = req.body as z.infer<typeof attendanceBulkSchema>;
      const ids = [...new Set(input.delegateIds)];
      const [delegates, existing] = await Promise.all([
        prisma().delegate.findMany({
          where: { id: { in: ids }, eventId: event.id, registrationStatus: { in: [...eligible] } },
          select: DELEGATE_SELECT,
        }),
        prisma().attendanceRecord.findMany({
          where: { eventDateId: date.id, delegateId: { in: ids } },
          select: { delegateId: true },
        }),
      ]);
      const known = new Map(delegates.map((d) => [d.id, d]));
      const recorded = new Set(existing.map((r) => r.delegateId));
      const skipped: Array<{ delegateId: string; reason: string }> = [];
      const toCreate: AttendanceDelegateRef[] = [];
      for (const id of ids) {
        const d = known.get(id);
        if (!d) skipped.push({ delegateId: id, reason: 'No active registration with this id.' });
        else if (recorded.has(id)) skipped.push({ delegateId: id, reason: 'Already recorded.' });
        else toCreate.push(d);
      }
      const at = clock();
      await prisma().$transaction(async (tx) => {
        if (toCreate.length) {
          await tx.attendanceRecord.createMany({
            data: toCreate.map((d) => ({
              eventId: event.id,
              delegateId: d.id,
              eventDateId: date.id,
              status: input.status,
              mode: d.attendanceFormat,
              method: 'bulk' as const,
              recordedByUserId: principal.userId,
              recordedAt: at,
            })),
          });
        }
        await audit(tx, {
          action: 'attendance.bulk_recorded',
          entityType: 'event_date',
          entityId: date.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: {
            date: isoDate(date.date),
            status: input.status,
            created: toCreate.map((d) => d.id),
            skipped,
          },
          ...clientOf(res),
        });
      });
      res.status(201).json({ created: toCreate.length, skipped });
    },
  );

  router.patch(
    '/events/:eventId/attendance/records/:recordId',
    guard,
    validated(attendanceCorrectionSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const recordId = String(req.params.recordId);
      if (!UUID.test(recordId))
        throw new HttpError(404, 'not_found', 'Attendance record not found.');
      const current = await prisma().attendanceRecord.findFirst({
        where: { id: recordId, eventId: event.id },
        select: RECORD_SELECT,
      });
      if (!current) throw new HttpError(404, 'not_found', 'Attendance record not found.');
      const input = req.body as z.infer<typeof attendanceCorrectionSchema>;
      const next = { status: input.status, mode: input.mode ?? current.mode };
      if (next.status === current.status && next.mode === current.mode) {
        throw new HttpError(409, 'no_change', 'The record already has these values.');
      }
      const at = clock();
      const row = await prisma().$transaction(async (tx) => {
        const updated = await tx.attendanceRecord.update({
          where: { id: current.id },
          data: {
            status: next.status,
            mode: next.mode,
            method: 'correction',
            note: input.reason,
            recordedByUserId: principal.userId,
            recordedAt: at,
          },
          select: RECORD_SELECT,
        });
        await audit(tx, {
          action: 'attendance.corrected',
          entityType: 'attendance_record',
          entityId: current.id,
          eventId: event.id,
          actorUserId: principal.userId,
          oldValue: {
            delegateId: current.delegateId,
            eventDateId: current.eventDateId,
            status: current.status,
            mode: current.mode,
            method: current.method,
            recordedAt: current.recordedAt.toISOString(),
            recordedByUserId: current.recordedByUserId,
          },
          newValue: {
            delegateId: current.delegateId,
            eventDateId: current.eventDateId,
            status: next.status,
            mode: next.mode,
            reason: input.reason,
          },
          ...clientOf(res),
        });
        return updated;
      });
      const emails = await emailsOf([row.recordedByUserId]);
      res.json({ record: recordView(row, emails) });
    },
  );

  router.post(
    '/events/:eventId/attendance/dates/:dateId/close',
    guard,
    validated(attendanceCloseSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const date = dateOf(event, String(req.params.dateId));
      if (date.attendanceClosedAt) {
        throw new HttpError(409, 'already_closed', 'Attendance for this date is already closed.');
      }
      const { markAbsent } = req.body as z.infer<typeof attendanceCloseSchema>;
      const [delegates, records] = await Promise.all([
        registered(event.id),
        recordsFor(event.id, date.id),
      ]);
      const recorded = new Set(records.map((r) => r.delegateId));
      const missing = delegates.filter((d) => !recorded.has(d.id));
      const at = clock();
      await prisma().$transaction(async (tx) => {
        await tx.eventDate.update({
          where: { id: date.id },
          data: { attendanceClosedAt: at, attendanceClosedByUserId: principal.userId },
        });
        if (markAbsent && missing.length) {
          await tx.attendanceRecord.createMany({
            data: missing.map((d) => ({
              eventId: event.id,
              delegateId: d.id,
              eventDateId: date.id,
              status: 'absent' as const,
              mode: d.attendanceFormat,
              method: 'closure' as const,
              recordedByUserId: principal.userId,
              recordedAt: at,
            })),
          });
        }
        await audit(tx, {
          action: 'attendance.date_closed',
          entityType: 'event_date',
          entityId: date.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: {
            date: isoDate(date.date),
            markAbsent,
            markedAbsent: markAbsent ? missing.length : 0,
            registered: delegates.length,
            recorded: recorded.size,
          },
          ...clientOf(res),
        });
      });
      res.json({ closedAt: at.toISOString(), markedAbsent: markAbsent ? missing.length : 0 });
    },
  );

  // ---------------------------------------------------------------- admin: sessions

  router.get('/events/:eventId/attendance/sessions/:sessionId', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const session = event.sessions.find((s) => s.id === String(req.params.sessionId));
    if (!session) throw new HttpError(404, 'not_found', 'Session not found.');
    const [delegates, rows] = await Promise.all([
      registered(event.id),
      prisma().sessionAttendance.findMany({
        where: { sessionId: session.id },
        select: { delegateId: true, recordedAt: true, recordedByUserId: true },
      }),
    ]);
    const byDelegate = new Map(rows.map((r) => [r.delegateId, r]));
    const emails = await emailsOf(rows.map((r) => r.recordedByUserId));
    const list: SessionAttendanceList = {
      session: {
        id: session.id,
        eventDateId: session.eventDateId,
        date: isoDate(session.eventDate.date),
        title: session.title,
        startTime: session.startTime,
        endTime: session.endTime,
      },
      rows: delegates.map((d) => {
        const r = byDelegate.get(d.id);
        return {
          delegate: d,
          attended: Boolean(r),
          recordedAt: r ? r.recordedAt.toISOString() : null,
          recordedBy: r ? (emails.get(r.recordedByUserId) ?? null) : null,
        };
      }),
      counts: {
        registered: delegates.length,
        attended: rows.length,
        rate: delegates.length ? round1((rows.length / delegates.length) * 100) : null,
      },
    };
    res.json(list);
  });

  router.post(
    '/events/:eventId/attendance/sessions/:sessionId',
    guard,
    validated(sessionAttendanceSetSchema),
    async (req, res) => {
      const principal = requireAdmin(res);
      const event = await loadEvent(String(req.params.eventId));
      const session = event.sessions.find((s) => s.id === String(req.params.sessionId));
      if (!session) throw new HttpError(404, 'not_found', 'Session not found.');
      const input = req.body as z.infer<typeof sessionAttendanceSetSchema>;
      const add = [...new Set(input.add)];
      const remove = new Set(input.remove);
      const [delegates, existing] = await Promise.all([
        prisma().delegate.findMany({
          where: { id: { in: add }, eventId: event.id, registrationStatus: { in: [...eligible] } },
          select: { id: true },
        }),
        prisma().sessionAttendance.findMany({
          where: { sessionId: session.id, delegateId: { in: [...add, ...remove] } },
          select: { delegateId: true },
        }),
      ]);
      const known = new Set(delegates.map((d) => d.id));
      const present = new Set(existing.map((r) => r.delegateId));
      const toAdd = add.filter((id) => known.has(id) && !present.has(id));
      const toRemove = [...remove].filter((id) => present.has(id));
      const skipped = add.filter((id) => !known.has(id));
      const at = clock();
      await prisma().$transaction(async (tx) => {
        if (toAdd.length) {
          await tx.sessionAttendance.createMany({
            data: toAdd.map((delegateId) => ({
              eventId: event.id,
              delegateId,
              sessionId: session.id,
              recordedByUserId: principal.userId,
              recordedAt: at,
            })),
          });
        }
        if (toRemove.length) {
          await tx.sessionAttendance.deleteMany({
            where: { sessionId: session.id, delegateId: { in: toRemove } },
          });
        }
        await audit(tx, {
          action: 'attendance.session_recorded',
          entityType: 'event_session',
          entityId: session.id,
          eventId: event.id,
          actorUserId: principal.userId,
          newValue: {
            date: isoDate(session.eventDate.date),
            title: session.title,
            added: toAdd,
            removed: toRemove,
            reason: input.reason,
            skipped,
          },
          ...clientOf(res),
        });
      });
      res.json({ added: toAdd.length, removed: toRemove.length, skipped });
    },
  );

  // ---------------------------------------------------------------- admin: one delegate

  router.get('/events/:eventId/attendance/delegates/:delegateId', guard, async (req, res) => {
    requireAdmin(res);
    const event = await loadEvent(String(req.params.eventId));
    const delegateId = String(req.params.delegateId);
    if (!UUID.test(delegateId)) throw new HttpError(404, 'not_found', 'Delegate not found.');
    const delegate = await prisma().delegate.findFirst({
      where: { id: delegateId, eventId: event.id },
      select: DELEGATE_SELECT,
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'Delegate not found.');
    const [records, sessions] = await Promise.all([
      prisma().attendanceRecord.findMany({
        where: { delegateId: delegate.id },
        select: RECORD_SELECT,
      }),
      prisma().sessionAttendance.findMany({
        where: { delegateId: delegate.id },
        select: { sessionId: true, recordedAt: true },
      }),
    ]);
    const byDate = new Map(records.map((r) => [r.eventDateId, r]));
    const emails = await emailsOf(records.map((r) => r.recordedByUserId));
    const history = await prisma().auditLog.findMany({
      where: {
        eventId: event.id,
        action: { in: ['attendance.recorded', 'attendance.corrected'] },
        entityId: { in: records.map((r) => r.id) },
      },
      orderBy: { occurredAt: 'desc' },
      select: { action: true, occurredAt: true, actorUserId: true, oldValue: true, newValue: true },
    });
    const actorEmails = await emailsOf(
      history.map((h) => h.actorUserId).filter((x): x is string => Boolean(x)),
    );
    const days = event.dates.map((d) => ({
      id: d.id,
      date: isoDate(d.date),
      closedAt: d.attendanceClosedAt ? d.attendanceClosedAt.toISOString() : null,
      daily: dailyOf(byDate.get(d.id)),
      record: byDate.has(d.id) ? recordView(byDate.get(d.id)!, emails) : null,
    }));
    const attendedSessions = new Map(sessions.map((s) => [s.sessionId, s.recordedAt]));
    const profile: DelegateAttendanceProfile = {
      delegate,
      overall: overallAttendance(
        days.map((d) => ({ closed: d.closedAt !== null, daily: d.daily })),
      ),
      dates: days,
      sessions: event.sessions.map((s) => ({
        id: s.id,
        date: isoDate(s.eventDate.date),
        title: s.title,
        startTime: s.startTime,
        attended: attendedSessions.has(s.id),
        recordedAt: attendedSessions.get(s.id)?.toISOString() ?? null,
      })),
      sessionsAttended: sessions.length,
      sessionsTotal: event.sessions.length,
      history: history.map((h) => {
        const to = (h.newValue ?? null) as { reason?: unknown } | null;
        return {
          at: h.occurredAt.toISOString(),
          by: h.actorUserId ? (actorEmails.get(h.actorUserId) ?? null) : null,
          action: h.action,
          from: h.oldValue ?? null,
          to: h.newValue ?? null,
          reason: typeof to?.reason === 'string' ? to.reason : null,
        };
      }),
    };
    res.json({ profile });
  });

  // ---------------------------------------------------------------- delegate: own codes and status

  router.get('/me/events/:eventId/attendance', middleware.requireAuth, async (req, res) => {
    const principal = principalOf(res);
    if (principal.role !== 'delegate') {
      throw new HttpError(403, 'forbidden', 'Attendance codes are for registered delegates.');
    }
    const eventId = String(req.params.eventId);
    if (!UUID.test(eventId) || !principal.identityId) {
      throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    }
    const delegate = await prisma().delegate.findFirst({
      where: {
        eventId,
        identityId: principal.identityId,
        registrationStatus: { in: [...eligible] },
        event: { status: { not: 'archived' } },
      },
      select: { id: true },
    });
    if (!delegate) throw new HttpError(404, 'not_found', 'No event of yours has this id.');
    const event = await loadEvent(eventId);
    const [records, sessions, tokens] = await Promise.all([
      prisma().attendanceRecord.findMany({
        where: { delegateId: delegate.id },
        select: RECORD_SELECT,
      }),
      prisma().sessionAttendance.findMany({
        where: { delegateId: delegate.id },
        select: { sessionId: true },
      }),
      prisma().attendanceToken.findMany({
        where: { delegateId: delegate.id },
        select: { eventDateId: true, revokedAt: true },
      }),
    ]);
    // Codes exist from the first time the delegate opens this screen; nothing is sent by email.
    const have = new Set(tokens.filter((t) => !t.revokedAt).map((t) => t.eventDateId));
    const missing = event.dates.filter((d) => !have.has(d.id));
    if (missing.length) {
      await prisma().attendanceToken.createMany({
        data: missing.map((d) => ({
          eventId,
          delegateId: delegate.id,
          eventDateId: d.id,
          tokenHash: hashToken(attendanceToken(config.hashSecret, delegate.id, d.id)),
        })),
        skipDuplicates: true,
      });
    }
    const byDate = new Map(records.map((r) => [r.eventDateId, r]));
    const days = event.dates.map((d) => {
      const r = byDate.get(d.id);
      return {
        id: d.id,
        date: isoDate(d.date),
        daily: dailyOf(r),
        closed: d.attendanceClosedAt !== null,
        recordedAt: r && r.status !== 'absent' ? r.recordedAt.toISOString() : null,
        token: attendanceToken(config.hashSecret, delegate.id, d.id),
      };
    });
    const attended = new Set(sessions.map((s) => s.sessionId));
    const mine: MyAttendance = {
      overall: overallAttendance(days.map((d) => ({ closed: d.closed, daily: d.daily }))),
      dates: days,
      sessionsAttended: event.sessions
        .filter((s) => attended.has(s.id))
        .map((s) => ({ id: s.id, title: s.title, date: isoDate(s.eventDate.date) })),
    };
    res.json({ attendance: mine });
  });

  return router;
}

/** For the dashboard: the overview without an HTTP request. */
export async function attendanceOverviewFor(
  deps: Pick<Deps, 'prisma' | 'config' | 'now'>,
  eventId: string,
): Promise<AttendanceOverview | null> {
  const prisma = deps.prisma();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      dates: {
        orderBy: { date: 'asc' },
        select: { id: true, date: true, attendanceClosedAt: true },
      },
    },
  });
  if (!event) return null;
  const eligible: Eligible = deps.config.allowTestRegistrations ? ['active', 'test'] : ['active'];
  const [delegates, records] = await Promise.all([
    prisma.delegate.findMany({
      where: { eventId, registrationStatus: { in: [...eligible] } },
      select: { id: true },
    }),
    prisma.attendanceRecord.findMany({ where: { eventId }, select: RECORD_SELECT }),
  ]);
  const byDate = new Map<string, Map<string, RecordRow>>();
  for (const r of records) {
    const m = byDate.get(r.eventDateId) ?? new Map<string, RecordRow>();
    m.set(r.delegateId, r);
    byDate.set(r.eventDateId, m);
  }
  const overall = {
    registered: delegates.length,
    attended: 0,
    partial: 0,
    absent: 0,
    pending: 0,
    attendees: 0,
    rate: null as number | null,
  };
  for (const d of delegates) {
    const days = event.dates.map((x) => ({
      closed: x.attendanceClosedAt !== null,
      daily: (byDate.get(x.id)?.get(d.id)?.status ?? 'not_checked_in') as DailyAttendanceStatus,
    }));
    overall[overallAttendance(days)] += 1;
    if (days.some((x) => x.daily === 'attended' || x.daily === 'partial')) overall.attendees += 1;
  }
  overall.rate = overall.registered ? round1((overall.attendees / overall.registered) * 100) : null;
  return {
    dates: event.dates.map((d) => ({
      id: d.id,
      date: isoDate(d.date),
      closedAt: d.attendanceClosedAt ? d.attendanceClosedAt.toISOString() : null,
      counts: countsOf(delegates, byDate.get(d.id) ?? new Map()),
    })),
    overall,
    sessions: [],
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
}
