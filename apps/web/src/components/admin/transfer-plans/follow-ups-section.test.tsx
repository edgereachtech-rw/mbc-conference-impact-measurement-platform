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

function stub(
  eventBack: EventDetail,
  overview: FollowUpOverview = { waves: [], rows: [], eligible: 0 },
) {
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
      if (/\/follow-ups\/\d+\/(invitations|reminders)$/.test(url)) {
        return json({ sent: 2, failed: 0, skipped: 0, waves: [], eligible: 0 });
      }
      if (/\/follow-ups\/\d+\/(schedule|close|reopen)$/.test(url)) {
        return json({ waves: [], eligible: 0 });
      }
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

    // The offer is there while the three follow-ups are missing.
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

  it('shows one card per follow-up with its state, sends or schedules from it, and lists every delegate once', async () => {
    const wave = (n: number, extra: Partial<FollowUpOverview['waves'][number]> = {}) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      wave: n,
      label: n === 4 ? 'Longer-term follow-up' : `${n * 30}-day follow-up`,
      dueAfterDays: n === 4 ? 180 : n * 30,
      enabled: false,
      status: 'draft',
      opensAt: '2026-11-13T23:00:00.000Z',
      closesAt: null,
      questions: 7,
      invited: 0,
      submitted: 0,
      reminderAfterDays: null,
      reminderLimit: 0,
      inviteAt: null,
      invitesSentAt: null,
      ...extra,
    });
    const overview: FollowUpOverview = {
      eligible: 24,
      waves: [
        wave(1, {
          enabled: true,
          status: 'open',
          invited: 22,
          submitted: 9,
          invitesSentAt: '2026-11-13T23:00:00.000Z',
        }),
        wave(2, { inviteAt: '2026-12-13T23:00:00.000Z' }),
        wave(3),
        wave(4, { questions: 0 }),
      ],
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

    // Sent and open: who has answered, who to remind, who is new.
    const thirty = await screen.findByRole('region', { name: '30-day follow-up' });
    expect(thirty.textContent).toMatch(/Open to delegates · sent/);
    expect(thirty.textContent).toMatch(/22 invited · 9 submitted · 13 have not answered/);
    expect(
      within(thirty).getByRole('button', { name: 'Send the invitation to 2 new delegates' }),
    ).toBeTruthy();
    expect(within(thirty).getByRole('button', { name: 'Close to delegates' })).toBeTruthy();
    expect(within(thirty).getByRole('link', { name: 'Edit questions' }).getAttribute('href')).toBe(
      '/admin/events/e1/assessments/follow_up?wave=1',
    );
    // None of the removed settings is on a card.
    expect(within(thirty).queryByLabelText('Enabled for this event')).toBeNull();
    expect(within(thirty).queryByLabelText('Available from')).toBeNull();
    expect(within(thirty).queryByLabelText('Status')).toBeNull();

    // Scheduled: change or clear the time, or send now.
    const sixty = screen.getByRole('region', { name: '60-day follow-up' });
    expect(sixty.textContent).toMatch(/Sends automatically on/);
    expect(within(sixty).getByRole('button', { name: 'Change the time' })).toBeTruthy();
    expect(within(sixty).getByRole('button', { name: 'Clear' })).toBeTruthy();

    // Not sent, ready: schedule it. The time is entered in the event's zone, stored as an instant.
    const ninety = screen.getByRole('region', { name: '90-day follow-up' });
    expect(ninety.textContent).toMatch(/Not sent yet/);
    const user = userEvent.setup();
    await user.click(within(ninety).getByRole('button', { name: 'Schedule the sending' }));
    const when = within(ninety).getByLabelText(/Send the invitation automatically on/);
    await user.clear(when);
    await user.type(when, '2027-01-13T09:00');
    await user.click(within(ninety).getByRole('button', { name: 'Save time' }));
    const scheduled = calls.find(
      (c) => c.method === 'PUT' && c.url.endsWith('/assessments/follow-ups/3/schedule'),
    );
    expect(scheduled?.body).toEqual({ inviteAt: '2027-01-13T08:00:00.000Z' });
    expect((await screen.findByRole('status')).textContent).toMatch(
      /90-day follow-up will be sent on/,
    );

    // No questions: nothing can be sent yet.
    const longer = screen.getByRole('region', { name: 'Longer-term follow-up' });
    expect(longer.textContent).toMatch(/Still being prepared/);
    expect(longer.textContent).toMatch(/Add questions before sending/);
    expect(
      (within(longer).getByRole('button', { name: 'Send the invitation now' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Reminding from the sent card posts to that wave alone.
    await user.click(
      within(thirty).getByRole('button', { name: /Remind the 13 who have not answered/ }),
    );
    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/assessments/follow-ups/1/reminders'),
      ),
    ).toBe(true);

    // Every delegate once, one column per follow-up.
    const table = screen.getByRole('table', { name: 'Follow-up responses by delegate' });
    const ada = within(table).getByRole('row', { name: /Ada/ });
    expect(ada.textContent).toMatch(/Submitted/);
    expect(ada.textContent).toMatch(/2 action statuses/);
    const bo = within(table).getByRole('row', { name: /Bo/ });
    expect(bo.textContent).toMatch(/Not answered/);
    expect(bo.textContent?.match(/Not sent yet/g)?.length).toBe(3);
  });
});
