import {
  emailKindInfo,
  emailKinds,
  emailStyleIsDefault,
  EMPTY_EMAIL_CUSTOMISATION,
  parseEmailStyle,
  type EmailCustomisation,
  type EmailKind,
  type EmailParts,
  type EventEmailView,
} from '@mbc/shared';

import type { PrismaClient } from '../db.js';
import { brandingForEvent } from './branding.js';
import type { MailConfig } from './config.js';
import {
  renderFollowUpInvitation,
  renderImpactCheck,
  renderInvitation,
  renderSessionFeedback,
  renderTransferPlanReminder,
  type EmailBranding,
  type RenderedEmail,
} from './templates/index.js';
import { renderOnboardingPack } from './templates/onboarding.js';

/**
 * The organisers' own wording per kind of email per event (decision 2026-11-19). Each sender
 * loads the wording for its event and kind and hands it to the template; the admin screen reads
 * every kind with the platform's defaults and a preview rendered from sample values.
 */

type Reader = Pick<PrismaClient, 'eventEmailTemplate'>;

/** Whether anything of the organisers' is set: a word, the whole content or the look. */
export function isCustomised(custom: EmailCustomisation | null | undefined): boolean {
  if (!custom) return false;
  return (
    Boolean(custom.subject || custom.title || custom.intro || custom.closing) ||
    Boolean(custom.buttonLabel || custom.body) ||
    !emailStyleIsDefault(custom.style)
  );
}

/** The stored wording of one kind for one event; null when the platform's wording stands. */
export async function emailCustomisationFor(
  prisma: Reader,
  eventId: string,
  kind: EmailKind,
): Promise<EmailCustomisation | null> {
  const row = await prisma.eventEmailTemplate.findUnique({
    where: { eventId_kind: { eventId, kind } },
    select: {
      subject: true,
      title: true,
      intro: true,
      closing: true,
      buttonLabel: true,
      body: true,
      style: true,
    },
  });
  if (!row) return null;
  const custom: EmailCustomisation = {
    ...EMPTY_EMAIL_CUSTOMISATION,
    ...row,
    style: parseEmailStyle(row.style),
  };
  return isCustomised(custom) ? custom : null;
}

/** Every kind's wording for one event, in one query. */
export async function emailCustomisationsFor(
  prisma: Reader,
  eventId: string,
): Promise<Map<EmailKind, EmailCustomisation>> {
  const rows = await prisma.eventEmailTemplate.findMany({
    where: { eventId },
    select: {
      kind: true,
      subject: true,
      title: true,
      intro: true,
      closing: true,
      buttonLabel: true,
      body: true,
      style: true,
    },
  });
  const out = new Map<EmailKind, EmailCustomisation>();
  for (const { kind, style, ...rest } of rows) {
    if ((emailKinds as readonly string[]).includes(kind)) {
      out.set(kind as EmailKind, {
        ...EMPTY_EMAIL_CUSTOMISATION,
        ...rest,
        style: parseEmailStyle(style),
      });
    }
  }
  return out;
}

export interface SampleEvent {
  id: string;
  name: string;
  eventType: string;
  startsOn: Date;
  endsOn: Date;
  timezone: string;
  location: string | null;
}

/**
 * Renders one kind with sample values, as the admin screen previews it. The sample delegate and
 * facts are invented; the event's own name, dates and venue are real so the preview reads true.
 */
export function renderSample(
  kind: EmailKind,
  branding: EmailBranding,
  appUrl: string,
  custom: EmailCustomisation | null,
): RenderedEmail {
  const base = appUrl.replace(/\/+$/, '');
  const recipientName = 'Ada Lovelace';
  switch (kind) {
    case 'onboarding':
      return renderOnboardingPack(
        branding,
        {
          recipientName,
          eventDates: branding.footerLine?.split(' | ').pop() ?? '',
          venue: branding.footerLine?.includes(' | ')
            ? branding.footerLine.split(' | ')[0]
            : undefined,
          dashboardUrl: `${base}/account`,
          badgeUrl: `${base}/account`,
          dates: [],
          firstStep: undefined,
        },
        custom,
      );
    case 'invitation':
      return renderInvitation(
        branding,
        {
          recipientName,
          inviteUrl: `${base}/signin?invite=sample`,
          expiresInMinutes: 7 * 24 * 60,
          eventSummary: branding.footerLine?.split(' | ').pop() ?? undefined,
        },
        custom,
      );
    case 'follow_up_invitation':
    case 'follow_up_reminder':
      return renderFollowUpInvitation(
        branding,
        {
          recipientName,
          waveLabel: '30-day follow-up',
          formUrl: `${base}/account`,
          deadline: 'Friday 18 December 2026, 18:00',
          reminder: kind === 'follow_up_reminder',
        },
        custom,
      );
    case 'transfer_plan_reminder':
      return renderTransferPlanReminder(
        branding,
        {
          recipientName,
          actionName: 'Run a monthly transfer review with my team',
          actionText: undefined,
          firstStep: 'Book the first review for the second week of December',
          targetOn: '15 January 2027',
          frequency: 'weekly',
          planUrl: `${base}/account`,
        },
        custom,
      );
    case 'session_feedback':
      return renderSessionFeedback(
        branding,
        {
          recipientName,
          sessionTitle: 'Measuring what changed at work',
          whenLine: 'Thursday 12 November, 14:00-15:30',
          speaker: 'A. Speaker',
          formUrl: `${base}/feedback/sample`,
        },
        custom,
      );
    case 'impact_check':
    case 'impact_check_sustaining':
      return renderImpactCheck(
        branding,
        {
          recipientName,
          planTitle: 'Coaching rollout',
          outcome:
            kind === 'impact_check_sustaining'
              ? 'impact demonstrated'
              : 'applied, no measurable improvement yet',
          sustaining: kind === 'impact_check_sustaining',
          planUrl: `${base}/account`,
        },
        custom,
      );
  }
}

/** The platform's wording of a kind, from a render with no customisation. */
export function defaultParts(kind: EmailKind, branding: EmailBranding, appUrl: string): EmailParts {
  const parts = renderSample(kind, branding, appUrl, null).parts;
  if (!parts) throw new Error(`The ${kind} email exposes no editable parts.`);
  return parts;
}

/** Every kind for the admin screen: label, placeholders, defaults, the stored wording, a preview. */
export async function eventEmailViews(
  prisma: Reader,
  mailConfig: MailConfig,
  event: SampleEvent,
): Promise<EventEmailView[]> {
  const branding = brandingForEvent(mailConfig, event);
  const stored = await emailCustomisationsFor(prisma, event.id);
  return emailKinds.map((kind) => {
    const custom = stored.get(kind) ?? null;
    const preview = renderSample(kind, branding, mailConfig.appUrl, custom);
    return {
      kind,
      label: emailKindInfo[kind].label,
      description: emailKindInfo[kind].description,
      placeholders: [...emailKindInfo[kind].placeholders],
      defaults: defaultParts(kind, branding, mailConfig.appUrl),
      custom: isCustomised(custom) ? custom : null,
      preview: { subject: preview.subject, html: preview.html },
    };
  });
}
