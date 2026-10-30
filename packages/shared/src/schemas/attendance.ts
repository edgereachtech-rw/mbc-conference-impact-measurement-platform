import { z } from 'zod';

import { participationModes } from './auth.js';
import { delegateListStatuses } from './delegates.js';
import { sessionTypes } from './events.js';

/**
 * Attendance management (attendance requirements, 2026-10-30): recorded per delegate per event
 * date by M.Bryan admins only, by QR check-in, manual lookup or bulk marking, with session
 * attendance on top where practical. Registration and assessment submissions never imply
 * attendance; absence is only recorded once an admin closes the date.
 */

export const attendanceStatuses = ['attended', 'partial', 'absent'] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const attendanceModes = ['physical', 'virtual'] as const;
export type AttendanceMode = (typeof attendanceModes)[number];

export const attendanceMethods = ['qr', 'manual', 'bulk', 'closure', 'correction'] as const;
export type AttendanceMethod = (typeof attendanceMethods)[number];

/** What a delegate's day looks like: no record yet, or the recorded status. */
export const dailyAttendanceStatuses = ['not_checked_in', ...attendanceStatuses] as const;
export type DailyAttendanceStatus = (typeof dailyAttendanceStatuses)[number];

/** Across the event's dates: attended all, some, none (every date closed), or not final yet. */
export const overallAttendanceStatuses = ['attended', 'partial', 'absent', 'pending'] as const;
export type OverallAttendanceStatus = (typeof overallAttendanceStatuses)[number];

export const attendanceStatusLabels: Record<DailyAttendanceStatus, string> = {
  not_checked_in: 'Not checked in',
  attended: 'Attended',
  partial: 'Partially attended',
  absent: 'Absent',
};
export const overallAttendanceLabels: Record<OverallAttendanceStatus, string> = {
  attended: 'Attended',
  partial: 'Partially attended',
  absent: 'Absent',
  pending: 'Pending',
};
export const attendanceMethodLabels: Record<AttendanceMethod, string> = {
  qr: 'QR check-in',
  manual: 'Manual',
  bulk: 'Bulk marking',
  closure: 'Marked at closure',
  correction: 'Correction',
};

/**
 * The overall status from the delegate's dates. Attended every date: attended. Any date still
 * open without full attendance: pending (nobody is absent while a date is open). Present on at
 * least one date: partially attended. Otherwise, every date closed without presence: absent.
 */
export function overallAttendance(
  dates: ReadonlyArray<{ closed: boolean; daily: DailyAttendanceStatus }>,
): OverallAttendanceStatus {
  if (dates.length === 0) return 'pending';
  if (dates.every((d) => d.daily === 'attended')) return 'attended';
  if (dates.some((d) => !d.closed && d.daily !== 'attended' && d.daily !== 'partial')) {
    return 'pending';
  }
  if (dates.some((d) => d.daily === 'attended' || d.daily === 'partial')) return 'partial';
  return 'absent';
}

// ------------------------------------------------------------------ views

const delegateRef = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
  attendanceFormat: z.enum(participationModes),
  registrationStatus: z.enum(delegateListStatuses),
});
export type AttendanceDelegateRef = z.infer<typeof delegateRef>;

export const attendanceRecordViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(attendanceStatuses),
  mode: z.enum(attendanceModes),
  method: z.enum(attendanceMethods),
  note: z.string().nullable(),
  recordedAt: z.string(),
  /** The admin responsible, by sign-in email. */
  recordedBy: z.string().nullable(),
});
export type AttendanceRecordView = z.infer<typeof attendanceRecordViewSchema>;

export const attendanceDateCountsSchema = z.object({
  registered: z.number().int(),
  attended: z.number().int(),
  partial: z.number().int(),
  absent: z.number().int(),
  notCheckedIn: z.number().int(),
  /** Attended or partially attended, by how they were recorded. */
  physical: z.number().int(),
  virtual: z.number().int(),
  /** (attended + partial) ÷ registered × 100, one decimal; null when nobody is registered. */
  rate: z.number().nullable(),
});
export type AttendanceDateCounts = z.infer<typeof attendanceDateCountsSchema>;

export const attendanceDateSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  closedAt: z.string().nullable(),
  counts: attendanceDateCountsSchema,
});
export type AttendanceDate = z.infer<typeof attendanceDateSchema>;

export const attendanceOverviewSchema = z.object({
  dates: z.array(attendanceDateSchema),
  overall: z.object({
    registered: z.number().int(),
    attended: z.number().int(),
    partial: z.number().int(),
    absent: z.number().int(),
    pending: z.number().int(),
    /** Delegates present on at least one date (the "attendee" of backlog E6-5). */
    attendees: z.number().int(),
    rate: z.number().nullable(),
  }),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      eventDateId: z.uuid(),
      date: z.string(),
      title: z.string(),
      sessionType: z.enum(sessionTypes),
      startTime: z.string(),
      endTime: z.string(),
      attended: z.number().int(),
    }),
  ),
  generatedAt: z.string(),
});
export type AttendanceOverview = z.infer<typeof attendanceOverviewSchema>;

export const attendanceRowSchema = z.object({
  delegate: delegateRef,
  daily: z.enum(dailyAttendanceStatuses),
  record: attendanceRecordViewSchema.nullable(),
});
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;

export const attendanceDateListSchema = z.object({
  date: attendanceDateSchema,
  rows: z.array(attendanceRowSchema),
});
export type AttendanceDateList = z.infer<typeof attendanceDateListSchema>;

export const attendanceListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  format: z.enum(participationModes).optional(),
  status: z.enum(dailyAttendanceStatuses).optional(),
});

export const sessionAttendanceListSchema = z.object({
  session: z.object({
    id: z.uuid(),
    eventDateId: z.uuid(),
    date: z.string(),
    title: z.string(),
    startTime: z.string(),
    endTime: z.string(),
  }),
  rows: z.array(
    z.object({
      delegate: delegateRef,
      attended: z.boolean(),
      recordedAt: z.string().nullable(),
      recordedBy: z.string().nullable(),
    }),
  ),
  counts: z.object({
    registered: z.number().int(),
    attended: z.number().int(),
    rate: z.number().nullable(),
  }),
});
export type SessionAttendanceList = z.infer<typeof sessionAttendanceListSchema>;

export const delegateAttendanceProfileSchema = z.object({
  delegate: delegateRef,
  overall: z.enum(overallAttendanceStatuses),
  dates: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      closedAt: z.string().nullable(),
      daily: z.enum(dailyAttendanceStatuses),
      record: attendanceRecordViewSchema.nullable(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      title: z.string(),
      startTime: z.string(),
      attended: z.boolean(),
      recordedAt: z.string().nullable(),
    }),
  ),
  sessionsAttended: z.number().int(),
  sessionsTotal: z.number().int(),
  /** Corrections and closures from the audit log, newest first; never the delegate's answers. */
  history: z.array(
    z.object({
      at: z.string(),
      by: z.string().nullable(),
      action: z.string(),
      from: z.unknown().nullable(),
      to: z.unknown().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});
export type DelegateAttendanceProfile = z.infer<typeof delegateAttendanceProfileSchema>;

/** The delegate's own view: a QR code per date and the recorded status, read-only. */
export const myAttendanceSchema = z.object({
  overall: z.enum(overallAttendanceStatuses),
  dates: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      daily: z.enum(dailyAttendanceStatuses),
      closed: z.boolean(),
      recordedAt: z.string().nullable(),
      /** The code to show at the entrance; carries no personal data. */
      token: z.string(),
    }),
  ),
  sessionsAttended: z.array(z.object({ id: z.uuid(), title: z.string(), date: z.string() })),
});
export type MyAttendance = z.infer<typeof myAttendanceSchema>;

// ------------------------------------------------------------------ commands

const optionalReason = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));

export const attendanceMarkSchema = z.object({
  delegateId: z.uuid(),
  status: z.enum(['attended', 'partial']).default('attended'),
  note: optionalReason,
});
export type AttendanceMark = z.infer<typeof attendanceMarkSchema>;

export const attendanceBulkSchema = z.object({
  delegateIds: z.array(z.uuid()).min(1).max(2_000),
  status: z.enum(['attended', 'partial']).default('attended'),
});
export type AttendanceBulk = z.infer<typeof attendanceBulkSchema>;

export const attendanceScanSchema = z.object({
  /** The QR code's content. */
  token: z.string().trim().min(16).max(200),
  eventDateId: z.uuid(),
});
export type AttendanceScan = z.infer<typeof attendanceScanSchema>;

export const attendanceCorrectionSchema = z.object({
  status: z.enum(attendanceStatuses),
  mode: z.enum(attendanceModes).optional(),
  reason: z.string().trim().min(3, 'Give the reason for the correction').max(500),
});
export type AttendanceCorrection = z.infer<typeof attendanceCorrectionSchema>;

export const attendanceCloseSchema = z.object({
  /** Record every registered delegate without a qualifying record as absent. */
  markAbsent: z.boolean().default(true),
});
export type AttendanceClose = z.infer<typeof attendanceCloseSchema>;

export const sessionAttendanceSetSchema = z
  .object({
    add: z.array(z.uuid()).max(2_000).default([]),
    remove: z.array(z.uuid()).max(2_000).default([]),
    /** Required when removing a recorded presence (a correction). */
    reason: optionalReason,
  })
  .superRefine((v, ctx) => {
    if (v.remove.length && !v.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Give the reason for removing a recorded presence',
      });
    }
  });
export type SessionAttendanceSet = z.infer<typeof sessionAttendanceSetSchema>;
