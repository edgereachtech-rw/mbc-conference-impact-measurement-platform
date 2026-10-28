import type { PrismaClient } from '../db.js';
import type { MailConfig } from './config.js';
import type { EmailBranding } from './templates/layout.js';

/** Organiser name is not event data; it comes from the environment with a neutral default. */
const organiser = () => process.env.MAIL_ORGANISER_NAME ?? 'the conference organisers';

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
  };
}

/** Used when no database is configured (local preview, CI): generic, clearly non-event branding. */
export function genericBranding(config: MailConfig): EmailBranding {
  return {
    eventName: process.env.MAIL_EVENT_NAME ?? 'Conference Impact Platform',
    organiser: organiser(),
    contactEmail: config.contactEmail,
    appUrl: config.appUrl,
  };
}

/** Loads the active event (or the most recent one) for email branding; null when none exists. */
export async function loadEventBranding(
  prisma: PrismaClient,
  config: MailConfig,
): Promise<EmailBranding | null> {
  const event =
    (await prisma.event.findFirst({
      where: { status: 'active' },
      orderBy: { startsOn: 'desc' },
    })) ?? (await prisma.event.findFirst({ orderBy: { startsOn: 'desc' } }));
  return event ? brandingForEvent(config, event) : null;
}
