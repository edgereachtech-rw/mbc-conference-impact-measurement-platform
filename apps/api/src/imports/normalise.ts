import type { ImportMapping, ImportRejectionReason } from '@mbc/shared';

import { normaliseEmail } from '../lib/email.js';

/**
 * Row normalisation and validation (backlog D3 step 3, D4, D5). Pure functions: the output is the
 * record the matcher works with, or the reasons the row is rejected. Nothing here touches the
 * database and no missing value is ever filled in beyond the two defined defaults
 * (registration status valid, capacity individual).
 */

export type AttendanceFormat = 'physical' | 'virtual';
export type Capacity = 'individual' | 'nominee' | 'other';
export type RegistrationStatus = 'valid' | 'cancelled';

export interface RowValues {
  email: string;
  /** Name as the file gives it, trimmed with whitespace collapsed; stored on the registration. */
  name: string;
  attendanceFormat: AttendanceFormat;
  organisation: string | null;
  jobTitle: string | null;
  country: string | null;
  capacity: Capacity;
  nominatingOrganisation: string | null;
  registrationStatus: RegistrationStatus;
  externalRegistrationId: string | null;
}

export interface RowRejection {
  reason: ImportRejectionReason;
  field: string;
}

export type NormalisedRow =
  { ok: true; values: RowValues } | { ok: false; rejections: RowRejection[] };

const LIMITS = {
  email: 254,
  name: 200,
  organisation: 200,
  jobTitle: 200,
  country: 100,
  nominatingOrganisation: 200,
  externalRegistrationId: 100,
} as const;

/**
 * Name comparison key (D5, decided): trim, collapse whitespace, NFC, case-insensitive. Case
 * folding is approximated with lower-casing after an upper-case round trip, which covers the
 * common cases (ß, dotted I) the platform is likely to meet; nothing else is normalised, so
 * accents, order and abbreviations differ by design.
 */
export function normaliseNameKey(name: string): string {
  return collapseWhitespace(name).normalize('NFC').toUpperCase().toLowerCase();
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Text key for comparing optional details (organisation etc.): collapsed, NFC, case-insensitive. */
export function detailKey(value: string | null): string {
  return value === null ? '' : normaliseNameKey(value);
}

/** C0 control characters other than tab, line feed and carriage return, plus DEL. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return true;
  }
  return false;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ATTENDANCE_SYNONYMS: Record<string, AttendanceFormat> = {
  physical: 'physical',
  inperson: 'physical',
  onsite: 'physical',
  onlocation: 'physical',
  facetoface: 'physical',
  venue: 'physical',
  lagos: 'physical',
  live: 'physical',
  virtual: 'virtual',
  online: 'virtual',
  remote: 'virtual',
  stream: 'virtual',
  livestream: 'virtual',
  zoom: 'virtual',
  digital: 'virtual',
};

const CAPACITY_SYNONYMS: Record<string, Capacity> = {
  individual: 'individual',
  self: 'individual',
  personal: 'individual',
  nominee: 'nominee',
  nomineeoforganisation: 'nominee',
  nomineeoforganization: 'nominee',
  nominated: 'nominee',
  organisation: 'nominee',
  organization: 'nominee',
  other: 'other',
};

const STATUS_SYNONYMS: Record<string, RegistrationStatus> = {
  valid: 'valid',
  registered: 'valid',
  confirmed: 'valid',
  active: 'valid',
  paid: 'valid',
  complete: 'valid',
  completed: 'valid',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  refunded: 'cancelled',
  withdrawn: 'cancelled',
};

function enumKey(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function parseAttendanceFormat(value: string): AttendanceFormat | undefined {
  return ATTENDANCE_SYNONYMS[enumKey(value)];
}

function cellOf(raw: Record<string, string>, column: string | null | undefined): string {
  if (!column) return '';
  return raw[column] ?? '';
}

/**
 * Normalises one raw row under a mapping. Every mapped cell is checked for control characters
 * and length; required fields for presence and format. A row with any problem is rejected with
 * every reason found, so the admin fixes them all at once (D3 step 3).
 */
export function normaliseRow(
  raw: Record<string, string>,
  mapping: ImportMapping,
  attendanceFormatDefault: AttendanceFormat | undefined,
): NormalisedRow {
  const rejections: RowRejection[] = [];
  const text = (field: string, column: string | null | undefined, limit: number): string | null => {
    const value = collapseWhitespace(cellOf(raw, column).normalize('NFC'));
    if (hasControlCharacter(value)) rejections.push({ reason: 'control_character', field });
    if (value.length > limit) rejections.push({ reason: 'value_too_long', field });
    return value === '' ? null : value;
  };

  const emailRaw = text('email', mapping.email, LIMITS.email);
  let email = '';
  if (!emailRaw) rejections.push({ reason: 'email_missing', field: 'email' });
  else {
    email = normaliseEmail(emailRaw);
    if (!EMAIL.test(email) || /\s/.test(email))
      rejections.push({ reason: 'email_invalid', field: 'email' });
  }

  let name: string | null;
  if (typeof mapping.name === 'string') name = text('name', mapping.name, LIMITS.name);
  else {
    const first = text('name.first', mapping.name.first, LIMITS.name) ?? '';
    const last = text('name.last', mapping.name.last, LIMITS.name) ?? '';
    const joined = collapseWhitespace(`${first} ${last}`);
    name = joined === '' ? null : joined;
    if (joined.length > LIMITS.name) rejections.push({ reason: 'value_too_long', field: 'name' });
  }
  if (!name) rejections.push({ reason: 'name_missing', field: 'name' });

  let attendanceFormat: AttendanceFormat | undefined;
  if (mapping.attendanceFormat) {
    const cell = text('attendanceFormat', mapping.attendanceFormat, 100);
    // A mapped column decides every row; the run-wide default applies only when no column is mapped.
    attendanceFormat = cell ? parseAttendanceFormat(cell) : undefined;
  } else {
    attendanceFormat = attendanceFormatDefault;
  }
  if (!attendanceFormat) {
    rejections.push({ reason: 'attendance_format_unknown', field: 'attendanceFormat' });
  }

  const organisation = text('organisation', mapping.organisation, LIMITS.organisation);
  const jobTitle = text('jobTitle', mapping.jobTitle, LIMITS.jobTitle);
  const country = text('country', mapping.country, LIMITS.country);
  const nominatingOrganisation = text(
    'nominatingOrganisation',
    mapping.nominatingOrganisation,
    LIMITS.nominatingOrganisation,
  );
  const externalRegistrationId = text(
    'externalRegistrationId',
    mapping.externalRegistrationId,
    LIMITS.externalRegistrationId,
  );

  let capacity: Capacity = 'individual';
  const capacityCell = text('capacity', mapping.capacity, 100);
  if (capacityCell) {
    const parsed = CAPACITY_SYNONYMS[enumKey(capacityCell)];
    if (!parsed) rejections.push({ reason: 'capacity_unknown', field: 'capacity' });
    else capacity = parsed;
  }

  let registrationStatus: RegistrationStatus = 'valid';
  const statusCell = text('registrationStatus', mapping.registrationStatus, 100);
  if (statusCell) {
    const parsed = STATUS_SYNONYMS[enumKey(statusCell)];
    // "duplicate" and "test" cannot be set by import (D4): they are unknown here on purpose.
    if (!parsed)
      rejections.push({ reason: 'registration_status_unknown', field: 'registrationStatus' });
    else registrationStatus = parsed;
  }

  if (rejections.length > 0) return { ok: false, rejections };
  return {
    ok: true,
    values: {
      email,
      name: name!,
      attendanceFormat: attendanceFormat!,
      organisation,
      jobTitle,
      country,
      capacity,
      nominatingOrganisation,
      registrationStatus,
      externalRegistrationId,
    },
  };
}

/** Mutable registration fields an import may update in place (D5, same event). */
export const UPDATABLE_FIELDS = [
  'name',
  'organisation',
  'jobTitle',
  'country',
  'attendanceFormat',
  'capacity',
  'nominatingOrganisation',
  'registrationStatus',
  'externalRegistrationId',
] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/** The fields compared when deciding whether two same-email rows are an identical repeat (D5). */
export function repeatKey(values: RowValues): string {
  return [
    normaliseNameKey(values.name),
    values.externalRegistrationId ?? '',
    values.attendanceFormat,
    detailKey(values.organisation),
    detailKey(values.jobTitle),
    detailKey(values.country),
    values.capacity,
    detailKey(values.nominatingOrganisation),
    values.registrationStatus,
  ].join('\u0000');
}

/** True when the rows differ in name or external id (shared_email_in_file), as opposed to details. */
export function identityPartDiffers(a: RowValues, b: RowValues): boolean {
  return (
    normaliseNameKey(a.name) !== normaliseNameKey(b.name) ||
    (a.externalRegistrationId ?? '') !== (b.externalRegistrationId ?? '')
  );
}
