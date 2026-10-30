import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceCodes } from './attendance-codes';

afterEach(() => vi.unstubAllGlobals());

describe('AttendanceCodes', () => {
  it('shows one QR code per open date, the recorded status, and the sessions recorded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('/api/v1/me/events/e1/attendance');
        return new Response(
          JSON.stringify({
            attendance: {
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
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    render(<AttendanceCodes eventId="e1" />);
    const list = await screen.findByRole('list', { name: 'Your attendance codes' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // The recorded day shows its status and no code; the open day shows the code image.
    expect(items[0]!.textContent).toMatch(/12 Nov 2026.*Attended.*Recorded by the organisers/);
    expect(within(items[0]!).queryByRole('img')).toBeNull();
    expect(items[1]!.textContent).toMatch(/13 Nov 2026.*Not checked in/);
    const img = within(items[1]!).getByRole('img', { name: 'Your check-in code for 13 Nov 2026' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(items[1]!.textContent).toContain('ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210zyxwvu');
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText(/Sessions recorded: Opening keynote \(12 Nov 2026\)/)).toBeTruthy();
  });
});
