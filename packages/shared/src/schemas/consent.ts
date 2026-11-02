import { z } from 'zod';

/**
 * The privacy notice and a delegate's acceptance of it (backlog E3-7, brief section 6.4).
 *
 * The wording lives in the database (`consent_notice`), versioned: it names the organiser and the
 * event, and M.Bryan revises it without a deploy. A delegate is shown the current notice at first
 * sign-in and cannot reach their records until they accept it; the acceptance records which
 * version they were shown, so agreement to older wording is never counted as agreement to newer.
 */

export const consentDocuments = ['privacy'] as const;
export type ConsentDocumentKind = (typeof consentDocuments)[number];

export const consentNoticeSchema = z.object({
  document: z.enum(consentDocuments),
  version: z.string().min(1).max(40),
  title: z.string(),
  headline: z.string(),
  /** Paragraphs in order, already split; rendered as text, never as HTML. */
  paragraphs: z.array(z.string()),
  effectiveFrom: z.string(),
});
export type ConsentNotice = z.infer<typeof consentNoticeSchema>;

export const consentStateSchema = z.object({
  notice: consentNoticeSchema.nullable(),
  /** True when this delegate must accept the current notice before using the platform. */
  outstanding: z.boolean(),
  /** When they accepted the version they are on, and which version that was. */
  acceptedAt: z.string().nullable(),
  acceptedVersion: z.string().nullable(),
});
export type ConsentState = z.infer<typeof consentStateSchema>;

/** Accepting names the version on screen, so a notice revised mid-session is not accepted blind. */
export const consentAcceptSchema = z.object({
  document: z.enum(consentDocuments).default('privacy'),
  version: z.string().min(1).max(40),
});
export type ConsentAccept = z.infer<typeof consentAcceptSchema>;

/** Splits a stored notice body into paragraphs, dropping blank lines. */
export const noticeParagraphs = (body: string): string[] =>
  body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
