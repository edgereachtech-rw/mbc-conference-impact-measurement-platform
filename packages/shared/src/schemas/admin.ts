import { z } from 'zod';

/**
 * Admin actions on delegate accounts and invitations (backlog E2-13, E3-1).
 */

/** E2-13: set a delegate account active or inactive with a recorded reason category. */
export const delegateAccountStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
  /** Reason category as the admin records it; the categories themselves are not prescribed. */
  reason: z.string().trim().min(1).max(100),
});
export type DelegateAccountStatus = z.infer<typeof delegateAccountStatusSchema>;

/** E3-1: send invitations to an event's registered delegates; no ids means every eligible one. */
export const invitationSendSchema = z.object({
  delegateIds: z.array(z.uuid()).max(5_000).optional(),
});
export type InvitationSend = z.infer<typeof invitationSendSchema>;

export const invitationLookupSchema = z.object({
  email: z.string(),
  eventName: z.string(),
});
export type InvitationLookup = z.infer<typeof invitationLookupSchema>;
