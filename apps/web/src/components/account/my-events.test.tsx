import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelegateDashboard } from './delegate-dashboard';
import { MyEventsScreen } from './my-events';

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
} as const;
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
} as const;

afterEach(() => vi.unstubAllGlobals());

describe('MyEventsScreen', () => {
  it('shows upcoming and past events as card grids, each card linking to its page', async () => {
    stubEvents([{ status: 200, body: { events: [lagos, past] } }]);
    render(<MyEventsScreen contactEmail="conference@example.com" />);
    const upcoming = await screen.findByRole('list', { name: 'Upcoming events' });
    const card = within(upcoming).getByRole('article', { name: lagos.name });
    expect(within(card).getByText('Lagos Oriental Hotel')).toBeTruthy();
    expect(within(card).getByText('12-13 November 2026')).toBeTruthy();
    expect(within(card).getByText('In person')).toBeTruthy();
    expect(within(card).getByText('not recorded')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'View more' }).getAttribute('href')).toBe(
      '/account/events/e1',
    );
    const pastList = screen.getByRole('list', { name: 'Past events' });
    const pastCard = within(pastList).getByRole('article', { name: 'Past Summit' });
    expect(within(pastCard).getByText('Online event')).toBeTruthy(); // no location: the format is shown
    expect(screen.queryByText(/attended/i)).toBeNull();
  });

  it('uses the server-loaded list without fetching, and shows the empty state', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { unmount } = render(
      <MyEventsScreen initialEvents={[past]} contactEmail="conference@example.com" />,
    );
    expect(screen.getByRole('article', { name: 'Past Summit' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount();
    render(<MyEventsScreen initialEvents={[]} contactEmail="conference@example.com" />);
    expect(screen.getByText('No events yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'conference@example.com' })).toBeTruthy();
  });

  it('shows safe errors for an ended session and a server failure, and can retry', async () => {
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
    render(<MyEventsScreen contactEmail="c@example.com" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/session has ended/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: lagos.name })).toBeTruthy();
    vi.unstubAllGlobals();

    stubEvents([
      {
        status: 500,
        body: {
          error: { code: 'internal_error', message: 'TypeError at /srv/x', requestId: 'r9' },
        },
      },
    ]);
    const { unmount } = render(<MyEventsScreen contactEmail="c@example.com" />);
    const alerts = await screen.findAllByRole('alert');
    const alert = alerts[alerts.length - 1]!;
    expect(alert.textContent).toMatch(/could not load your events/);
    expect(alert.textContent).not.toMatch(/TypeError|srv/);
    expect(alert.textContent).toMatch(/r9/);
    unmount();
  });
});

describe('DelegateDashboard', () => {
  it('shows key figures and every event as a card, upcoming first, with View more buttons', () => {
    render(
      <DelegateDashboard contactEmail="conference@example.com" initialEvents={[past, lagos]} />,
    );
    const figures = screen.getByRole('region', { name: 'Key figures' });
    expect(figures.textContent).toMatch(/Next eventITTEC 2026/);
    expect(figures.textContent).toMatch(/Upcoming1/);
    expect(figures.textContent).toMatch(/Past1/);
    const grid = screen.getByRole('list', { name: 'Your events' });
    const cards = within(grid).getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([lagos.name, 'Past Summit']);
    expect(
      within(grid)
        .getAllByRole('link', { name: 'View more' })
        .map((l) => l.getAttribute('href')),
    ).toEqual(['/account/events/e1', '/account/events/e2']);
    expect(screen.getByRole('link', { name: 'All my events' }).getAttribute('href')).toBe(
      '/account/events',
    );
    expect(screen.queryByText(/attended/i)).toBeNull();
  });

  it('shows the empty state without figures claiming an event', () => {
    render(<DelegateDashboard contactEmail="c@example.com" initialEvents={[]} />);
    expect(screen.getByText('No events yet')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Key figures' }).textContent).toMatch(
      /none upcoming/,
    );
  });

  it('loads in the browser when the server could not, and shows a safe error', async () => {
    stubEvents([
      {
        status: 500,
        body: {
          error: { code: 'internal_error', message: 'TypeError at /srv/x', requestId: 'r9' },
        },
      },
    ]);
    render(<DelegateDashboard contactEmail="c@example.com" initialEvents={null} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not load your events/);
    expect(alert.textContent).not.toMatch(/srv/);
  });
});
