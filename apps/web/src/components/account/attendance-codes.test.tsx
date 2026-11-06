import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceCodes } from './attendance-codes';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const attendance = {
  overall: 'pending',
  dates: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      date: '2026-11-12',
      daily: 'attended',
      closed: false,
      recordedAt: '2026-11-12T08:30:00.000Z',
      token: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      date: '2026-11-13',
      daily: 'not_checked_in',
      closed: false,
      recordedAt: null,
      token: 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210zyxwvu',
    },
  ],
  sessionsAttended: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Opening keynote',
      date: '2026-11-12',
    },
  ],
};

function stubAttendance() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toBe('/api/v1/me/events/e1/attendance');
      return new Response(JSON.stringify({ attendance }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('AttendanceCodes', () => {
  it('shows one day at a time: a tab per date, the open day first, and the code only for the chosen day', async () => {
    // Before the event: today is no event day, so the first day still open for check-in leads.
    vi.useFakeTimers({ now: new Date('2026-11-06T10:00:00Z'), toFake: ['Date'] });
    stubAttendance();
    render(<AttendanceCodes eventId="e1" timezone="Africa/Lagos" />);

    const tabs = await screen.findByRole('tablist', { name: 'Event days' });
    const dayTabs = within(tabs).getAllByRole('tab');
    expect(dayTabs.map((t) => t.textContent)).toEqual([
      'Day 1 · 12 Nov 2026Attended',
      'Day 2 · 13 Nov 2026Not checked in',
    ]);
    expect(dayTabs[1]!.getAttribute('aria-selected')).toBe('true');

    // Only the chosen day's code is on screen, so only one image exists.
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toMatch(/13 Nov 2026.*Not checked in/);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    const img = within(panel).getByRole('img', { name: 'Your check-in code for 13 Nov 2026' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(panel.textContent).toContain('ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210zyxwvu');
    expect(panel.textContent).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789ABCDEF');

    // Switching to the recorded day shows its status and no code.
    fireEvent.click(dayTabs[0]!);
    const recorded = screen.getByRole('tabpanel');
    expect(recorded.textContent).toMatch(/12 Nov 2026.*Attended.*Recorded by the organisers/);
    expect(within(recorded).queryByRole('img')).toBeNull();
    expect(recorded.textContent).toContain('abcdefghijklmnopqrstuvwxyz0123456789ABCDEF');

    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText(/Sessions recorded: Opening keynote \(12 Nov 2026\)/)).toBeTruthy();
  });

  it('opens on today when today is an event day, in the event timezone', async () => {
    // 23:30 UTC on 11 Nov is already 00:30 on 12 Nov in Lagos (UTC+1).
    vi.useFakeTimers({ now: new Date('2026-11-11T23:30:00Z'), toFake: ['Date'] });
    stubAttendance();
    render(<AttendanceCodes eventId="e1" timezone="Africa/Lagos" />);

    const tabs = await screen.findByRole('tablist', { name: 'Event days' });
    const dayTabs = within(tabs).getAllByRole('tab');
    expect(dayTabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(dayTabs[0]!.textContent).toBe('Day 1 · 12 Nov 2026Today');
    expect(screen.getByRole('tabpanel').textContent).toMatch(/12 Nov 2026Today/);
  });
});
