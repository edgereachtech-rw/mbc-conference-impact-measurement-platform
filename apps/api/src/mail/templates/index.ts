import type { EmailCustomisation } from '@mbc/shared';

import {
  greetingOf,
  recipientValues,
  renderCustomisable,
  renderLayout,
  wordingOf,
  type EmailBranding,
  type RenderedEmail,
} from './layout.js';

export type { EmailBranding, EmailButton, EmailContent, RenderedEmail } from './layout.js';
export { renderLayout, escapeHtml, wordingOf, recipientValues, greetingOf } from './layout.js';

const nounOf = (branding: EmailBranding) => branding.eventNoun ?? 'conference';

export type TemplateName =
  | 'invitation'
  | 'magic-link'
  | 'test-delivery'
  | 'admin-message'
  | 'transfer-plan-reminder'
  | 'transfer-plan-completed'
  | 'transfer-plan-impact-check';

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

export function renderInvitation(
  branding: EmailBranding,
  input: InvitationInput,
  custom?: EmailCustomisation | null,
): RenderedEmail {
  const noun = nounOf(branding);
  const values = {
    ...recipientValues(branding, input.recipientName),
    eventDates: input.eventSummary ?? '',
  };
  const w = wordingOf(
    {
      subject: `Your ${branding.eventName} impact platform invitation`,
      title: `Welcome to the ${branding.eventName} impact platform`,
      intro: [
        `You are registered for ${branding.eventName}${input.eventSummary ? ` (${input.eventSummary})` : ''}. This platform follows your journey from a short pre-${noun} check-in, through the ${noun} days, to brief follow-ups afterwards, so that your learning turns into measurable results at work.`,
        'Use the button below to activate your account. The link is personal and works once.',
      ],
      closing: [
        `This link expires in ${describeDuration(input.expiresInMinutes)}. If it has expired, open the platform and request a new one with this email address.`,
        `If you did not register for this ${noun}, you can ignore this email.`,
      ],
      buttonLabel: 'Activate my account',
    },
    custom,
    values,
  );
  return {
    ...renderCustomisable(
      branding,
      {
        subject: w.subject,
        preheader: `Activate your ${branding.eventName} account to record what you will take back to work.`,
        eyebrow: 'Invitation',
        title: w.title,
        paragraphs: [greetingOf(input.recipientName), ...w.intro],
        button: { label: w.buttonLabel, url: input.inviteUrl },
        notes: w.closing,
      },
      custom,
      values,
    ),
    parts: w.parts,
  };
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

// ------------------------------------------------------------------ admin message (E2-14)

export interface AdminMessageInput {
  /** Subject with the recipient's placeholders already filled; also the email's title. */
  subject: string;
  /** Body rendered by the shared message renderer for this recipient. */
  body: { html: string; text: string };
}

/** An email an admin wrote to selected delegates, in the event's branding with no button. */
export function renderAdminMessage(
  branding: EmailBranding,
  input: AdminMessageInput,
): RenderedEmail {
  const firstLine = input.body.text.split('\n').find((line) => line.trim() !== '');
  return renderLayout(branding, {
    subject: input.subject,
    preheader: (firstLine ?? input.subject).slice(0, 140),
    eyebrow: branding.eventName,
    title: input.subject,
    paragraphs: [],
    body: input.body,
  });
}

// ------------------------------------------------------------------ transfer plan reminder (E12)

export interface TransferPlanReminderInput {
  recipientName?: string;
  /** The action the reminder is about: its title or, failing that, its text. */
  actionName: string;
  /** The action's "what specifically will you do differently", when the title is separate. */
  actionText?: string;
  /** The first practical step and the dates, when the delegate wrote them. */
  firstStep?: string;
  targetOn?: string;
  /** How often the delegate chose to be reminded, in words ("every two weeks"). */
  frequency: string;
  /** Absolute link to the delegate's plan page. */
  planUrl: string;
}

/**
 * A reminder the delegate asked for about one planned action (decision 2026-11-11): it reminds,
 * and asks for nothing. It names the action, its first step and target date, and says the
 * delegate can go to the platform to update the plan whenever they wish.
 */
export function renderTransferPlanReminder(
  branding: EmailBranding,
  input: TransferPlanReminderInput,
  custom?: EmailCustomisation | null,
): RenderedEmail {
  const values = {
    ...recipientValues(branding, input.recipientName),
    actionName: input.actionName,
    firstStep: input.firstStep ?? '',
    targetDate: input.targetOn ?? '',
  };
  const w = wordingOf(
    {
      subject: `Reminder: ${input.actionName}`,
      title: 'A reminder about your action',
      intro: [
        `A reminder you asked for, ${input.frequency}, about an action in your ${branding.eventName} Transfer Plan:`,
      ],
      closing: [
        'You can change how often you hear about this action, or stop its reminders, on your plan page.',
      ],
      buttonLabel: 'Open my plan',
    },
    custom,
    values,
  );
  const paragraphs = [
    greetingOf(input.recipientName),
    ...w.intro,
    input.actionText ? `${input.actionName}: ${input.actionText}` : input.actionName,
  ];
  if (input.firstStep) paragraphs.push(`First step: ${input.firstStep}`);
  if (input.targetOn) paragraphs.push(`Target date: ${input.targetOn}`);
  paragraphs.push(
    'Nothing is needed from you now. Whenever you wish, you can go to the platform to update your plan: where the action stands, its measures and your evidence.',
  );
  return {
    ...renderCustomisable(
      branding,
      {
        subject: w.subject,
        preheader: `A reminder you asked for about your ${branding.eventName} Transfer Plan.`,
        eyebrow: 'Transfer plan',
        title: w.title,
        paragraphs,
        button: { label: w.buttonLabel, url: input.planUrl },
        notes: w.closing,
      },
      custom,
      values,
    ),
    parts: w.parts,
  };
}

export interface TransferPlanCompletedInput {
  delegateName: string;
  planTitle: string;
  /** Written actions on the plan. */
  actions: number;
  /** What the delegate reported: applied with no measurable improvement yet, or impact demonstrated. */
  outcome: string;
  /** Absolute link to the organisers' transfer plan list for the event. */
  adminUrl: string;
}

/**
 * To the organisers when a delegate marks a plan completed (2026-11-06): who, which plan, how
 * many actions, and where to read it. Never the plan's text, which belongs on the admin page.
 */
export function renderTransferPlanCompleted(
  branding: EmailBranding,
  input: TransferPlanCompletedInput,
): RenderedEmail {
  return renderLayout(branding, {
    subject: `${input.delegateName} completed a transfer plan (${branding.eventName})`,
    preheader: `${input.planTitle}: every action has a result and evidence.`,
    eyebrow: 'Transfer plan',
    title: 'A plan is completed',
    paragraphs: [
      `${input.delegateName} has marked "${input.planTitle}" completed for ${branding.eventName}. ${
        input.actions === 1 ? 'Its one action was' : `Its ${input.actions} actions were`
      } applied, with evidence.`,
      `What it has shown so far, as the delegate reports it: ${input.outcome}. Impact checks will ask later whether an improvement appeared or lasted.`,
      'Open the plan to read the evidence and results as the delegate recorded them.',
    ],
    button: { label: 'Open transfer plans', url: input.adminUrl },
  });
}

export interface FollowUpInvitationInput {
  recipientName?: string;
  /** What the wave is called, e.g. "30-day follow-up". */
  waveLabel: string;
  /** Absolute link to the delegate's assessments for the event. */
  formUrl: string;
  /** The deadline in words, in the event's time zone; omitted when the wave has none. */
  deadline?: string;
  /** True for a chaser to someone who has not submitted yet. */
  reminder?: boolean;
}

/**
 * The invitation to a follow-up wave, and the chaser to a delegate who has not answered (E12-14).
 * One template, two tones: the first tells them it is open, the second that it is still waiting.
 * Neither carries any of their answers.
 */
export function renderFollowUpInvitation(
  branding: EmailBranding,
  input: FollowUpInvitationInput,
  custom?: EmailCustomisation | null,
): RenderedEmail {
  const values = {
    ...recipientValues(branding, input.recipientName),
    waveLabel: input.waveLabel,
    deadline: input.deadline ?? '',
  };
  const w = wordingOf(
    {
      subject: input.reminder
        ? `Still open: your ${input.waveLabel}`
        : `Your ${input.waveLabel} is open`,
      title: input.reminder ? 'Your follow-up is waiting' : input.waveLabel,
      intro: [
        input.reminder
          ? `Your ${input.waveLabel} from ${branding.eventName} is still open. It asks what you have been able to apply, what has helped and what is in the way — your Transfer Plan is shown beside the questions, so there is nothing to look up.`
          : `Your ${input.waveLabel} from ${branding.eventName} is now open. It asks what you have been able to apply, what has helped and what is in the way. Your Transfer Plan and what you said you wanted to do differently are shown beside the questions.`,
      ],
      closing: [
        'The organisers send this once when a follow-up opens. The reminders you choose on your plan page point at the follow-up that is open when they arrive.',
      ],
      buttonLabel: 'Open the follow-up',
    },
    custom,
    values,
  );
  const paragraphs = [greetingOf(input.recipientName), ...w.intro];
  if (input.deadline) {
    paragraphs.push(`Please answer by ${input.deadline}. Your answers save as you go.`);
  }
  return {
    ...renderCustomisable(
      branding,
      {
        subject: w.subject,
        preheader: input.reminder
          ? 'A reminder: your follow-up is still waiting.'
          : `Tell us what you have applied since the ${nounOf(branding)}.`,
        eyebrow: 'Transfer Plan follow-up',
        title: w.title,
        paragraphs,
        button: { label: w.buttonLabel, url: input.formUrl },
        notes: w.closing,
      },
      custom,
      values,
    ),
    parts: w.parts,
  };
}

export interface SessionFeedbackInput {
  recipientName?: string;
  /** The session as the delegate knows it. */
  sessionTitle: string;
  /** "Thursday 12 November, 14:00-15:30", already in the event's zone. */
  whenLine: string;
  /** Who ran it, when the session records one. */
  speaker?: string;
  /** Absolute link to /feedback/:code. */
  formUrl: string;
}

/**
 * The session feedback form, sent to someone who was in the room (task of 2026-11-03). Short on
 * purpose: they are being asked for five minutes, and the one thing that matters is the button.
 */
export function renderSessionFeedback(
  branding: EmailBranding,
  input: SessionFeedbackInput,
  custom?: EmailCustomisation | null,
): RenderedEmail {
  const values = {
    ...recipientValues(branding, input.recipientName),
    sessionTitle: input.sessionTitle,
    speaker: input.speaker ?? '',
    when: input.whenLine,
  };
  const w = wordingOf(
    {
      subject: `How was ${input.sessionTitle}?`,
      title: input.sessionTitle,
      intro: [
        `You were at ${input.sessionTitle}${input.speaker ? ` with ${input.speaker}` : ''} (${input.whenLine}). Tell us how it went — three quick ratings and two optional comments, about five minutes.`,
        'It shapes what runs next year, and the speaker sees it without your name attached.',
        'The form stays open until the organisers close it.',
      ],
      closing: [
        'You are asked because your attendance at this session was recorded.',
        'The form is also on your event page under Session feedback.',
      ],
      buttonLabel: 'Give feedback on this session',
    },
    custom,
    values,
  );
  return {
    ...renderCustomisable(
      branding,
      {
        subject: w.subject,
        preheader: 'Five minutes on the session you attended.',
        eyebrow: 'Session feedback',
        title: w.title,
        paragraphs: [greetingOf(input.recipientName), ...w.intro],
        button: { label: w.buttonLabel, url: input.formUrl },
        notes: w.closing,
      },
      custom,
      values,
    ),
    parts: w.parts,
  };
}

export const templates = {
  invitation: renderInvitation,
  'admin-message': renderAdminMessage,
  'magic-link': renderMagicLink,
  'test-delivery': renderTestDelivery,
  'transfer-plan-reminder': renderTransferPlanReminder,
  'follow-up-invitation': renderFollowUpInvitation,
  'session-feedback': renderSessionFeedback,
} as const;

export interface ImpactCheckInput {
  recipientName?: string;
  planTitle: string;
  /** The plan's outcome so far, in words. */
  outcome: string;
  /** True when the plan has shown an improvement: the check asks whether it has continued. */
  sustaining: boolean;
  /** Absolute link to the delegate's plan page. */
  planUrl: string;
}

/**
 * An impact check after a plan is completed (2026-11-06): has a measurable improvement appeared
 * since, or has the one reported continued? Sent once per check; answered on the plan page.
 */
export function renderImpactCheck(
  branding: EmailBranding,
  input: ImpactCheckInput,
  custom?: EmailCustomisation | null,
): RenderedEmail {
  const question = input.sustaining
    ? `When you completed "${input.planTitle}" you reported a measurable improvement. Has it continued? Tell us, with the evidence you have, on your plan page.`
    : `When you completed "${input.planTitle}" you had not yet seen a measurable improvement. Has one appeared since? Tell us either way, with the evidence you have, on your plan page.`;
  const values = {
    ...recipientValues(branding, input.recipientName),
    planTitle: input.planTitle,
    outcome: input.outcome,
  };
  const w = wordingOf(
    {
      subject: input.sustaining
        ? `Has the improvement from your ${branding.eventName} plan continued?`
        : `Any measurable improvement from your ${branding.eventName} plan yet?`,
      title: input.sustaining ? 'Has the improvement lasted?' : 'Has an improvement appeared?',
      intro: [
        question,
        `So far your plan stands as: ${input.outcome}. "No measurable improvement yet" is a valid answer; it is what the evidence shows that counts.`,
      ],
      closing: [],
      buttonLabel: 'Answer on my plan page',
    },
    custom,
    values,
  );
  return {
    ...renderCustomisable(
      branding,
      {
        subject: w.subject,
        preheader: 'A short impact check on your completed plan.',
        eyebrow: 'Transfer plan',
        title: w.title,
        paragraphs: [greetingOf(input.recipientName), ...w.intro],
        button: { label: w.buttonLabel, url: input.planUrl },
        notes: w.closing.length ? w.closing : undefined,
      },
      custom,
      values,
    ),
    parts: w.parts,
  };
}
