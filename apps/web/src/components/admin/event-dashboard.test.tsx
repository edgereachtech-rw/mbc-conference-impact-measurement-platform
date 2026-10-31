import type { EventDashboard as Dashboard } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDashboard } from './event-dashboard';

afterEach(() => vi.unstubAllGlobals());

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
      summary: {
        stage: 'pre_conference',
        invited: 40,
        started: 12,
        submitted: 8,
        responseRate: 20,
        knowledge: { questions: 5, respondents: 8, averageScore: 2.5, averagePercent: 50 },
        distributions: [],
      },
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
    attended: 20,
    partial: 5,
    absent: 3,
    pending: 12,
    attendees: 25,
    rate: 62.5,
    dates: [
      {
        id: 'd1',
        date: '2026-11-12',
        closedAt: '2026-11-12T20:00:00.000Z',
        counts: {
          registered: 40,
          attended: 24,
          partial: 1,
          absent: 15,
          notCheckedIn: 0,
          physical: 20,
          virtual: 5,
          rate: 62.5,
        },
      },
    ],
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

describe('EventDashboard', () => {
  it('shows delegates, every stage with its counts, registrations by status and messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('/api/v1/events/e1/dashboard');
        return new Response(JSON.stringify({ dashboard }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    render(<EventDashboard eventId="e1" timezone="Africa/Lagos" />);
    const delegates = await screen.findByRole('region', { name: 'Delegates' });
    expect(delegates.textContent).toMatch(/Registered delegates40.*10 signed up \(25%\)/);
    expect(delegates.textContent).toMatch(/Invited38.*95% of registered/);
    expect(delegates.textContent).toMatch(/In person · Online25 · 15/);
    expect(delegates.textContent).toMatch(/Sessions5.*2 event days/);

    const attendance = screen.getByRole('region', { name: 'Attendance' });
    expect(attendance.textContent).toMatch(/Attended at least one day25.*62\.5% of 40 registered/);
    expect(screen.getByLabelText('Attendance by date').textContent).toMatch(
      /12 Nov 2026 · closed25 of 40 attended \(62\.5%\) · 20 in person · 5 online · 15 absent/,
    );
    const pre = screen.getByRole('article', { name: 'Pre-conference assessment' });
    expect(pre.textContent).toMatch(/Open to delegates/);
    expect(pre.textContent).toMatch(/25 questions/);
    const counts = within(pre).getByLabelText('Responses: Pre-conference assessment');
    expect(counts.textContent).toMatch(/Invited40Started12Submitted8 \(20%\)/);
    expect(counts.textContent).toMatch(
      /Knowledge: average 2\.5 of 5 \(50%\) from 8\. 32 not yet submitted\./,
    );
    expect(
      within(pre).getByRole('link', { name: 'Questions and submissions' }).getAttribute('href'),
    ).toBe('/admin/events/e1/assessments/pre_conference');

    const during = screen.getByRole('article', { name: 'During-conference assessment' });
    expect(during.textContent).toMatch(/Opens later/);
    expect(during.textContent).toMatch(/No questions yet/);
    const follow = screen.getByRole('article', { name: 'Follow-up assessment' });
    expect(follow.textContent).toMatch(/Disabled.*Not used for this event/);

    const statuses = screen.getByLabelText('Registrations by status');
    expect(statuses.textContent).toMatch(/Active40Pending2Cancelled1Duplicate0Test0/);
    const messages = screen.getByLabelText('Messages');
    expect(messages.textContent).toMatch(/Messages sent3Recipients120Delivered118Failed2/);
    expect(screen.getByText(/Last: “Please complete your check-in”/)).toBeTruthy();
    expect(screen.getByText(/Figures as of 5 Nov 2026/)).toBeTruthy();
  });

  it('shows the error state with a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Admins only.' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    render(<EventDashboard eventId="e1" timezone="Africa/Lagos" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/admins/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
