import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MyEvents } from './my-events';

function stubEvents(responses: Array<{ status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = responses.shift() ?? {
        status: 500,
        body: { error: { code: 'x', message: 'x', requestId: 'r' } },
      };
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

const lagos = {
  id: 'e1',
  slug: 'ittec-2026',
  name: 'ITTEC 2026',
  theme: 'Technology, Practice, and Impact',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  timezone: 'Africa/Lagos',
  location: 'Lagos Oriental Hotel',
  format: 'hybrid',
  period: 'upcoming',
  registration: {
    id: 'd1',
    status: 'valid',
    attendanceFormat: 'physical',
    capacity: 'individual',
    organisation: 'Acme',
    jobTitle: null,
    country: null,
    signedUpAt: null,
  },
  attendance: { status: 'not_recorded' },
};
const past = {
  ...lagos,
  id: 'e2',
  slug: 'past',
  name: 'Past Summit',
  startsOn: '2025-09-10',
  endsOn: '2025-09-11',
  period: 'past',
  location: null,
  format: 'virtual',
  registration: {
    ...lagos.registration,
    id: 'd2',
    attendanceFormat: 'virtual',
    organisation: null,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('MyEvents', () => {
  it('groups upcoming and past events and shows registration and "not recorded" attendance separately', async () => {
    stubEvents([{ status: 200, body: { events: [lagos, past] } }]);
    render(<MyEvents contactEmail="conference@example.com" />);
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' });
    expect(within(upcoming).getByRole('article', { name: 'ITTEC 2026' })).toBeTruthy();
    expect(within(upcoming).getByText('Lagos Oriental Hotel')).toBeTruthy();
    expect(within(upcoming).getByText('Registered')).toBeTruthy();
    expect(within(upcoming).getByText('Not recorded')).toBeTruthy();
    expect(within(upcoming).getByText('Physical')).toBeTruthy();
    const pastGroup = screen.getByRole('region', { name: 'Past events' });
    expect(within(pastGroup).getByRole('article', { name: 'Past Summit' })).toBeTruthy();
    expect(within(pastGroup).getByText('Online')).toBeTruthy(); // no location: the format is shown
    expect(screen.queryByText(/attended/i)).toBeNull();
  });

  it('shows an empty state with the contact address when nothing is linked', async () => {
    stubEvents([{ status: 200, body: { events: [] } }]);
    render(<MyEvents contactEmail="conference@example.com" />);
    expect(await screen.findByText('No events yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'conference@example.com' })).toBeTruthy();
  });

  it('shows safe errors for an ended session, a staff account and a server failure, and can retry', async () => {
    stubEvents([
      {
        status: 401,
        body: {
          error: { code: 'unauthenticated', message: 'Sign in to continue.', requestId: 'r1' },
        },
      },
      { status: 200, body: { events: [lagos] } },
    ]);
    const user = userEvent.setup();
    render(<MyEvents contactEmail="c@example.com" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/session has ended/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'ITTEC 2026' })).toBeTruthy();
    vi.unstubAllGlobals();

    stubEvents([
      {
        status: 500,
        body: {
          error: { code: 'internal_error', message: 'TypeError at /srv/x', requestId: 'r9' },
        },
      },
    ]);
    const { unmount } = render(<MyEvents contactEmail="c@example.com" />);
    const alerts = await screen.findAllByRole('alert');
    const alert = alerts[alerts.length - 1]!;
    expect(alert.textContent).toMatch(/could not load your events/);
    expect(alert.textContent).not.toMatch(/TypeError|srv/);
    expect(alert.textContent).toMatch(/r9/);
    unmount();
  });
});
