/**
 * Event configuration for the current pilot.
 *
 * Interim: this file holds the ITTEC 2026 facts the shell needs (names, dates, venue, links).
 * In increment E1 (conference setup) these move to the `events` table and this file goes away.
 * Nothing here should be imported by scoring, status or question logic.
 */

export type SocialNetwork = 'facebook' | 'x' | 'instagram' | 'youtube' | 'linkedin';

export interface SocialLink {
  network: SocialNetwork;
  label: string;
  href: string;
}

export interface EventConfig {
  /** Short name used in the header, PWA manifest and badges. */
  shortName: string;
  /** Full conference name. */
  fullName: string;
  /** Conference theme as published on the website. */
  theme: string;
  /** Hero tagline. */
  tagline: string;
  /** Supporting strapline under the title. */
  strapline: string;
  /** Delivery format label and explanatory note. */
  format: { label: string; note: string };
  dates: {
    /** ISO dates in the event timezone (inclusive). */
    start: string;
    end: string;
    /** Display string used verbatim in the UI. */
    display: string;
  };
  venue: {
    name: string;
    area: string;
    city: string;
    country: string;
    /** Single-line form used in the footer. */
    display: string;
    mapUrl: string;
  };
  timezone: string;
  organiser: { name: string; url: string };
  website: string;
  contactEmail: string;
  social: SocialLink[];
  copyright: string;
}

export const event: EventConfig = {
  shortName: 'ITTEC 2026',
  fullName: 'International Training Transfer Effectiveness Conference',
  theme: 'Technology, Practice, and Impact',
  tagline: 'Turning Training Into Measurable Impact',
  strapline: "The World's First Training Transfer Effectiveness Conference",
  format: {
    label: 'Hybrid Conference',
    note: 'Join us in Lagos or online from anywhere in the world',
  },
  dates: {
    start: '2026-11-12',
    end: '2026-11-13',
    display: '12-13 November 2026',
  },
  venue: {
    name: 'Lagos Oriental Hotel',
    area: 'Victoria Island',
    city: 'Lagos',
    country: 'Nigeria',
    display: 'Lagos Oriental Hotel, Victoria Island, Lagos',
    mapUrl: 'https://maps.app.goo.gl/HUMV2msKMtDsB6dk9',
  },
  timezone: 'Africa/Lagos',
  organiser: { name: 'M.Bryan Consulting', url: 'https://mbryanconsultinggroup.com/' },
  website: 'https://itteconference.mbryanconsultinggroup.com/',
  contactEmail: 'conference@mbryanconsultinggroup.com',
  social: [
    {
      network: 'facebook',
      label: 'Facebook',
      href: 'https://www.facebook.com/profile.php?id=61561846724329',
    },
    { network: 'x', label: 'X (Twitter)', href: 'https://x.com/MbryanColtd' },
    {
      network: 'instagram',
      label: 'Instagram',
      href: 'https://www.instagram.com/mbryanconsultingltd',
    },
    { network: 'youtube', label: 'YouTube', href: 'https://youtube.com/@mbryanconsulting' },
    {
      network: 'linkedin',
      label: 'LinkedIn',
      href: 'https://www.linkedin.com/company/mbryanconsultinglimited/',
    },
  ],
  copyright: 'Copyright © 2026 M.Bryan Consulting. All rights reserved.',
};

/** Participation mode of a delegate. Stored per delegate in E2; the shell only renders it. */
export type ParticipationMode = 'physical' | 'virtual';

export const participationModeLabel: Record<ParticipationMode, string> = {
  physical: 'Physical',
  virtual: 'Virtual',
};
