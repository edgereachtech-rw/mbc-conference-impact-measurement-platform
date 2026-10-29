import { z } from 'zod';

import { participationModes } from './auth.js';

/**
 * Registration import contracts shared by the API and the admin screen (backlog E2-1, E2-8,
 * D3, D4, D6). Only shapes live here; matching rules are server-side.
 */

/** Platform fields a file column can be mapped to (D4). Attendance is never one of them (D1.4). */
export const importFields = [
  'email',
  'name',
  'attendanceFormat',
  'organisation',
  'jobTitle',
  'country',
  'capacity',
  'nominatingOrganisation',
  'registrationStatus',
  'externalRegistrationId',
] as const;
export type ImportField = (typeof importFields)[number];

export const importRequiredFields = ['email', 'name', 'attendanceFormat'] as const;

/** Decided limits (OQ-22): 10 MB and 5,000 data rows per file; .csv and .xlsx only. */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5_000;
export const IMPORT_FILE_EXTENSIONS = ['.csv', '.xlsx'] as const;
/** A preview is valid for 30 minutes after it is produced (D3 step 5). */
export const IMPORT_PREVIEW_TTL_MINUTES = 30;

const column = z.string().trim().min(1).max(200);

/** Column mapping confirmed by the admin. `name` may join a first and a last name column (D4). */
export const importMappingSchema = z.object({
  email: column,
  name: z.union([column, z.object({ first: column, last: column })]),
  /** Optional only when `attendanceFormatDefault` is given for the whole run (D4). */
  attendanceFormat: column.nullable().optional(),
  organisation: column.nullable().optional(),
  jobTitle: column.nullable().optional(),
  country: column.nullable().optional(),
  capacity: column.nullable().optional(),
  nominatingOrganisation: column.nullable().optional(),
  registrationStatus: column.nullable().optional(),
  externalRegistrationId: column.nullable().optional(),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const importPreviewRequestSchema = z.object({
  mapping: importMappingSchema,
  /** One explicit value for every row when the export has no attendance-format column (D4). */
  attendanceFormatDefault: z.enum(participationModes).optional(),
  /** Save this mapping for the run's registration source (E2-8). */
  saveMapping: z.boolean().optional(),
});
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;

/** Registration source name chosen explicitly by the admin at upload (D3 step 1). */
export const importSourceSchema = z.string().trim().min(1).max(100);

/** Row outcomes as stored in import_row (D6). */
export const importRowOutcomes = [
  'accepted',
  'updated',
  'unchanged',
  'linked',
  'duplicate_in_file',
  'rejected',
  'conflict',
] as const;
export type ImportRowOutcome = (typeof importRowOutcomes)[number];

/** Conflict reason codes (D6), plus the rejection reasons used for invalid rows. */
export const importConflictReasons = [
  'external_id_mismatch',
  'email_owned_by_other_identity',
  'name_mismatch',
  'inactive_account',
  'shared_email_in_file',
  'inconsistent_repeat',
  'previous_email_of_identity',
  'address_under_migration_review',
] as const;
export type ImportConflictReason = (typeof importConflictReasons)[number];

export const importRejectionReasons = [
  'email_missing',
  'email_invalid',
  'name_missing',
  'attendance_format_unknown',
  'capacity_unknown',
  'registration_status_unknown',
  'control_character',
  'value_too_long',
] as const;
export type ImportRejectionReason = (typeof importRejectionReasons)[number];

export const importRunStatuses = ['uploaded', 'previewed', 'committed', 'discarded'] as const;
export type ImportRunStatus = (typeof importRunStatuses)[number];

export const importCountsSchema = z.object({
  total: z.number().int(),
  accepted: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  linked: z.number().int(),
  duplicateInFile: z.number().int(),
  rejected: z.number().int(),
  conflict: z.number().int(),
  possibleDuplicate: z.number().int(),
});
export type ImportCounts = z.infer<typeof importCountsSchema>;
