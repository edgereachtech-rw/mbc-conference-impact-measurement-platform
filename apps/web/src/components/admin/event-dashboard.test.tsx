import type { EventDashboard as Dashboard } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDashboard } from './event-dashboard';
import { makeReport } from './reports/report-fixture';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The event panels still come from the older per-event summary; the sections come from the report. */
const dashboard: Dashboard = {
  event: {
    id: 'e1',
    name: 'Summit',
    code: 'summit',
    status: 'active',
    format: 'hybrid',
    startsOn: '2026-11-12',
    endsOn: '2026-11-13',
    timezone: 'Africa/Lagos',
    days: 2,
    sessions: 5,
  },
  delegates: {
    registered: 40,
    signedUp: 10,
    invited: 38,
    physical: 25,
    virtual: 15,
    byStatus: { active: 40, pending: 2, cancelled: 1, duplicate: 0, test: 0 },
  },
  stages: [
    {
      stage: 'pre_conference',
      enabled: true,
      status: 'open',
      opensAt: '2026-11-01T08:00:00.000Z',
      closesAt: '2026-11-12T08:00:00.000Z',
      window: 'open',
      questions: 25,
      summary: null,
      nonCompleters: 32,
    },
    {
      stage: 'during_conference',
      enabled: true,
      status: 'scheduled',
      opensAt: '2026-11-12T08:00:00.000Z',
      closesAt: '2026-11-13T18:00:00.000Z',
      window: 'upcoming',
      questions: 0,
      summary: null,
      nonCompleters: 0,
    },
    {
      stage: 'end_of_conference',
      enabled: true,
      status: 'draft',
      opensAt: null,
      closesAt: null,
      window: 'hidden',
      questions: 10,
      summary: null,
      nonCompleters: 0,
    },
    {
      stage: 'follow_up',
      enabled: false,
      status: 'draft',
      opensAt: null,
      closesAt: null,
      window: 'hidden',
      questions: 0,
      summary: null,
      nonCompleters: 0,
    },
  ],
  attendance: {
    registered: 40,
    attended: 10,
    partial: 15,
    absent: 15,
    pending: 0,
    attendees: 25,
    rate: 62.5,
    dates: [],
  },
  messages: {
    sent: 3,
    recipients: 120,
    delivered: 118,
    failed: 2,
    last: {
      subject: 'Please complete your check-in',
      createdAt: '2026-11-04T09:00:00.000Z',
      status: 'sent',
    },
  },
  generatedAt: '2026-11-05T10:00:00.000Z',
};

function stub(dashboardStatus = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/reports/organisations')) return json({ organisations: [] });
      if (url.includes('/reports/')) return json({ report: makeReport() });
      if (dashboardStatus !== 200) {
        return json({ error: { code: 'forbidden', message: 'Admins only.' } }, dashboardStatus);
      }
      return json({ dashboard });
    }),
  );
  return calls;
}

describe('EventDashboard', () => {
  it('shows the reporting sections and, underneath, the event’s own panels', async () => {
    const calls = stub();
    render(<EventDashboard eventId="e1" timezone="Africa/Lagos" />);

    // The report: every section of the dashboard document.
    expect(await screen.findByRole('region', { name: 'Delegate participation' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Expectations and baseline' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Conference experience and learning' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Expectations assessed at the end' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Transfer Planning and application' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Expectations and results' })).toBeTruthy();
    expect(calls).toContain('/api/v1/events/e1/reports/dashboard');

    // The event's own panels: statuses, messages and a way into each stage.
    const statuses = await screen.findByLabelText('Registrations by status');
    expect(statuses.textContent).toMatch(/Active40Pending2Cancelled1Duplicate0Test0/);
    expect(
      screen.getByText(/cancelled, pending and duplicate registrations are excluded everywhere/),
    ).toBeTruthy();
    const messages = screen.getByLabelText('Messages');
    expect(messages.textContent).toMatch(/Messages sent3Recipients120Delivered118Failed2/);
    expect(screen.getByText(/Last: “Please complete your check-in”/)).toBeTruthy();
    const pre = screen.getByRole('article', { name: 'Pre-conference assessment' });
    expect(pre.textContent).toMatch(/Open to delegates/);
    expect(pre.textContent).toMatch(/25 questions/);
    expect(
      screen.getAllByRole('link', { name: 'Questions and submissions' })[0]!.getAttribute('href'),
    ).toBe('/admin/events/e1/assessments/pre_conference');
    const follow = screen.getByRole('article', { name: 'Follow-up assessment' });
    expect(follow.textContent).toMatch(/Disabled.*Not used for this event/);
    expect(calls).toContain('/api/v1/events/e1/dashboard');
  });

  it('still shows the report when the event panels fail', async () => {
    stub(403);
    render(<EventDashboard eventId="e1" timezone="Africa/Lagos" />);
    expect(await screen.findByRole('region', { name: 'Delegate participation' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toMatch(/admins/i);
    expect(screen.queryByLabelText('Messages')).toBeNull();
  });
});
