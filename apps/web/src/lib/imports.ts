import type {
  ImportConflictReason,
  ImportValueMappedField,
  ImportValueMappings,
  ImportCounts,
  ImportField,
  ImportMapping,
  ImportRejectionReason,
  ImportRowOutcome,
  ImportRunStatus,
} from '@mbc/shared';
import { importFields, importRequiredFields } from '@mbc/shared';

import { ApiError } from './api';

/**
 * Response shapes of the registration-import API (apps/api/src/routes/imports.ts and
 * routes/events.ts), plus display labels. Nothing here invents a field the API does not return.
 */

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
  format: 'physical' | 'virtual' | 'hybrid';
  status: 'draft' | 'active' | 'archived';
}

export interface ImportFeatureStatus {
  uploadsEnabled: boolean;
  productionGateRequired: boolean;
  migrationGatePassed: boolean;
  blockers: string[];
}

export interface ImportRunSummary {
  id: string;
  eventId: string;
  actorUserId: string;
  source: string;
  fileName: string;
  fileSizeBytes: number;
  rowCount: number;
  status: ImportRunStatus;
  counts: ImportCounts | null;
  previewExpiresAt: string | null;
  committedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadResult {
  run: ImportRunSummary;
  headers: string[];
  delimiter: ',' | ';' | null;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | null;
  /** Things the admin should know before mapping, e.g. a non-UTF-8 file. */
  warnings: string[];
  suggestedMapping: Partial<ImportMapping>;
  unmappedColumns: string[];
  attendanceRecordColumns: string[];
  savedMapping: { mapping: ImportMapping; reusable: boolean } | null;
}

export interface RowValues {
  email: string;
  name: string;
  attendanceFormat: 'physical' | 'virtual';
  organisation: string | null;
  jobTitle: string | null;
  country: string | null;
  capacity: string;
  nominatingOrganisation: string | null;
  registrationStatus: string;
  externalRegistrationId: string | null;
}

export interface PreviewRow {
  rowNumber: number;
  outcome: ImportRowOutcome;
  reasonCode: string | null;
  reasonDetail: string | null;
  possibleDuplicate: boolean;
  values: RowValues | null;
  conflict: {
    row: Partial<RowValues>;
    existing: Record<string, unknown>;
  } | null;
  delegateId: string | null;
  identityId: string | null;
  changes?: Array<{ field: string; from: string | null; to: string | null }>;
}

export interface PreviewResult {
  run: ImportRunSummary;
  counts: ImportCounts;
  ignoredColumns: string[];
  /** File values of the enumerated fields that rejected rows; the admin can translate them. */
  unrecognisedValues: Record<ImportValueMappedField, Array<{ value: string; count: number }>>;
  previewExpiresAt: string;
  rows: PreviewRow[];
}

export type { ImportValueMappedField, ImportValueMappings };

export interface ConfirmResult {
  run: ImportRunSummary;
  counts: ImportCounts;
  alreadyCommitted: boolean;
}

export interface StoredRow {
  id: string;
  rowNumber: number;
  values: RowValues | null;
  outcome: ImportRowOutcome | null;
  reasonCode: string | null;
  reasonDetail: string | null;
  possibleDuplicate: boolean;
  conflict: PreviewRow['conflict'];
  delegateId: string | null;
  identityId: string | null;
  resolution?: ResolutionAction | null;
  resolvedAt?: string | null;
}

export interface RunDetail {
  run: ImportRunSummary;
  rows: StoredRow[];
}

/** Confirm refusals that require a fresh preview (D3 step 5). */
export const STALE_PREVIEW_CODES = ['preview_out_of_date', 'preview_expired'] as const;

export function isStalePreviewError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && (STALE_PREVIEW_CODES as readonly string[]).includes(error.code)
  );
}

export function isPreviewExpired(previewExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!previewExpiresAt) return true;
  const at = Date.parse(previewExpiresAt);
  return Number.isNaN(at) || at <= now.getTime();
}

export const outcomeLabels: Record<ImportRowOutcome, string> = {
  accepted: 'New registration',
  updated: 'Update',
  unchanged: 'No change',
  linked: 'Links existing person',
  duplicate_in_file: 'Duplicate in file',
  rejected: 'Rejected',
  conflict: 'Conflict (quarantined)',
};

export const conflictReasonLabels: Record<ImportConflictReason, string> = {
  external_id_mismatch: 'Registration id already belongs to a different email or registration',
  email_owned_by_other_identity:
    'Email belongs to a different person than the existing registration',
  name_mismatch: 'Name differs from the person who holds this email',
  inactive_account: 'The person’s account is inactive',
  shared_email_in_file: 'Several rows share this email with different names or ids',
  inconsistent_repeat: 'Several rows share this email with different details',
  previous_email_of_identity:
    'This is a previous email of an existing person; no registration linkage',
  address_under_migration_review: 'This email is reserved pending a migration decision',
};

export const rejectionReasonLabels: Record<ImportRejectionReason, string> = {
  email_missing: 'Email is missing',
  email_invalid: 'Email is not a valid address',
  name_missing: 'Name is missing',
  attendance_format_unknown: 'Attendance format is missing or not recognised',
  capacity_unknown: 'Capacity value not recognised',
  registration_status_unknown:
    'Registration status not recognised (duplicate and test cannot be imported)',
  control_character: 'A value contains control characters',
  value_too_long: 'A value is too long',
};

export function reasonLabel(
  row: Pick<PreviewRow, 'outcome' | 'reasonCode' | 'reasonDetail'>,
): string {
  const code = row.reasonCode;
  if (!code) return row.reasonDetail ?? '';
  const known =
    (conflictReasonLabels as Record<string, string>)[code] ??
    (rejectionReasonLabels as Record<string, string>)[code];
  if (known) return known;
  if (code === 'duplicate_in_file')
    return row.reasonDetail ? `Identical repeat (${row.reasonDetail})` : 'Identical repeat';
  return row.reasonDetail ?? code;
}

export const fieldLabels: Record<ImportField, string> = {
  email: 'Email',
  name: 'Full name',
  attendanceFormat: 'Attendance format (physical / virtual)',
  organisation: 'Organisation',
  jobTitle: 'Job title',
  country: 'Country',
  capacity: 'Capacity (individual / nominee / other)',
  nominatingOrganisation: 'Nominating organisation',
  registrationStatus: 'Registration status (active / pending / cancelled)',
  externalRegistrationId: 'Registration id from the source',
};

export const runStatusLabels: Record<ImportRunStatus, string> = {
  uploaded: 'Uploaded, not previewed',
  previewed: 'Previewed, not confirmed',
  committed: 'Committed',
  discarded: 'Discarded',
};

/** Editable mapping state behind the mapping form; converted to the API shape on submit. */
export interface MappingDraft {
  columns: Partial<Record<Exclude<ImportField, 'name'>, string>>;
  nameMode: 'single' | 'split';
  name: string;
  firstName: string;
  lastName: string;
}

export function draftFromMapping(mapping: Partial<ImportMapping> | null | undefined): MappingDraft {
  const draft: MappingDraft = {
    columns: {},
    nameMode: 'single',
    name: '',
    firstName: '',
    lastName: '',
  };
  if (!mapping) return draft;
  for (const field of importFields) {
    if (field === 'name') continue;
    const value = mapping[field];
    if (typeof value === 'string' && value) draft.columns[field] = value;
  }
  if (typeof mapping.name === 'string') draft.name = mapping.name;
  else if (mapping.name) {
    draft.nameMode = 'split';
    draft.firstName = mapping.name.first;
    draft.lastName = mapping.name.last;
  }
  return draft;
}

/** The API mapping, or the first problem a user must fix before a preview can be requested. */
export function mappingFromDraft(
  draft: MappingDraft,
  attendanceFormatDefault: '' | 'physical' | 'virtual',
): { mapping: ImportMapping } | { problem: string } {
  if (!draft.columns.email) return { problem: 'Choose the column that holds the email address.' };
  let name: ImportMapping['name'];
  if (draft.nameMode === 'single') {
    if (!draft.name) return { problem: 'Choose the column that holds the full name.' };
    name = draft.name;
  } else {
    if (!draft.firstName || !draft.lastName) {
      return { problem: 'Choose both the first-name and the last-name columns.' };
    }
    name = { first: draft.firstName, last: draft.lastName };
  }
  if (!draft.columns.attendanceFormat && !attendanceFormatDefault) {
    return {
      problem:
        'Map the attendance-format column, or choose one attendance format for every row in this file.',
    };
  }
  const mapping: ImportMapping = { email: draft.columns.email, name };
  for (const field of importFields) {
    if (field === 'email' || field === 'name') continue;
    const column = draft.columns[field];
    if (column) mapping[field] = column;
  }
  return { mapping };
}

export const requiredFields: readonly ImportField[] = importRequiredFields;

/** User-facing text for an API or network failure; never a stack trace or an internal message. */
export function describeError(
  error: unknown,
  fallback = 'Something went wrong. Check your connection and try again.',
): { message: string; requestId?: string } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        message: 'Your session has ended. Sign in again to continue.',
        requestId: error.requestId,
      };
    }
    if (error.status === 403) {
      return {
        message: 'Only M.Bryan admins can run registration imports.',
        requestId: error.requestId,
      };
    }
    if (error.status >= 500) {
      return {
        message:
          'The server could not complete this. Nothing was changed; try again or quote the request id when asking for help.',
        requestId: error.requestId,
      };
    }
    return { message: error.message, requestId: error.requestId };
  }
  return { message: fallback };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------------------------
// Conflict resolution (D5 valid actions; the server decides, these are hints for the form)

export type ResolutionAction = 'link_existing' | 'create_identity' | 'reject' | 'correct_source';

export const resolutionActionLabels: Record<ResolutionAction, string> = {
  link_existing: 'Link to the existing person',
  create_identity: 'Create a new person',
  reject: 'Reject the row',
  correct_source: 'Correct the source and re-import',
};

export const resolutionActionHelp: Record<ResolutionAction, string> = {
  link_existing:
    'Attaches this registration to the existing person. Their name and email stay as they are; the row’s email is reserved to them if nobody owns it.',
  create_identity:
    'Creates a new person with this email and a registration. Only possible when no one holds the email.',
  reject: 'Nothing is created or changed; the row stays in the run’s history as rejected.',
  correct_source:
    'Same as reject, recorded as “fix the data in the registration source and re-import” (or change the person’s email through the admin workflow).',
};

export const resolutionLabels: Record<ResolutionAction, string> = {
  link_existing: 'Resolved: linked',
  create_identity: 'Resolved: new person',
  reject: 'Resolved: rejected',
  correct_source: 'Resolved: correct the source',
};

/** Actions the form offers for a conflict row; the server validates again against D5. */
export function permittedActions(
  row: Pick<StoredRow, 'reasonCode' | 'conflict'>,
): ResolutionAction[] {
  const reason = row.reasonCode ?? '';
  const existingIdentity = typeof row.conflict?.existing.identityId === 'string';
  const actions: ResolutionAction[] = [];
  const linkable = [
    'name_mismatch',
    'previous_email_of_identity',
    'inactive_account',
    'shared_email_in_file',
    'inconsistent_repeat',
  ];
  if (linkable.includes(reason) && existingIdentity) actions.push('link_existing');
  const creatable = ['external_id_mismatch', 'shared_email_in_file', 'inconsistent_repeat'];
  if (creatable.includes(reason)) actions.push('create_identity');
  actions.push('reject', 'correct_source');
  return actions;
}

export interface ResolutionResult {
  row: {
    id: string;
    runId: string;
    rowNumber: number;
    resolution: ResolutionAction;
    resolvedAt: string | null;
    identityId: string | null;
    delegateId: string | null;
  };
  alreadyResolved: boolean;
}
