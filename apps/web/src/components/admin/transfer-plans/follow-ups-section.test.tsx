import type { EventDetail, FollowUpOverview } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FollowUpsSection } from './follow-ups-section';

const stage = (wave = 1, waveLabel = '', dueAfterDays: number | null = null) => ({
  stage: 'follow_up' as const,
  wave,
  waveLabel,
  dueAfterDays,
  reminderAfterDays: null,
  reminderLimit: 0,
  enabled: false,
  opensAt: null,
  closesAt: null,
  target: 'all_delegates' as const,
  targetGroup: null,
  status: 'draft' as const,
  questionCount: 1,
  updatedAt: '2026-10-30T00:00:00Z',
});
const event: EventDetail = {
  id: 'e1',
  code: 'summit',
  slug: 'summit',
  name: 'Summit',
  description: 'd',
  eventType: 'summit',
  organiser: 'M.Bryan',
  format: 'virtual',
  timezone: 'Africa/Lagos',
  theme: null,
  location: null,
  website: null,
  imageUrl: null,
  additionalInfo: null,
  status: 'draft',
  countTestDelegates: false,
  transferPlanVisibility: 'shown',
  transferPlanShownFrom: null,
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  dates: [{ id: 'd1', date: '2026-11-13' }],
  sessions: [],
  assessmentStages: [stage()],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};
const waved: EventDetail = {
  ...event,
  assessmentStages: [
    stage(1, '30-day follow-up', 30),
    stage(2, '60-day follow-up', 60),
    stage(3, '90-day follow-up', 90),
  ],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function stub(eventBack: EventDetail, overview: FollowUpOverview = { waves: [], rows: [] }) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      });
      if (url.endsWith('/follow-up-responses')) return json(overview);
      return json({ event: eventBack, waves: [], eligible: 0 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('FollowUpsSection', () => {
  it('offers the schedule while the follow-ups are missing, and keeps the old round as it is', async () => {
    const calls = stub(waved);
    const onSaved = vi.fn();
    render(<FollowUpsSection event={event} onSaved={onSaved} />);

    // The existing round keeps its plain name: it is not the 30-day follow-up.
    expect(screen.getByRole('form', { name: 'Post-conference follow-up' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: '30-day follow-up' })).toBeNull();
    expect(screen.getByText(/one follow-up round from before the schedule/)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /Create the 30, 60 and 90-day follow-ups/ }),
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/v1/events/e1/assessments/follow-ups');
    expect(post.body).toEqual({ waves: [1, 2, 3] });
    // The event is read again so the cards appear without a reload.
    expect(onSaved).toHaveBeenCalledWith(waved);
  });

  it('shows each follow-up by its own name, acts on that wave alone, and lists every delegate once', async () => {
    const overview: FollowUpOverview = {
      waves: [1, 2, 3].map((n) => ({
        id: `00000000-0000-4000-8000-00000000000${n}`,
        wave: n,
        label: `${n * 30}-day follow-up`,
        dueAfterDays: n * 30,
        enabled: true,
        status: 'scheduled',
        opensAt: '2026-11-13T23:00:00.000Z',
        closesAt: '2026-12-13T23:00:00.000Z',
        questions: 7,
        invited: 2,
        submitted: n === 1 ? 1 : 0,
        reminderAfterDays: null,
        reminderLimit: 0,
      })),
      rows: [
        {
          delegateId: '11111111-1111-4111-8111-111111111111',
          name: 'Ada',
          organisation: 'Zenith',
          responses: {
            '1': {
              state: 'submitted',
              submittedAt: '2026-11-20T10:00:00.000Z',
              updatedAt: '2026-11-20T10:00:00.000Z',
              statuses: 2,
            },
            '2': {
              state: 'started',
              submittedAt: null,
              updatedAt: '2026-12-15T10:00:00.000Z',
              statuses: 0,
            },
          },
        },
        {
          delegateId: '11111111-1111-4111-8111-222222222222',
          name: 'Bo',
          organisation: null,
          responses: {},
        },
      ],
    };
    const calls = stub(waved, overview);
    render(<FollowUpsSection event={waved} onSaved={vi.fn()} />);

    // No schedule offer for the three; the longer-term one is still offered.
    expect(screen.queryByRole('button', { name: /30, 60 and 90-day follow-ups/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Add the longer-term follow-up/ })).toBeTruthy();
    // Three cards, three names: not "Post-conference follow-up" three times over.
    for (const label of ['30-day follow-up', '60-day follow-up', '90-day follow-up']) {
      expect(screen.getByRole('form', { name: label })).toBeTruthy();
    }
    const sixty = screen.getByRole('form', { name: '60-day follow-up' });
    expect(
      within(sixty).getByRole('link', { name: 'Questions and submissions' }).getAttribute('href'),
    ).toBe('/admin/events/e1/assessments/follow_up?wave=2');

    // Every delegate once, one column per follow-up, with where each stands.
    const table = await screen.findByRole('table', { name: 'Follow-up responses by delegate' });
    const ada = within(table).getByRole('row', { name: /Ada/ });
    expect(ada.textContent).toMatch(/Submitted/);
    expect(ada.textContent).toMatch(/2 action statuses/);
    expect(ada.textContent).toMatch(/Started/);
    const bo = within(table).getByRole('row', { name: /Bo/ });
    expect(bo.textContent?.match(/Not answered/g)).toHaveLength(3);
    expect(screen.getByText(/1 of 2 submitted/)).toBeTruthy();

    // Saving the 60-day card addresses wave 2, so enabling one wave never enables another.
    const user = userEvent.setup();
    await user.click(within(sixty).getByRole('button', { name: 'Save stage' }));
    expect(calls.some((c) => c.url.endsWith('/assessments/follow_up?wave=2'))).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/assessments/follow_up?wave=1'))).toBe(false);
  });
});
