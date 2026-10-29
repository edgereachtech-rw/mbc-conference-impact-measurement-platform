import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminOverview } from './admin-overview';

function stub(handlers: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const res = handlers[url.replace(/^\/api\/v1/, '')] ?? {
        status: 404,
        body: { error: { code: 'not_found', message: `no stub for ${url}`, requestId: 'r' } },
      };
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

const EVENTS = [
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
];
const COUNTS = {
  total: 10,
  accepted: 7,
  updated: 1,
  unchanged: 0,
  linked: 0,
  duplicateInFile: 0,
  rejected: 0,
  conflict: 2,
  possibleDuplicate: 0,
};
const RUNS = [
  {
    id: 'r1',
    eventId: 'e1',
    actorUserId: 'u',
    source: 'eventbrite',
    fileName: 'reg.csv',
    fileSizeBytes: 1,
    rowCount: 10,
    status: 'committed',
    counts: COUNTS,
    previewExpiresAt: null,
    committedAt: '2026-10-30T11:00:00Z',
    createdAt: '2026-10-30T10:00:00Z',
    updatedAt: '2026-10-30T11:00:00Z',
  },
  {
    id: 'r2',
    eventId: 'e1',
    actorUserId: 'u',
    source: 'eventbrite',
    fileName: 'draft.xlsx',
    fileSizeBytes: 1,
    rowCount: 3,
    status: 'previewed',
    counts: null,
    previewExpiresAt: null,
    committedAt: null,
    createdAt: '2026-10-30T12:00:00Z',
    updatedAt: '2026-10-30T12:00:00Z',
  },
];

afterEach(() => vi.unstubAllGlobals());

describe('AdminOverview', () => {
  it('shows KPIs, the events table, recent imports and the release gates from the API', async () => {
    stub({
      '/events': { status: 200, body: { events: EVENTS } },
      '/imports/status': {
        status: 200,
        body: {
          uploadsEnabled: true,
          productionGateRequired: false,
          migrationGatePassed: false,
          blockers: ['no durable migration.identity_backfill report exists'],
        },
      },
      '/events/e1/imports': { status: 200, body: { runs: RUNS } },
    });
    render(<AdminOverview />);
    const figures = await screen.findByRole('region', { name: 'Key figures' });
    expect(figures.textContent).toMatch(/Events2/);
    expect(figures.textContent).toMatch(/Imports committed1/);
    expect(figures.textContent).toMatch(/Conflicts quarantined2/);
    expect(figures.textContent).toMatch(/UploadsOn/);

    const events = screen.getByRole('table', { name: 'Events' });
    expect(within(events).getByText('ITTEC 2026')).toBeTruthy();
    expect(within(events).getByText('Active')).toBeTruthy();
    expect(within(events).getByText('Archived')).toBeTruthy();
    expect(within(events).getAllByRole('link', { name: 'Open event' })).toHaveLength(2);
    expect(
      within(events).getAllByRole('link', { name: 'Open event' })[0]?.getAttribute('href'),
    ).toBe('/admin/events/e1');

    const recent = screen.getByRole('table', { name: 'Recent imports' });
    expect(within(recent).getByText('reg.csv')).toBeTruthy();
    expect(within(recent).getByText('Committed')).toBeTruthy();
    expect(within(recent).getByText('Previewed, not confirmed')).toBeTruthy();

    const gates = screen.getByRole('list', { name: 'Release gates' });
    expect(within(gates).getByText(/no durable migration.identity_backfill report/)).toBeTruthy();
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
