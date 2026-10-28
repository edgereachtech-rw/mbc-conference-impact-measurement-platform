import { type EmailBranding, type RenderedEmail, renderLayout } from './layout.js';

export type { EmailBranding, EmailButton, EmailContent, RenderedEmail } from './layout.js';
export { renderLayout, escapeHtml } from './layout.js';

export type TemplateName = 'invitation' | 'magic-link' | 'test-delivery';

/** Formats an expiry for humans: "15 minutes", "7 days". */
function describeDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// ------------------------------------------------------------------ invitation (E3-1)

export interface InvitationInput {
  /** Delegate's display name; the greeting falls back to "Hello" when empty. */
  recipientName?: string;
  /** Single-use, absolute invitation link tied to the registration. */
  inviteUrl: string;
  /** Validity window of the link in minutes. */
  expiresInMinutes: number;
  /** Shown as the first paragraph; e.g. "12-13 November 2026, Lagos Oriental Hotel". */
  eventSummary?: string;
}

export function renderInvitation(branding: EmailBranding, input: InvitationInput): RenderedEmail {
  const greeting = input.recipientName ? `Hello ${input.recipientName},` : 'Hello,';
  return renderLayout(branding, {
    subject: `Your ${branding.eventName} impact platform invitation`,
    preheader: `Activate your ${branding.eventName} account to record what you will take back to work.`,
    eyebrow: 'Invitation',
    title: `Welcome to the ${branding.eventName} impact platform`,
    paragraphs: [
      greeting,
      `You are registered for ${branding.eventName}${input.eventSummary ? ` (${input.eventSummary})` : ''}. This platform follows your journey from a short pre-conference check-in, through the conference days, to brief follow-ups afterwards, so that your learning turns into measurable results at work.`,
      'Use the button below to activate your account. The link is personal and works once.',
    ],
    button: { label: 'Activate my account', url: input.inviteUrl },
    notes: [
      `This link expires in ${describeDuration(input.expiresInMinutes)}. If it has expired, open the platform and request a new one with this email address.`,
      'If you did not register for this conference, you can ignore this email.',
    ],
  });
}

// ------------------------------------------------------------------ magic link (E3-3)

export interface MagicLinkInput {
  recipientName?: string;
  /** Single-use, absolute sign-in link. */
  signInUrl: string;
  expiresInMinutes: number;
  /** Optional one-time code shown as an alternative to the link. */
  code?: string;
}

export function renderMagicLink(branding: EmailBranding, input: MagicLinkInput): RenderedEmail {
  const paragraphs = [
    input.recipientName ? `Hello ${input.recipientName},` : 'Hello,',
    `Here is your sign-in link for the ${branding.eventName} impact platform. It works once and only on this email address.`,
  ];
  if (input.code) {
    paragraphs.push(`Prefer to type? Enter this one-time code on the sign-in page: ${input.code}`);
  }
  return renderLayout(branding, {
    subject: `Sign in to ${branding.eventName}`,
    preheader: `Your sign-in link expires in ${describeDuration(input.expiresInMinutes)}.`,
    eyebrow: 'Sign in',
    title: 'Your sign-in link',
    paragraphs,
    button: { label: 'Sign in', url: input.signInUrl },
    notes: [
      `This link expires in ${describeDuration(input.expiresInMinutes)}.`,
      'If you did not request it, no action is needed: nobody can sign in without this email.',
    ],
  });
}

// ------------------------------------------------------------------ test delivery (E0-12 / T15)

export interface TestDeliveryInput {
  /** Where the email was sent from, e.g. "staging" or a person's name; shown in the body. */
  sentFrom: string;
  /** ISO timestamp of the send; shown in the body so screenshots are unambiguous. */
  sentAt: string;
}

export function renderTestDelivery(
  branding: EmailBranding,
  input: TestDeliveryInput,
): RenderedEmail {
  return renderLayout(branding, {
    subject: `[Test] ${branding.eventName} email delivery check`,
    preheader: 'If you can read this in your inbox (not spam), delivery works.',
    eyebrow: 'Delivery test',
    title: 'This is a test email',
    paragraphs: [
      `It was sent from the ${branding.eventName} impact platform (${input.sentFrom}) at ${input.sentAt} to check that email delivery, authentication (SPF, DKIM, DMARC) and rendering work for this mailbox.`,
      'Please check three things: it arrived in the inbox rather than spam, the logo and button render correctly, and the layout is readable on a phone.',
    ],
    button: { label: 'Open the platform', url: branding.appUrl },
    notes: ['No action is needed. You can delete this message.'],
  });
}

export const templates = {
  invitation: renderInvitation,
  'magic-link': renderMagicLink,
  'test-delivery': renderTestDelivery,
} as const;
