import { z } from 'zod';

import { participationModes } from './auth.js';

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
