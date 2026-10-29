import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminOverview } from './admin-overview';

function stub(handlers: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const res = handlers[url.replace(/^\/api\/v1/, '')] ?? {
        status: 404,
        body: { error: { code: 'not_found', message: 'no stub', requestId: 'r' } },
      };
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AdminOverview', () => {
  it('lists events with their status and shows the release gates from the API', async () => {
    stub({
      '/events': {
        status: 200,
        body: {
          events: [
            {
              id: 'e1',
              slug: 'ittec',
              name: 'ITTEC 2026',
              startsOn: '2026-11-12',
              endsOn: '2026-11-13',
              timezone: 'Africa/Lagos',
              format: 'hybrid',
              status: 'active',
            },
            {
              id: 'e2',
              slug: 'old',
              name: 'Old Summit',
              startsOn: '2025-01-01',
              endsOn: '2025-01-02',
              timezone: 'Africa/Lagos',
              format: 'virtual',
              status: 'archived',
            },
          ],
        },
      },
      '/imports/status': {
        status: 200,
        body: {
          uploadsEnabled: true,
          productionGateRequired: false,
          migrationGatePassed: false,
          blockers: ['no durable migration.identity_backfill report exists'],
        },
      },
    });
    render(<AdminOverview />);
    const events = await screen.findByRole('list', { name: 'Events' });
    expect(within(events).getByText('ITTEC 2026')).toBeTruthy();
    expect(within(events).getByText('Active')).toBeTruthy();
    expect(within(events).getByText('Archived')).toBeTruthy();
    expect(within(events).getAllByRole('link', { name: 'Import registrations' })).toHaveLength(1); // not for archived
    const gates = screen.getByRole('list', { name: 'Release gates' });
    expect(within(gates).getByText(/no durable migration.identity_backfill report/)).toBeTruthy();
    expect(within(gates).getByText(/Production imports/)).toBeTruthy();
    expect(within(gates).getByText(/Disabled until the retention policy/)).toBeTruthy();
  });

  it('shows a safe error for a non-admin session', async () => {
    stub({
      '/events': {
        status: 403,
        body: { error: { code: 'forbidden', message: 'no', requestId: 'r1' } },
      },
      '/imports/status': {
        status: 403,
        body: { error: { code: 'forbidden', message: 'no', requestId: 'r1' } },
      },
    });
    render(<AdminOverview />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only M.Bryan admins/);
  });
});
