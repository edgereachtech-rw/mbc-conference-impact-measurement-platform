import QRCode from 'qrcode';

import { attendanceToken } from '../routes/attendance.js';
import { brandingForEvent } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { MailAttachment, MailMessage } from '../mail/mailer.js';
import { renderOnboardingPack } from '../mail/templates/onboarding.js';

/**
 * Builds one delegate's onboarding pack (task of 2026-11-03).
 *
 * The attendance codes are derived, not stored: the token is a keyed hash of the delegate and the
 * date, so the code in this email is the same one the platform shows on screen. Nothing is
 * invalidated by sending it, and sending it twice sends the same codes.
 */

export interface PackEvent {
  id: string;
  name: string;
  startsOn: Date;
  endsOn: Date;
  timezone: string;
  location: string | null;
  dates: Array<{ id: string; date: Date }>;
}

export interface PackDelegate {
  id: string;
  name: string;
  email: string;
}

export interface PackDeps {
  mailConfig: MailConfig;
  /** Secret the attendance token is keyed with; the same one the attendance routes use. */
  hashSecret: string;
  appUrl: string;
}

const dayLabel = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(date);

const rangeLabel = (startsOn: Date, endsOn: Date, timezone: string) => {
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: timezone });
  const monthYear = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
  const sameMonth = monthYear.format(startsOn) === monthYear.format(endsOn);
  if (day.format(startsOn) === day.format(endsOn)) {
    return `${day.format(startsOn)} ${monthYear.format(startsOn)}`;
  }
  return sameMonth
    ? `${day.format(startsOn)}-${day.format(endsOn)} ${monthYear.format(endsOn)}`
    : `${day.format(startsOn)} ${monthYear.format(startsOn)} - ${day.format(endsOn)} ${monthYear.format(endsOn)}`;
};

export async function buildOnboardingPack(
  event: PackEvent,
  delegate: PackDelegate,
  deps: PackDeps,
  firstStep?: string,
): Promise<MailMessage> {
  const base = deps.appUrl.replace(/\/+$/, '');
  const attachments: MailAttachment[] = [];
  const dates = [];

  for (const [index, eventDate] of event.dates.entries()) {
    const token = attendanceToken(deps.hashSecret, delegate.id, eventDate.id);
    const png = await QRCode.toBuffer(token, { margin: 1, width: 300, type: 'png' });
    const cid = `attendance-${index + 1}@mbc`;
    attachments.push({
      filename: `check-in-day-${index + 1}.png`,
      content: png,
      contentType: 'image/png',
      cid,
    });
    dates.push({ label: dayLabel(eventDate.date, event.timezone), cid });
  }

  const rendered = renderOnboardingPack(brandingForEvent(deps.mailConfig, event), {
    recipientName: delegate.name,
    eventDates: rangeLabel(event.startsOn, event.endsOn, event.timezone),
    venue: event.location ?? '',
    dashboardUrl: `${base}/account/events/${event.id}`,
    badgeUrl: `${base}/account/events/${event.id}`,
    dates,
    firstStep,
  });

  return {
    to: delegate.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments,
  };
}
