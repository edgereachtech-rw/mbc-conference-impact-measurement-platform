import { z } from 'zod';

/**
 * The organisers' own wording for the emails the platform sends per event (decision
 * 2026-11-19). Each kind of email keeps its structure (greeting, the facts it carries, the
 * button) and lets the organisers replace the subject, the title, the introduction, the closing
 * notes and the button label. Blank keeps the platform's wording. Placeholders such as
 * {{firstName}} are filled per recipient; each kind lists the ones it understands.
 */

export const emailKinds = [
  'onboarding',
  'invitation',
  'follow_up_invitation',
  'follow_up_reminder',
  'transfer_plan_reminder',
  'session_feedback',
  'impact_check',
  'impact_check_sustaining',
] as const;
export type EmailKind = (typeof emailKinds)[number];

/** Placeholders every kind understands. */
export const commonEmailPlaceholders = ['firstName', 'name', 'eventName'] as const;

export interface EmailKindInfo {
  label: string;
  /** When the platform sends it, in one sentence. */
  description: string;
  /** The placeholders this kind understands, the common ones first. */
  placeholders: readonly string[];
}

export const emailKindInfo: Record<EmailKind, EmailKindInfo> = {
  onboarding: {
    label: 'Welcome pack',
    description:
      'Sent from the Delegates tab: what the platform is for, what happens when, and the check-in codes.',
    placeholders: [...commonEmailPlaceholders, 'eventDates', 'venue'],
  },
  invitation: {
    label: 'Account invitation',
    description: 'The sign-in invitation with its personal, single-use link.',
    placeholders: [...commonEmailPlaceholders, 'eventDates'],
  },
  follow_up_invitation: {
    label: 'Follow-up invitation',
    description: 'Sent once when a post-event follow-up opens for the delegate.',
    placeholders: [...commonEmailPlaceholders, 'waveLabel', 'deadline'],
  },
  follow_up_reminder: {
    label: 'Follow-up reminder',
    description: 'The chaser to a delegate who has not submitted an open follow-up.',
    placeholders: [...commonEmailPlaceholders, 'waveLabel', 'deadline'],
  },
  transfer_plan_reminder: {
    label: 'Transfer plan reminder',
    description: 'The reminder a delegate asked for about one action of their plan.',
    placeholders: [...commonEmailPlaceholders, 'actionName', 'firstStep', 'targetDate'],
  },
  session_feedback: {
    label: 'Session feedback request',
    description: 'Sent to delegates recorded at a session, with the link to its feedback form.',
    placeholders: [...commonEmailPlaceholders, 'sessionTitle', 'speaker', 'when'],
  },
  impact_check: {
    label: 'Impact check',
    description: 'After a completed plan with no measurable improvement yet: has one appeared?',
    placeholders: [...commonEmailPlaceholders, 'planTitle', 'outcome'],
  },
  impact_check_sustaining: {
    label: 'Impact check (improvement reported)',
    description: 'After a completed plan that showed an improvement: has it continued?',
    placeholders: [...commonEmailPlaceholders, 'planTitle', 'outcome'],
  },
};

/** The placeholders of a kind, with the human label of each. */
export const emailPlaceholderLabels: Record<string, string> = {
  firstName: 'First name',
  name: 'Full name',
  eventName: 'Event name',
  eventDates: 'Event dates',
  venue: 'Venue',
  waveLabel: 'Follow-up name (e.g. 30-day follow-up)',
  deadline: 'Deadline, in words',
  actionName: 'Planned action',
  firstStep: 'First step of the action',
  targetDate: 'Target date of the action',
  sessionTitle: 'Session title',
  speaker: 'Speaker',
  when: 'Session date and time',
  planTitle: 'Plan title',
  outcome: 'Plan outcome so far',
};

/** Trimmed text that is null when blank or absent. */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const emailCustomisationSchema = z.object({
  subject: optional(200),
  title: optional(200),
  /** Paragraphs separated by blank lines; replaces the introduction after the greeting. */
  intro: optional(4_000),
  /** One note per line; replaces the small print under the button. */
  closing: optional(2_000),
  buttonLabel: optional(80),
});
export type EmailCustomisation = z.infer<typeof emailCustomisationSchema>;
export type EmailCustomisationInput = z.input<typeof emailCustomisationSchema>;
export const EMPTY_EMAIL_CUSTOMISATION: EmailCustomisation = {
  subject: null,
  title: null,
  intro: null,
  closing: null,
  buttonLabel: null,
};

/** The platform's wording of one kind, as text the organisers can start from. */
export const emailPartsSchema = z.object({
  subject: z.string(),
  title: z.string(),
  intro: z.string(),
  closing: z.string(),
  buttonLabel: z.string(),
});
export type EmailParts = z.infer<typeof emailPartsSchema>;

export const emailPreviewSchema = z.object({ subject: z.string(), html: z.string() });
export type EmailPreview = z.infer<typeof emailPreviewSchema>;

export const eventEmailViewSchema = z.object({
  kind: z.enum(emailKinds),
  label: z.string(),
  description: z.string(),
  placeholders: z.array(z.string()),
  defaults: emailPartsSchema,
  /** The organisers' wording; null when the platform's stands. */
  custom: emailCustomisationSchema.nullable(),
  /** Rendered with sample values and the stored wording. */
  preview: emailPreviewSchema,
});
export type EventEmailView = z.infer<typeof eventEmailViewSchema>;

export const eventEmailsResponseSchema = z.object({ emails: z.array(eventEmailViewSchema) });
export type EventEmailsResponse = z.infer<typeof eventEmailsResponseSchema>;

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Fills the placeholders a text uses; unknown ones are left as typed so they stay visible. */
export function fillEmailPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole: string, key: string) =>
    key in values ? (values[key] ?? '') : whole,
  );
}

/** Placeholder names in the text that the kind does not understand, each once. */
export function unknownEmailPlaceholders(text: string, allowed: readonly string[]): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const key = match[1] ?? '';
    if (!allowed.includes(key)) unknown.add(key);
  }
  return [...unknown];
}

/** Paragraphs from text: blank lines separate them; single line breaks are kept. */
export function emailParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Notes from text: one per non-blank line. */
export function emailLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
