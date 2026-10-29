import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventsList } from './events-list';

function stub(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('EventsList', () => {
  it('lists events with dates, format and status, each linking to its own page', async () => {
    stub(200, {
      events: [
        {
          id: 'e1',
          slug: 'a',
          name: 'ITTEC 2026',
          startsOn: '2026-11-12',
          endsOn: '2026-11-13',
          timezone: 'Africa/Lagos',
          format: 'hybrid',
          status: 'active',
        },
        {
          id: 'e2',
          slug: 'b',
          name: 'Old Summit',
          startsOn: '2025-01-01',
          endsOn: '2025-01-02',
          timezone: 'Africa/Lagos',
          format: 'virtual',
          status: 'archived',
        },
      ],
    });
    render(<EventsList />);
    const table = await screen.findByRole('table', { name: 'Events' });
    expect(within(table).getByRole('link', { name: 'ITTEC 2026' }).getAttribute('href')).toBe(
      '/admin/events/e1',
    );
    expect(within(table).getAllByRole('link', { name: 'View details →' })).toHaveLength(2);
    expect(within(table).getByText('Hybrid')).toBeTruthy();
    expect(within(table).getByText('Archived')).toBeTruthy();
  });

  it('shows the empty and error states', async () => {
    stub(200, { events: [] });
    const { unmount } = render(<EventsList />);
    expect(await screen.findByText(/No events exist yet/)).toBeTruthy();
    unmount();
    vi.unstubAllGlobals();
    stub(403, { error: { code: 'forbidden', message: 'no', requestId: 'r1' } });
    render(<EventsList />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only M.Bryan admins/);
  });
});
