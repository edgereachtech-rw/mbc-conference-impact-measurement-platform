import { z } from 'zod';

import { participationModes } from './auth.js';
import { delegateListStatuses } from './delegates.js';

/**
 * Admin messages to delegates (backlog E2-14): an admin selects registrations of one event, writes a
 * subject and a body in the message markdown subset (see message-body.ts), and the platform sends
 * one branded email per recipient, recording the outcome per recipient.
 */

/** Hard cap per message; larger audiences are sent in batches by the admin. */
export const delegateMessageMaxRecipients = 2_000;

export const delegateMessageFilterSchema = z.object({
  status: z.enum(delegateListStatuses).optional(),
  attendanceFormat: z.enum(participationModes).optional(),
  /** Case-insensitive match on name, email, organisation or external registration id. */
  q: z.string().trim().max(200).optional(),
});
export type DelegateMessageFilter = z.infer<typeof delegateMessageFilterSchema>;

/** Either the ticked registrations or every registration matching the listing filter. */
export const delegateMessageRecipientsSchema = z.union([
  z.object({ delegateIds: z.array(z.uuid()).min(1).max(delegateMessageMaxRecipients) }),
  z.object({ filter: delegateMessageFilterSchema }),
]);
export type DelegateMessageRecipients = z.infer<typeof delegateMessageRecipientsSchema>;

export const delegateMessageSendSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  body: z.string().min(1).max(20_000),
  recipients: delegateMessageRecipientsSchema,
});
export type DelegateMessageSend = z.infer<typeof delegateMessageSendSchema>;

export const delegateMessageSendResultSchema = z.object({
  messageId: z.uuid(),
  /** Distinct recipients the message was addressed to. */
  total: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  /** Selected registrations left out because another selected one has the same email. */
  skipped: z.number().int(),
});
export type DelegateMessageSendResult = z.infer<typeof delegateMessageSendResultSchema>;

export const delegateMessageStatuses = ['sending', 'sent', 'partially_failed', 'failed'] as const;
export type DelegateMessageStatus = (typeof delegateMessageStatuses)[number];

export const delegateMessageRecipientStatuses = ['queued', 'sent', 'failed'] as const;
export type DelegateMessageRecipientStatus = (typeof delegateMessageRecipientStatuses)[number];

export const delegateMessageSummarySchema = z.object({
  id: z.uuid(),
  subject: z.string(),
  status: z.enum(delegateMessageStatuses),
  recipientCount: z.number().int(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  /** Staff address of the admin who sent it; null when the account no longer exists. */
  sentBy: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type DelegateMessageSummary = z.infer<typeof delegateMessageSummarySchema>;

export const delegateMessageRecipientSchema = z.object({
  delegateId: z.uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(delegateMessageRecipientStatuses),
  sentAt: z.string().nullable(),
});
export type DelegateMessageRecipient = z.infer<typeof delegateMessageRecipientSchema>;

export const delegateMessageDetailSchema = delegateMessageSummarySchema.extend({
  body: z.string(),
  recipients: z.array(delegateMessageRecipientSchema),
});
export type DelegateMessageDetail = z.infer<typeof delegateMessageDetailSchema>;
