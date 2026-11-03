import { z } from 'zod';

/**
 * Emailing the session feedback form (task of 2026-11-03).
 *
 * The form has always had a link and a QR code; a delegate who missed the code on the screen had
 * to find the session themselves. An admin can now send the link, which is the difference between
 * feedback given in the room and feedback never given at all.
 *
 * Only delegates **recorded as attending the session** are ever written to: the form refuses a
 * submission without an attendance record (`not_attended`), so sending it to anyone else would be
 * an invitation to a door that will not open.
 */

export const feedbackInvitationScopes = [
  /** Attended, and has never been sent the link. The default. */
  'not_sent',
  /** Attended and has not submitted yet, whether or not they were sent it before: the chaser. */
  'not_submitted',
  /** Everyone who attended, again. */
  'all',
] as const;
export type FeedbackInvitationScope = (typeof feedbackInvitationScopes)[number];

export const feedbackInvitationSendSchema = z.object({
  scope: z.enum(feedbackInvitationScopes).default('not_sent'),
});
export type FeedbackInvitationSend = z.infer<typeof feedbackInvitationSendSchema>;

export const feedbackInvitationStateSchema = z.object({
  /** Whether the form can be emailed at all, and why not when it cannot. */
  sendable: z.boolean(),
  reason: z.string().nullable(),
  /** Delegates recorded as attending this session: the only people who can submit. */
  attended: z.number().int(),
  /** Of those, how many have been sent the link, and how many have answered. */
  invited: z.number().int(),
  submitted: z.number().int(),
  /** Attended, not yet sent the link. */
  notSent: z.number().int(),
  /** Attended, not yet submitted: who a chaser would reach. */
  notSubmitted: z.number().int(),
  lastSentAt: z.string().nullable(),
});
export type FeedbackInvitationState = z.infer<typeof feedbackInvitationStateSchema>;

export const feedbackInvitationResultSchema = feedbackInvitationStateSchema.extend({
  justSent: z.number().int(),
  justFailed: z.number().int(),
});
export type FeedbackInvitationResult = z.infer<typeof feedbackInvitationResultSchema>;
