import { z } from 'zod';

/**
 * Conflict resolution (backlog D5 "Valid actions", D9 audit contract). The four actions are the
 * ones the design note names; which of them a given row allows is decided on the server from the
 * conflict reason and the current ownership of the row's address.
 */
export const importResolutionActions = [
  'link_existing',
  'create_identity',
  'reject',
  'correct_source',
] as const;
export type ImportResolutionAction = (typeof importResolutionActions)[number];

const note = z.string().trim().max(500).optional();

export const importResolutionRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link_existing'),
    /** The identity the admin has established as the same person. */
    identityId: z.uuid(),
    /** The admin's recorded confirmation that the row is the same person (D5). */
    samePerson: z.boolean(),
    note,
  }),
  z.object({
    action: z.literal('create_identity'),
    /** The admin's recorded confirmation that the row is a different person (D5). */
    differentPerson: z.boolean(),
    note,
  }),
  z.object({ action: z.literal('reject'), note }),
  z.object({ action: z.literal('correct_source'), note }),
]);
export type ImportResolutionRequest = z.infer<typeof importResolutionRequestSchema>;

/** Reason categories of an audited refusal (`import.resolution_refused`); never a record of another identity. */
export const importRefusalReasons = [
  'row_not_resolvable',
  'already_resolved',
  'action_not_valid_for_conflict',
  'confirmation_missing',
  'address_reserved',
  'under_migration_review',
  'identity_not_found',
  'account_inactive',
  'registration_exists',
  'other_rows_unresolved',
  'event_archived',
] as const;
export type ImportRefusalReason = (typeof importRefusalReasons)[number];
