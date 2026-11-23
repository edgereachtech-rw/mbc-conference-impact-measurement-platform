import { eventNounOf, eventTypes, type EventType } from '@mbc/shared';

import type { MailConfig } from './config.js';
import type { EmailBranding } from './templates/layout.js';

/**
 * Organiser name is not event data; it comes from the environment with a neutral default. Used by
 * the email layouts and by the PDF, Word and Excel downloads, which carry it as the author.
 */
export const organiserName = () => process.env.MAIL_ORGANISER_NAME ?? 'the conference organisers';
const organiser = organiserName;

function formatDateRange(startsOn: Date, endsOn: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: timezone });
  const monthYear = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
  const sameMonth = monthYear.format(startsOn) === monthYear.format(endsOn);
  return sameMonth
    ? `${day.format(startsOn)}-${day.format(endsOn)} ${monthYear.format(endsOn)}`
    : `${day.format(startsOn)} ${monthYear.format(startsOn)} - ${day.format(endsOn)} ${monthYear.format(endsOn)}`;
}

/** Builds email branding from an event row; event facts stay in the database, not in code. */
export function brandingForEvent(
  config: MailConfig,
  event: {
    name: string;
    startsOn: Date;
    endsOn: Date;
    timezone: string;
    location: string | null;
    /** The event's kind, so the wording says "training" or "webinar" (2026-11-19). */
    eventType?: string | null;
  },
): EmailBranding {
  const [shortName, ...rest] = event.name.split(':');
  const dates = formatDateRange(event.startsOn, event.endsOn, event.timezone);
  return {
    eventName: shortName?.trim() || event.name,
    eventFullName: rest.join(':').trim() || undefined,
    organiser: organiser(),
    contactEmail: config.contactEmail,
    appUrl: config.appUrl,
    footerLine: [event.location, dates].filter(Boolean).join(' | '),
    eventNoun: eventNounOf(
      (eventTypes as readonly string[]).includes(event.eventType ?? '')
        ? (event.eventType as EventType)
        : null,
    ),
  };
}

/** Used when no database is configured (local preview, CI): generic, clearly non-event branding. */
/** What the platform is called in its own emails (decision 2026-11-23). */
export const PLATFORM_NAME = 'MBC Impact Intelligence Platform (IIP)';

/**
 * The platform's own branding (decision 2026-11-23): the sign-in email and the account
 * invitation carry the platform's name, never an event's. A person may be registered for several
 * events and one sign-in opens them all; naming the latest event on the platform (as these emails
 * did) told some delegates they were signing in to an event that was not theirs.
 */
export function genericBranding(config: MailConfig): EmailBranding {
  return {
    eventName: PLATFORM_NAME,
    organiser: organiser(),
    contactEmail: config.contactEmail,
    appUrl: config.appUrl,
  };
}
