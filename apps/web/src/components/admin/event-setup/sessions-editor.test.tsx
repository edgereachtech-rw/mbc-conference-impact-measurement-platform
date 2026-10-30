import type { EventDetail } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionsEditor } from './sessions-editor';

const base: EventDetail = {
  id: 'e1',
  code: 'summit',
  slug: 'summit',
  name: 'Summit',
  description: 'd',
  eventType: 'summit',
  organiser: 'M.Bryan',
  format: 'hybrid',
  timezone: 'Africa/Lagos',
  theme: null,
  location: 'Lagos',
  website: null,
  imageUrl: null,
  additionalInfo: null,
  status: 'draft',
  startsOn: '2026-11-10',
  endsOn: '2026-11-12',
  dates: [
    { id: 'd1', date: '2026-11-10' },
    { id: 'd2', date: '2026-11-12' },
  ],
  sessions: [
    {
      id: 's1',
      eventDateId: 'd2',
      date: '2026-11-12',
      title: 'Opening keynote',
      sessionType: 'keynote',
      startTime: '09:00',
      endTime: '10:00',
      description: null,
      venue: 'Hall A',
      speaker: 'Dr A',
      capacity: 200,
      feedbackEnabled: true,
    },
  ],
  assessmentStages: [],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('SessionsEditor', () => {
  it('groups the schedule by every selected date, validates times, and posts a new session on a selected date', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ event: base }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<SessionsEditor event={base} onSaved={onSaved} />);
    const days = within(screen.getByRole('list', { name: 'Schedule' })).getAllByRole('listitem', {
      name: '',
    });
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Tuesday 10 November 2026')).toBeTruthy();
    expect(screen.getByText('No sessions on this date yet.', { exact: false })).toBeTruthy();
    expect(screen.getByText('Opening keynote')).toBeTruthy();
    expect(screen.getByText(/Dr A · Hall A · Capacity 200/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add session' }));
    const form = screen.getByRole('form', { name: 'New session' });
    await user.type(within(form).getByLabelText('Session title'), 'Workshop A');
    await user.selectOptions(within(form).getByLabelText('Session date'), '2026-11-10');
    const start = within(form).getByLabelText('Start time') as HTMLInputElement;
    const end = within(form).getByLabelText('End time') as HTMLInputElement;
    await user.clear(start);
    await user.type(start, '14:00');
    await user.clear(end);
    await user.type(end, '13:00');
    await user.click(within(form).getByRole('button', { name: 'Add session' }));
    expect(within(form).getByRole('alert').textContent).toMatch(/end time must be later/);
    expect(calls).toHaveLength(0);

    await user.clear(end);
    await user.type(end, '16:00');
    await user.type(within(form).getByLabelText('Capacity (optional)'), '30');
    await user.click(within(form).getByRole('button', { name: 'Add session' }));
    expect(calls[0]?.url).toBe('/api/v1/events/e1/sessions');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      title: 'Workshop A',
      date: '2026-11-10',
      startTime: '14:00',
      endTime: '16:00',
      sessionType: 'plenary',
      capacity: 30,
      feedbackEnabled: false,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('deletes after confirmation', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ event: { ...base, sessions: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const user = userEvent.setup();
    render(<SessionsEditor event={base} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Delete Opening keynote' }));
    expect(calls).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(calls[0]?.url).toBe('/api/v1/events/e1/sessions/s1');
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});
