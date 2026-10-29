import type { MyEvent } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EventCardGrid } from './event-cards';

const lagos: MyEvent = {
  id: 'e1',
  slug: 'ittec-2026',
  name: 'ITTEC 2026: International Training Transfer Effectiveness Conference',
  theme: 'Technology, Practice, and Impact',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  timezone: 'Africa/Lagos',
  location: 'Lagos Oriental Hotel',
  format: 'hybrid',
  period: 'upcoming',
  registration: {
    id: 'd1',
    status: 'active',
    attendanceFormat: 'physical',
    capacity: 'individual',
    organisation: 'Acme',
    jobTitle: null,
    country: null,
    signedUpAt: null,
  },
  attendance: { status: 'not_recorded' },
};
const past: MyEvent = {
  ...lagos,
  id: 'e2',
  name: 'Past Summit',
  period: 'past',
  location: null,
  format: 'virtual',
  registration: { ...lagos.registration, status: 'test', attendanceFormat: 'virtual' },
};

describe('EventCardGrid', () => {
  it('shows each event as a card with its facts, pills and a View more button to its page', () => {
    render(<EventCardGrid events={[lagos, past]} label="Events" />);
    const grid = screen.getByRole('list', { name: 'Events' });
    const first = within(grid).getByRole('article', { name: lagos.name });
    expect(within(first).getByText('Upcoming')).toBeTruthy();
    expect(within(first).getByText('In person')).toBeTruthy();
    expect(within(first).getByText('12-13 November 2026')).toBeTruthy();
    expect(within(first).getByText('Lagos Oriental Hotel')).toBeTruthy();
    expect(within(first).getByText('not recorded')).toBeTruthy();
    expect(within(first).getByRole('link', { name: 'View more' }).getAttribute('href')).toBe(
      '/account/events/e1',
    );
    const second = within(grid).getByRole('article', { name: 'Past Summit' });
    expect(within(second).getByText('Past')).toBeTruthy();
    expect(within(second).getByText('Online event')).toBeTruthy(); // no venue: the format is shown
    expect(within(second).getByText('Test registration')).toBeTruthy();
    expect(screen.queryByText(/attended/i)).toBeNull();
  });
});
