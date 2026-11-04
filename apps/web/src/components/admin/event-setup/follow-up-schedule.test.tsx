import { DEFAULT_FOLLOW_UP_WAVES, LONGER_TERM_WAVE, type EventDetail } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FollowUpSchedule } from './follow-up-schedule';

const wave = (n: number, dueAfterDays: number | null) => ({
  stage: 'follow_up' as const,
  wave: n,
  waveLabel: '',
  dueAfterDays,
  reminderAfterDays: null,
  reminderLimit: 0,
  enabled: false,
  opensAt: null,
  closesAt: null,
  target: 'all_delegates' as const,
  targetGroup: null,
  status: 'draft' as const,
  questionCount: 0,
  updatedAt: '2026-11-04T00:00:00Z',
});

const eventWith = (stages: EventDetail['assessmentStages']): EventDetail => ({
  id: 'e1',
  code: 'ittec',
  slug: 'ittec',
  name: 'ITTEC',
  description: 'd',
  eventType: 'conference',
  organiser: 'M.Bryan',
  format: 'hybrid',
  timezone: 'Africa/Lagos',
  theme: null,
  location: null,
  website: null,
  imageUrl: null,
  additionalInfo: null,
  status: 'active',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  dates: [{ id: 'd1', date: '2026-11-13' }],
  sessions: [],
  assessmentStages: stages,
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
});

const defaults = [...DEFAULT_FOLLOW_UP_WAVES].map((n) => wave(n, n * 30));

function stubFetch(calls: Array<{ url: string; body: unknown }>, event: EventDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify({ event }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('FollowUpSchedule', () => {
  it('offers the longer-term wave once the three defaults exist, with its date and who it reaches', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const event = eventWith(defaults);
    stubFetch(calls, event);
    render(<FollowUpSchedule event={event} onSaved={() => {}} />);

    // The default schedule is done, so only the longer-term offer is left.
    expect(screen.queryByRole('button', { name: /30, 60 and 90-day waves/ })).toBeNull();
    // 13 November 2026 + 180 days.
    expect(screen.getByText(/12 May 2027/)).toBeTruthy();
    // The selectivity of requirement 11.5 is not built, so the card says so rather than implying it.
    expect(screen.getByRole('note').textContent).toMatch(/every delegate/i);

    await userEvent.click(screen.getByRole('button', { name: /Add the longer-term follow-up/ }));
    expect(calls[0]?.url).toMatch(/\/assessments\/follow-ups$/);
    expect(calls[0]?.body).toEqual({ waves: [LONGER_TERM_WAVE] });
  });

  it('offers both when nothing is scheduled, and each asks for its own waves', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const event = eventWith([]);
    stubFetch(calls, event);
    render(<FollowUpSchedule event={event} onSaved={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /30, 60 and 90-day waves/ }));
    expect(calls[0]?.body).toEqual({ waves: [...DEFAULT_FOLLOW_UP_WAVES] });
  });

  it('disappears once every wave exists', () => {
    const event = eventWith([...defaults, wave(LONGER_TERM_WAVE, 180)]);
    const { container } = render(<FollowUpSchedule event={event} onSaved={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('still offers the longer-term wave for an event that only has the old single round', () => {
    const event = eventWith([wave(1, null)]);
    render(<FollowUpSchedule event={event} onSaved={() => {}} />);
    expect(screen.getByText(/one follow-up round from before the schedule existed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add the longer-term follow-up/ })).toBeTruthy();
  });
});
