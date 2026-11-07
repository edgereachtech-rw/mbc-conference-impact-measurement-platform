import type { EventDetail, FeedbackSessionView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionQrCodes } from './action-qr-codes';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const D1 = '44444444-4444-4444-8444-444444444444';
const S1 = '66666666-6666-4666-8666-666666666666';
const S2 = '66666666-6666-4666-8666-666666666667';

const stage = (
  over: Partial<EventDetail['assessmentStages'][number]>,
): EventDetail['assessmentStages'][number] =>
  ({
    stage: 'end_of_conference',
    wave: 1,
    waveLabel: '',
    dueAfterDays: null,
    reminderAfterDays: null,
    reminderLimit: 0,
    enabled: true,
    opensAt: null,
    closesAt: null,
    target: 'all_delegates',
    targetGroup: null,
    status: 'scheduled',
    questionCount: 46,
    updatedAt: '2026-10-30T00:00:00Z',
    ...over,
  }) as EventDetail['assessmentStages'][number];

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
  countTestDelegates: false,
  startsOn: '2026-11-12',
  endsOn: '2026-11-12',
  dates: [{ id: D1, date: '2026-11-12' }],
  sessions: [],
  assessmentStages: [
    stage({}),
    stage({
      stage: 'follow_up',
      waveLabel: '30-day follow-up',
    }),
    // Disabled, or without questions: no code is issued for it.
    stage({ stage: 'pre_conference', enabled: false }),
    stage({
      stage: 'during_conference',
      questionCount: 0,
    }),
  ],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};

const session = (over: Partial<FeedbackSessionView>): FeedbackSessionView => ({
  id: S1,
  eventDateId: D1,
  date: '2026-11-12',
  title: 'Measuring transfer',
  sessionType: 'keynote',
  startTime: '09:00',
  endTime: '10:00',
  speaker: null,
  enabled: true,
  code: 'abc123def456',
  path: '/feedback/abc123def456',
  openedAt: null,
  closesAt: null,
  window: 'open',
  questions: [],
  attended: 0,
  submitted: 0,
  ...over,
});

describe('ActionQrCodes', () => {
  it('issues one code per action, each carrying a deep link on this origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/reflections')) {
          return json({
            dates: [
              {
                date: { id: D1, date: '2026-11-12' },
                activity: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', title: 'Day 1 reflection' },
              },
              {
                date: { id: '44444444-4444-4444-8444-444444444445', date: '2026-11-13' },
                activity: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', title: 'Day 2 reflection' },
              },
              {
                date: { id: '44444444-4444-4444-8444-444444444446', date: '2026-11-14' },
                activity: null,
              },
            ],
          });
        }
        expect(url).toBe('/api/v1/events/e1/feedback');
        return json({
          sessions: [
            session({}),
            session({ id: S2, title: 'No feedback here', enabled: false, code: null, path: null }),
          ],
        });
      }),
    );
    render(<ActionQrCodes event={event} />);
    const cards = await screen.findAllByRole('article');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Day 1 reflection',
      'Day 2 reflection',
      'Measuring transfer',
      'Transfer plan',
      'End-of-conference evaluation',
      '30-day follow-up',
    ]);
    const origin = window.location.origin;
    // Day 1 and day 2 carry different codes, each landing on its own tab (2026-11-07).
    expect(
      within(cards[0]!).getByText(
        `${origin}/go/e1/reflection-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`,
      ),
    ).toBeTruthy();
    expect(
      within(cards[1]!).getByText(
        `${origin}/go/e1/reflection-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2`,
      ),
    ).toBeTruthy();
    expect(within(cards[2]!).getByText(`${origin}/feedback/abc123def456`)).toBeTruthy();
    expect(within(cards[3]!).getByText(`${origin}/go/e1/transfer-plan`)).toBeTruthy();
    expect(
      within(cards[4]!).getByText(`${origin}/go/e1/assessment-end_of_conference-1`),
    ).toBeTruthy();
    expect(within(cards[5]!).getByText(`${origin}/go/e1/assessment-follow_up-1`)).toBeTruthy();
    // Each card renders its code as an image once generated, with a download of it.
    const image = await within(cards[0]!).findByRole('img', { name: 'QR code: Day 1 reflection' });
    expect(image.getAttribute('src')).toMatch(/^data:image\/png/);
    // The name of the code is its caption: it follows the image inside the card.
    const caption = within(cards[0]!).getByRole('heading', { name: 'Day 1 reflection' });
    expect(image.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(cards[0]!)
        .getByRole('link', { name: /Download PNG/ })
        .getAttribute('download'),
    ).toBe('day-1-reflection-qr.png');
    expect(screen.getByRole('button', { name: /Print all/ })).toBeTruthy();
  });
});
