import type { MyEvent } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EventDetail } from './event-detail';

const lagos: MyEvent = {
  id: 'e1',
  slug: 'ittec-2026',
  name: 'ITTEC 2026',
  theme: null,
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  timezone: 'Africa/Lagos',
  location: 'Lagos Oriental Hotel',
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

describe('EventDetail', () => {
  it('shows the event facts, the registration, attendance only as not recorded, and the journey for an upcoming event', () => {
    render(<EventDetail event={lagos} contactEmail="conference@example.com" />);
    const facts = screen.getByRole('region', { name: 'Event' });
    expect(within(facts).getByText('12-13 November 2026')).toBeTruthy();
    expect(within(facts).getByText('Africa/Lagos')).toBeTruthy();
    expect(within(facts).getByText('Lagos Oriental Hotel')).toBeTruthy();
    expect(within(facts).getByText('Hybrid')).toBeTruthy();
    const reg = screen.getByRole('region', { name: 'Your registration' });
    expect(within(reg).getByText('Registered')).toBeTruthy();
    expect(within(reg).getByText('Online')).toBeTruthy();
    expect(within(reg).getByText('Acme')).toBeTruthy();
    expect(within(reg).getByText('Not provided')).toBeTruthy(); // job title
    expect(within(reg).getByText('Nominated by an organisation')).toBeTruthy();
    expect(within(reg).getByText('29 October 2026')).toBeTruthy();
    expect(within(reg).getByText('Pending')).toBeTruthy();
    expect(within(reg).getByRole('link', { name: 'conference@example.com' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your journey' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByText(/attended/i)).toBeNull();
  });

  it('omits the journey for a past event', () => {
    render(<EventDetail event={{ ...lagos, period: 'past' }} contactEmail="c@x" />);
    expect(screen.queryByRole('region', { name: 'Your journey' })).toBeNull();
    expect(screen.getByText('Past')).toBeTruthy();
  });
});
