import type { MyEvent } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

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

  it('arranges the records in tabs, opens the tab named in the address and keeps the choice in it', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const body = url.endsWith('/transfer-plan')
          ? {
              plan: {
                id: '11111111-1111-4111-8111-111111111111',
                eventId: '22222222-2222-4222-8222-222222222222',
                status: 'draft',
                version: 1,
                submittedAt: null,
                updatedAt: '2026-11-12T10:00:00.000Z',
                reminder: { frequency: 'none', startOn: null, nextReminderAt: null },
                actions: [],
              },
              sessions: [],
              canSubmit: false,
              references: [],
              reminders: [],
            }
          : { assessments: [], reflections: [], sessions: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    window.location.hash = '#transfer-plan';
    const user = userEvent.setup();
    render(<EventDetail event={lagos} contactEmail="c@x" />);
    const tabs = screen.getByRole('tablist', { name: 'Your records for this event' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([
      'Overview',
      'Assessments',
      'Attendance',
      'Daily reflections',
      'Session feedback',
      'Transfer plan',
    ]);
    expect(
      within(tabs).getByRole('tab', { name: 'Transfer plan' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByRole('region', { name: 'Event' })).toBeNull();
    expect(calls[0]).toBe('/api/v1/me/events/e1/transfer-plan');

    await user.click(within(tabs).getByRole('tab', { name: 'Assessments' }));
    expect(window.location.hash).toBe('#assessments');
    expect(screen.getByRole('tabpanel', { name: 'Assessments' })).toBeTruthy();
    expect(calls.at(-1)).toBe('/api/v1/me/events/e1/assessments');

    await user.click(within(tabs).getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('region', { name: 'Event' })).toBeTruthy();
    expect(window.location.hash).toBe('');
  });

  it('omits the journey for a past event', () => {
    render(<EventDetail event={{ ...lagos, period: 'past' }} contactEmail="c@x" />);
    expect(screen.queryByRole('region', { name: 'Your journey' })).toBeNull();
    expect(screen.getByText('Past')).toBeTruthy();
  });
});
