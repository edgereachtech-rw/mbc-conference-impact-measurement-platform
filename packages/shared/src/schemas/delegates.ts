import { z } from 'zod';

import { emailSchema, participationModes } from './auth.js';

/**
 * Admin delegate listing (E2-6 subset for Increment 1b: list and filter by registration status;
 * the per-stage filters arrive with the stages themselves).
 */

export const delegateListStatuses = [
  'active',
  'pending',
  'cancelled',
  'duplicate',
  'test',
] as const;
export type DelegateListStatus = (typeof delegateListStatuses)[number];

export const delegateListSorts = [
  'name',
  'createdAt',
  'organisation',
  'registrationStatus',
] as const;

export const delegateListQuerySchema = z.object({
  /** Case-insensitive match on name, email, organisation or external registration id. */
  q: z.string().trim().max(200).optional(),
  status: z.enum(delegateListStatuses).optional(),
  attendanceFormat: z.enum(participationModes).optional(),
  sort: z.enum(delegateListSorts).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(10),
});
export type DelegateListQuery = z.infer<typeof delegateListQuerySchema>;

export const delegateListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
  jobTitle: z.string().nullable(),
  country: z.string().nullable(),
  attendanceFormat: z.enum(participationModes),
  capacity: z.enum(['individual', 'nominee', 'other']),
  registrationStatus: z.enum(delegateListStatuses),
  registrationSource: z.string().nullable(),
  externalRegistrationId: z.string().nullable(),
  identityId: z.uuid().nullable(),
  signedUpAt: z.string().nullable(),
  importedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DelegateListItem = z.infer<typeof delegateListItemSchema>;

export const delegateListResponseSchema = z.object({
  delegates: z.array(delegateListItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  /** Registrations per status for the whole event, independent of the filter. */
  counts: z.record(z.enum(delegateListStatuses), z.number().int()),
});
export type DelegateListResponse = z.infer<typeof delegateListResponseSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/**
 * A delegate added by hand by an admin (decision 2026-11-12): a registration that came by no
 * file, with the fields an import takes minus the registration id. The server finds or creates
 * the person's identity by address exactly as an import would, and emails nobody.
 */
export const delegateCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter the delegate’s name.').max(200),
  email: emailSchema,
  organisation: optionalText(200),
  nominatingOrganisation: optionalText(200),
  jobTitle: optionalText(200),
  country: optionalText(100),
  attendanceFormat: z.enum(participationModes),
  capacity: z.enum(['individual', 'nominee', 'other']).default('individual'),
  /** Active or pending; duplicate and test are never set by hand. */
  registrationStatus: z.enum(['active', 'pending']).default('active'),
});
export type DelegateCreate = z.infer<typeof delegateCreateSchema>;
export type DelegateCreateInput = z.input<typeof delegateCreateSchema>;

export const delegateCreateResultSchema = z.object({
  delegate: delegateListItemSchema,
  /** Whether the address was new to the platform or already belonged to a known person. */
  identity: z.enum(['created', 'linked']),
});
export type DelegateCreateResult = z.infer<typeof delegateCreateResultSchema>;

/** One delegate record as the staff route `GET /delegates/:id` returns it, for the edit form. */
export const delegateRecordSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
  nominatingOrganisation: z.string().nullable(),
  jobTitle: z.string().nullable(),
  country: z.string().nullable(),
  attendanceFormat: z.enum(participationModes),
  capacity: z.enum(['individual', 'nominee', 'other']),
  registrationStatus: z.enum(delegateListStatuses),
  signedUpAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DelegateRecord = z.infer<typeof delegateRecordSchema>;

/**
 * Marking registrations as test delegates, or back to real ones (decision of 2026-11-05). A test
 * delegate is imported like anyone else and then marked by an admin, so staff can use the platform
 * from the delegate's side. Only active and test registrations switch; the rest are skipped and
 * reported, never changed.
 */
export const delegateTestMarkSchema = z.object({
  delegateIds: z.array(z.uuid()).min(1).max(500),
  test: z.boolean(),
});
export type DelegateTestMark = z.infer<typeof delegateTestMarkSchema>;

export const delegateTestMarkResultSchema = z.object({
  /** Registrations whose status changed. */
  updated: z.number().int(),
  /** Registrations left alone: already in the requested state, or pending, cancelled or duplicate. */
  skipped: z.number().int(),
});
export type DelegateTestMarkResult = z.infer<typeof delegateTestMarkResultSchema>;
