import type { MyEvent } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProfilePanel } from './profile-panel';

const lagos: MyEvent = {
  id: 'e1',
  slug: 'ittec-2026',
  name: 'ITTEC 2026',
  theme: null,
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  timezone: 'Africa/Lagos',
  location: 'Lagos',
  format: 'hybrid',
  period: 'upcoming',
  registration: {
    id: 'd1',
    status: 'active',
    attendanceFormat: 'virtual',
    capacity: 'nominee',
    organisation: 'Acme',
    jobTitle: null,
    country: 'Nigeria',
    signedUpAt: '2026-10-29T15:34:07.015Z',
  },
  attendance: { status: 'pending' },
};

describe('ProfilePanel', () => {
  it('shows the account identity and each registration as a read-only card with the contact route', () => {
    render(
      <ProfilePanel
        displayName="Ada Lovelace"
        email="ada@example.com"
        initialEvents={[lagos]}
        contactEmail="conference@example.com"
      />,
    );
    const account = screen.getByRole('region', { name: 'Your account' });
    expect(within(account).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(account).getByText('ada@example.com')).toBeTruthy();
    expect(within(account).getByRole('link', { name: 'conference@example.com' })).toBeTruthy();
    const reg = screen.getByRole('article', { name: 'ITTEC 2026' });
    expect(within(reg).getByText('12-13 November 2026')).toBeTruthy();
    expect(within(reg).getByText('Acme')).toBeTruthy();
    expect(within(reg).getByText('Nigeria')).toBeTruthy();
    expect(within(reg).getByText('Nominated by an organisation')).toBeTruthy();
    expect(within(reg).getByText('Not provided')).toBeTruthy(); // job title
    expect(within(reg).getByText('Registered')).toBeTruthy();
    expect(within(reg).getByText('Online')).toBeTruthy();
    expect(within(reg).getByText('29 October 2026')).toBeTruthy();
    expect(within(reg).getByRole('link', { name: 'View event' }).getAttribute('href')).toBe(
      '/account/events/e1',
    );
    expect(screen.queryByRole('textbox')).toBeNull(); // nothing is editable here
  });

  it('shows the empty registrations note', () => {
    render(
      <ProfilePanel displayName="A" email="a@example.com" initialEvents={[]} contactEmail="c@x" />,
    );
    expect(screen.getByText('No events yet')).toBeTruthy();
  });
});
