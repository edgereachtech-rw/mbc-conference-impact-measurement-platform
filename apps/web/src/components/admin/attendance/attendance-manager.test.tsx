import type { AttendanceOverview, AttendanceRow, EventDetail } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceManager } from './attendance-manager';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const DEE = '11111111-1111-4111-8111-111111111111';
const VEE = '22222222-2222-4222-8222-222222222222';
const WEE = '33333333-3333-4333-8333-333333333333';
const D1 = '44444444-4444-4444-8444-444444444444';
const D2 = '55555555-5555-4555-8555-555555555555';
const S1 = '66666666-6666-4666-8666-666666666666';

const event: EventDetail = {
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
  location: null,
  website: null,
  imageUrl: null,
  additionalInfo: null,
  status: 'active',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  dates: [
    { id: D1, date: '2026-11-12' },
    { id: D2, date: '2026-11-13' },
  ],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};

const counts = (over: Partial<AttendanceOverview['dates'][number]['counts']> = {}) => ({
  registered: 3,
  attended: 1,
  partial: 0,
  absent: 0,
  notCheckedIn: 2,
  physical: 1,
  virtual: 0,
  rate: 33.3,
  ...over,
});
const overview: AttendanceOverview = {
  dates: [
    { id: D1, date: '2026-11-12', closedAt: null, counts: counts() },
    {
      id: D2,
      date: '2026-11-13',
      closedAt: null,
      counts: counts({ attended: 0, notCheckedIn: 3, physical: 0, rate: 0 }),
    },
  ],
  overall: {
    registered: 3,
    attended: 0,
    partial: 0,
    absent: 0,
    pending: 3,
    attendees: 1,
    rate: 33.3,
  },
  sessions: [
    {
      id: S1,
      eventDateId: D1,
      date: '2026-11-12',
      title: 'Opening keynote',
      sessionType: 'keynote',
      startTime: '09:00',
      endTime: '10:00',
      attended: 0,
    },
  ],
  generatedAt: '2026-11-12T09:00:00.000Z',
};
const delegate = (id: string, name: string, attendanceFormat: 'physical' | 'virtual') => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  organisation: null,
  attendanceFormat,
  registrationStatus: 'active' as const,
});
const rows: AttendanceRow[] = [
  {
    delegate: delegate(DEE, 'Dee Legate', 'physical'),
    daily: 'attended',
    record: {
      id: 'r1',
      status: 'attended',
      mode: 'physical',
      method: 'qr',
      note: null,
      recordedAt: '2026-11-12T08:30:00.000Z',
      recordedBy: 'admin@example.com',
    },
  },
  { delegate: delegate(VEE, 'Vee Virtual', 'virtual'), daily: 'not_checked_in', record: null },
  { delegate: delegate(WEE, 'Wee Virtual', 'virtual'), daily: 'not_checked_in', record: null },
];

function stub() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/attendance')) return json({ overview });
      if (url.includes(`/attendance/dates/${D1}/bulk`)) {
        return json({ created: 2, skipped: [] }, 201);
      }
      if (url.includes(`/attendance/dates/${D1}/close`))
        return json({ closedAt: 'x', markedAbsent: 2 });
      if (url.includes(`/attendance/dates/${D1}/mark`))
        return json({ record: rows[0]!.record }, 201);
      if (url.includes(`/attendance/dates/${D1}`)) {
        const q = new URL(url, 'http://x').searchParams.get('q');
        return json({
          date: { id: D1, date: '2026-11-12', closedAt: null },
          counts: counts(),
          rows: q
            ? rows.filter((r) => r.delegate.name.toLowerCase().includes(q.toLowerCase()))
            : rows,
        });
      }
      if (url.endsWith('/attendance/scan')) {
        const body = JSON.parse(String(init?.body));
        if (body.token === 'wrong-date-code-0000') {
          return json(
            {
              error: {
                code: 'wrong_date',
                message: 'This code is for 2026-11-13, not the selected date.',
              },
            },
            409,
          );
        }
        return json({
          delegate: delegate(VEE, 'Vee Virtual', 'virtual'),
          date: { id: D1, date: '2026-11-12' },
          record: null,
        });
      }
      if (url.endsWith('/attendance/check-in'))
        return json(
          { delegate: delegate(VEE, 'Vee Virtual', 'virtual'), record: rows[0]!.record },
          201,
        );
      if (url.includes('/attendance/records/r1'))
        return json({ record: { ...rows[0]!.record, status: 'partial', method: 'correction' } });
      if (url.includes(`/attendance/sessions/${S1}`) && !init?.method) {
        return json({
          session: {
            id: S1,
            eventDateId: D1,
            date: '2026-11-12',
            title: 'Opening keynote',
            startTime: '09:00',
            endTime: '10:00',
          },
          rows: rows.map((r) => ({
            delegate: r.delegate,
            attended: r.delegate.id === DEE,
            recordedAt: null,
            recordedBy: null,
          })),
          counts: { registered: 3, attended: 1, rate: 33.3 },
        });
      }
      if (url.includes(`/attendance/sessions/${S1}`))
        return json({ added: 1, removed: 1, skipped: [] });
      return json({});
    }),
  );
  return calls;
}
const posts = (calls: Array<{ url: string; init?: RequestInit }>, path: string) =>
  calls
    .filter((c) => c.init?.method && c.url.includes(path))
    .map((c) => JSON.parse(String(c.init?.body)));

describe('AttendanceManager', () => {
  it('lists a date, checks in by code after the admin confirms, marks manually and in bulk, and closes the date', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<AttendanceManager event={event} />);
    const table = await screen.findByRole('table', { name: 'Delegates on 12 Nov 2026' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Dee Legate').closest('tr')!.textContent).toMatch(
      /AttendedQR check-in/,
    );
    expect(screen.getByText(/1 of 3 registered attended at least one day \(33\.3%\)/)).toBeTruthy();

    // Search narrows the list through the API.
    await user.type(screen.getByLabelText('Name, email or organisation'), 'vee');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(calls.some((c) => c.url.includes(`/attendance/dates/${D1}?q=vee`))).toBe(true);
    await user.clear(screen.getByLabelText('Name, email or organisation'));
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // QR: a code for another date is refused; a valid one shows the registration, nothing is
    // recorded until the admin confirms.
    await user.click(screen.getByRole('button', { name: 'Scan QR code' }));
    const scan = await screen.findByRole('dialog', { name: /Scan a code for 12 Nov 2026/ });
    await user.type(within(scan).getByLabelText('Code'), 'wrong-date-code-0000');
    await user.click(within(scan).getByRole('button', { name: 'Look up' }));
    expect((await within(scan).findByRole('alert')).textContent).toMatch(
      /for 2026-11-13, not the selected date/,
    );
    await user.clear(within(scan).getByLabelText('Code'));
    await user.type(within(scan).getByLabelText('Code'), 'valid-code-0000000000');
    await user.click(within(scan).getByRole('button', { name: 'Look up' }));
    expect((await within(scan).findByRole('status')).textContent).toMatch(
      /Vee Virtual.*vee@example.com.*Does the person match/,
    );
    expect(posts(calls, '/attendance/check-in')).toHaveLength(0);
    await user.click(within(scan).getByRole('button', { name: 'Confirm attendance' }));
    expect(posts(calls, '/attendance/check-in')).toEqual([
      { token: 'valid-code-0000000000', eventDateId: D1 },
    ]);
    expect((await screen.findByRole('status')).textContent).toMatch(/Vee Virtual checked in/);

    // Manual marking from the row, with a note.
    await user.click(screen.getByRole('button', { name: 'Mark attended: Wee Virtual' }));
    const mark = await screen.findByRole('dialog', { name: 'Record attendance: Wee Virtual' });
    await user.selectOptions(within(mark).getByLabelText('Attendance'), 'partial');
    await user.type(within(mark).getByLabelText('Note (optional)'), 'Afternoon only');
    await user.click(within(mark).getByRole('button', { name: 'Confirm attendance' }));
    expect(posts(calls, `/attendance/dates/${D1}/mark`)).toEqual([
      { delegateId: WEE, status: 'partial', note: 'Afternoon only' },
    ]);

    // Bulk: select everyone not checked in, review, save.
    await user.click(screen.getByLabelText('Select everyone not checked in on this page'));
    await user.click(screen.getByRole('button', { name: 'Mark selected as attended' }));
    const bulk = await screen.findByRole('dialog', { name: /Mark 2 delegates on 12 Nov 2026/ });
    expect(within(bulk).getByRole('list', { name: 'Selected delegates' }).textContent).toMatch(
      /Vee Virtual.*Wee Virtual/,
    );
    await user.click(within(bulk).getByRole('button', { name: 'Save attendance' }));
    expect(posts(calls, `/attendance/dates/${D1}/bulk`)).toEqual([
      { delegateIds: [VEE, WEE], status: 'attended' },
    ]);
    expect((await screen.findByRole('status')).textContent).toMatch(/2 recorded/);

    // Correction needs a reason.
    await user.click(screen.getByRole('button', { name: 'Correct: Dee Legate' }));
    const correct = await screen.findByRole('dialog', { name: 'Correct attendance: Dee Legate' });
    await user.selectOptions(within(correct).getByLabelText('Attendance'), 'partial');
    await user.click(within(correct).getByRole('button', { name: 'Save correction' }));
    expect(within(correct).getByRole('alert').textContent).toMatch(/reason/);
    await user.type(within(correct).getByLabelText('Reason'), 'Left at lunch');
    await user.click(within(correct).getByRole('button', { name: 'Save correction' }));
    expect(posts(calls, '/attendance/records/r1')).toEqual([
      { status: 'partial', mode: 'physical', reason: 'Left at lunch' },
    ]);

    // Closing the date, with absences.
    await user.click(screen.getByRole('button', { name: 'Close attendance for this date' }));
    const close = await screen.findByRole('dialog', { name: 'Close attendance for 12 Nov 2026' });
    expect(close.textContent).toMatch(/2 registered delegates have no attendance record/);
    await user.click(within(close).getByRole('button', { name: 'Close attendance' }));
    expect(posts(calls, `/attendance/dates/${D1}/close`)).toEqual([{ markAbsent: true }]);
    expect((await screen.findByRole('status')).textContent).toMatch(
      /Attendance closed; 2 marked absent/,
    );
  });

  it('records session attendance and asks for a reason when removing a presence', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<AttendanceManager event={event} />);
    await screen.findByRole('table', { name: 'Delegates on 12 Nov 2026' });
    await user.selectOptions(screen.getByLabelText('Session attendance'), S1);
    const dialog = await screen.findByRole('dialog', {
      name: 'Session attendance: Opening keynote',
    });
    await within(dialog).findByText('Dee Legate');
    await user.click(within(dialog).getByLabelText(/Dee Legate/));
    await user.click(within(dialog).getByLabelText(/Vee Virtual/));
    await user.click(within(dialog).getByRole('button', { name: 'Save session attendance' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/reason/);
    await user.type(
      within(dialog).getByLabelText(/Reason for removing 1 recorded presence/),
      'Scanned the wrong person',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save session attendance' }));
    expect(posts(calls, `/attendance/sessions/${S1}`)).toEqual([
      { add: [VEE], remove: [DEE], reason: 'Scanned the wrong person' },
    ]);
    expect((await screen.findByRole('status')).textContent).toMatch(/1 added, 1 removed/);
  });
});
