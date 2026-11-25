import { z } from 'zod';

/**
 * The admin console's writing assistant (2026-11-25), backed by OpenAI.
 *
 * Two jobs, both admin-only:
 *  - Wording: the admin's own text from a configuration field (a question, an option, a section
 *    title, an email subject or body, a message) is returned reworded. The admin sees the
 *    suggestion next to the original and nothing changes until they accept it.
 *  - Summaries: a short written reading of an assessment's results. Decision 2026-11-25: no
 *    delegate data leaves the platform. A summary is written from the figures only (counts,
 *    averages, option percentages) and the admin-written question wording; never a name, an
 *    email, an organisation or anything a delegate typed.
 */

/** What to do with the text. */
export const aiWordingModes = ['improve', 'shorter', 'formal', 'friendlier'] as const;
export type AiWordingMode = (typeof aiWordingModes)[number];

/** Longest text the assistant takes in one request (a long email body fits). */
export const aiWordingMaxLength = 6000;

export const aiWordingRequestSchema = z.object({
  text: z.string().trim().min(2, 'Write something first.').max(aiWordingMaxLength),
  mode: z.enum(aiWordingModes).default('improve'),
  /** The field's label as the admin sees it ("Question", "Email subject"), for context. */
  field: z.string().trim().max(200).optional(),
  /** A one-line field (a title, a subject) rather than a paragraph. */
  singleLine: z.boolean().default(false),
});
export type AiWordingRequest = z.infer<typeof aiWordingRequestSchema>;

export const aiWordingResponseSchema = z.object({ suggestion: z.string() });

export const aiStatusSchema = z.object({ enabled: z.boolean() });
export type AiStatus = z.infer<typeof aiStatusSchema>;

/** A saved summary of an assessment's results. */
export const aiSummaryViewSchema = z.object({
  overview: z.string(),
  findings: z.array(z.string()),
  /** Submitted responses the figures covered when it was written. */
  basedOn: z.number().int(),
  generatedAt: z.string(),
  /** The batch it covers; null for every delegate. */
  batchId: z.uuid().nullable(),
});
export type AiSummaryView = z.infer<typeof aiSummaryViewSchema>;

/** Title shown above a summary wherever it appears, so it is never mistaken for staff writing. */
export const AI_SUMMARY_TITLE = 'Summary (written by AI from the figures)';
