import {
  importFields,
  importRequiredFields,
  type ImportField,
  type ImportMapping,
} from '@mbc/shared';

import { HttpError } from '../lib/errors.js';

/**
 * Column mapping (backlog E2-8, D4). The suggested mapping is generic: header synonyms specific
 * to the real registration platforms are finalised only after sample exports arrive (OQ-20).
 */

/** Header normalisation for matching: trim, case fold, drop punctuation and whitespace. */
export function headerKey(header: string): string {
  return header
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Exact header structure of a file, used to decide whether a saved mapping may be reused. */
export function headerSignature(headers: readonly string[]): string {
  return headers.map((h) => h.normalize('NFC').trim().toLowerCase()).join('\u001f');
}

const SYNONYMS: Record<ImportField | 'firstName' | 'lastName', readonly string[]> = {
  email: ['email', 'emailaddress', 'email address', 'e-mail', 'mail', 'emailid'],
  name: ['name', 'fullname', 'full name', 'delegatename', 'attendeename', 'participantname'],
  firstName: ['firstname', 'first name', 'givenname', 'forename'],
  lastName: ['lastname', 'last name', 'surname', 'familyname'],
  attendanceFormat: [
    'attendanceformat',
    'attendancetype',
    'attendancemode',
    'participationformat',
    'participationmode',
    'participationtype',
    'format',
    'mode',
    'ticket',
    'tickettype',
    'eventformat',
  ],
  organisation: ['organisation', 'organization', 'company', 'employer', 'institution', 'org'],
  jobTitle: ['jobtitle', 'title', 'position', 'role', 'designation'],
  country: ['country', 'nation', 'countryofresidence'],
  capacity: ['capacity', 'delegatecapacity', 'attendingas'],
  nominatingOrganisation: [
    'nominatingorganisation',
    'nominatingorganization',
    'nominatedby',
    'sponsor',
  ],
  registrationStatus: ['registrationstatus', 'status', 'ticketstatus'],
  externalRegistrationId: [
    'registrationid',
    'registrationnumber',
    'ticketid',
    'ticketnumber',
    'orderid',
    'attendeeid',
    'id',
    'reference',
    'bookingreference',
  ],
};

/**
 * Columns that record attendance, check-in or presence are never mapped (decision 2026-10-29):
 * registration imports carry registration data only. A header that names the attendance
 * *format* (physical / virtual) is a registration field and is not caught by this.
 */
export function isAttendanceRecordColumn(header: string): boolean {
  const key = headerKey(header);
  if (/format|type|mode/.test(key)) return false;
  return /checkedin|checkin|attended|attendance|present|presence|showedup|noshow/.test(key);
}

export interface SuggestedMapping {
  mapping: Partial<ImportMapping>;
  /** Headers that no field claimed (reported as ignored in the preview). */
  unmapped: string[];
}

export function suggestMapping(headers: readonly string[]): SuggestedMapping {
  const claimed = new Set<string>();
  const find = (candidates: readonly string[]): string | undefined => {
    for (const candidate of candidates) {
      const target = headerKey(candidate);
      const hit = headers.find(
        (h) => !claimed.has(h) && !isAttendanceRecordColumn(h) && headerKey(h) === target,
      );
      if (hit) {
        claimed.add(hit);
        return hit;
      }
    }
    return undefined;
  };
  const mapping: Partial<ImportMapping> = {};
  const email = find(SYNONYMS.email);
  if (email) mapping.email = email;
  const fullName = find(SYNONYMS.name);
  if (fullName) mapping.name = fullName;
  else {
    const first = find(SYNONYMS.firstName);
    const last = find(SYNONYMS.lastName);
    if (first && last) mapping.name = { first, last };
  }
  for (const field of importFields) {
    if (field === 'email' || field === 'name') continue;
    const hit = find(SYNONYMS[field]);
    if (hit) mapping[field] = hit;
  }
  return { mapping, unmapped: headers.filter((h) => !claimed.has(h)) };
}

/** Every column a mapping refers to, in field order (name may contribute two). */
export function mappedColumns(mapping: ImportMapping): Array<{ field: string; column: string }> {
  const out: Array<{ field: string; column: string }> = [];
  for (const field of importFields) {
    const value = mapping[field];
    if (!value) continue;
    if (typeof value === 'string') out.push({ field, column: value });
    else {
      out.push({ field: 'name.first', column: value.first });
      out.push({ field: 'name.last', column: value.last });
    }
  }
  return out;
}

/**
 * The mapping must name existing columns, never an attendance-record column, never one column
 * for two fields, and must cover the required fields (attendance format may come from a run-wide
 * default). Violations block the preview (criterion 2).
 */
export function validateMapping(
  mapping: ImportMapping,
  headers: readonly string[],
  attendanceFormatDefault: string | undefined,
): { ignoredColumns: string[] } {
  const headerSet = new Set(headers);
  const used = new Map<string, string>();
  for (const { field, column } of mappedColumns(mapping)) {
    if (!headerSet.has(column)) {
      throw new HttpError(422, 'mapping_unknown_column', `${field}: no column named "${column}".`);
    }
    if (isAttendanceRecordColumn(column)) {
      throw new HttpError(
        422,
        'mapping_attendance_column',
        `${field}: "${column}" records attendance; attendance is never imported.`,
      );
    }
    const other = used.get(column);
    if (other) {
      throw new HttpError(
        422,
        'mapping_column_reused',
        `"${column}" is mapped to both ${other} and ${field}.`,
      );
    }
    used.set(column, field);
  }
  for (const field of importRequiredFields) {
    if (field === 'attendanceFormat' && attendanceFormatDefault) continue;
    if (!mapping[field]) {
      throw new HttpError(
        422,
        'mapping_required_field',
        `Required field ${field} is not mapped${field === 'attendanceFormat' ? ' and no run-wide value was chosen' : ''}.`,
      );
    }
  }
  return { ignoredColumns: headers.filter((h) => !used.has(h)) };
}
