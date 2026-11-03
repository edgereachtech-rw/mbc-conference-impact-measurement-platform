/**
 * platform profile configuration.
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

export interface PlatformConfig {
  timezone: string;

  /** Short name used in the header, PWA manifest and badges. */
  shortName: string;
  /** Full conference name. */
  fullName: string;
  /** Conference theme as published on the website. */

  venue: {
    name: string;
    area: string;
    city: string;
    country: string;
    /** Single-line form used in the footer. */
    display: string;
    mapUrl: string;
  };

  company: { name: string; url: string };
  contactEmail: string;
  social: SocialLink[];
  copyright: string;
}

export const platform: PlatformConfig = {
  shortName: 'MBC Impact Intelligence Platform',
  timezone: 'Africa/Lagos',
  fullName: 'MBC Impact Intelligence Platform',

  venue: {
    name: 'Lekki Atlantic Layout',
    area: 'Lekki-Epe Expressway',
    city: 'Lagos',
    country: 'Nigeria',
    display: 'Lekki Atlantic Layout, Lekki-Epe Expressway, Lagos, Nigeria',
    mapUrl: 'https://maps.app.goo.gl/HUMV2msKMtDsB6dk9',
  },
  company: { name: 'M.Bryan Consulting LTD', url: 'https://mbryanconsultinggroup.com/' },
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
