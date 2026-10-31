import type { EventDetail, FeedbackDashboard, FeedbackSessionView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeedbackManager } from './feedback-manager';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const S1 = '66666666-6666-4666-8666-666666666666';
const D1 = '44444444-4444-4444-8444-444444444444';
const Q1 = '11111111-1111-4111-8111-111111111111';
const Q4 = '44444444-4444-4444-8444-444444444445';

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
  endsOn: '2026-11-12',
  dates: [{ id: D1, date: '2026-11-12' }],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};
const disabled: FeedbackSessionView = {
  id: S1,
  eventDateId: D1,
  date: '2026-11-12',
  title: 'Measuring transfer',
  sessionType: 'keynote',
  startTime: '09:00',
  endTime: '10:00',
  speaker: 'Dr A. Speaker',
  enabled: false,
  code: null,
  path: null,
  openedAt: null,
  closesAt: null,
  window: 'disabled',
  questions: [],
  attended: 2,
  submitted: 0,
};
const enabled: FeedbackSessionView = {
  ...disabled,
  enabled: true,
  code: 'abc123def456',
  path: '/feedback/abc123def456',
  closesAt: '2026-11-12T22:59:00.000Z',
  window: 'open',
  questions: [
    {
      id: Q1,
      questionKey: Q1,
      version: 1,
      order: 1,
      prompt: 'How would you rate the relevance of this session to your work?',
      type: 'rating',
      required: true,
      responseCount: 2,
    },
    {
      id: Q4,
      questionKey: Q4,
      version: 1,
      order: 4,
      prompt: 'What was your main takeaway from this session?',
      type: 'long_text',
      required: false,
      responseCount: 1,
    },
  ],
  submitted: 2,
};
const dashboard: FeedbackDashboard = {
  event: { id: 'e1', name: 'Summit' },
  session: enabled,
  distributions: [
    {
      questionId: Q1,
      prompt: enabled.questions[0]!.prompt,
      total: 20,
      ratings: [
        { rating: 'excellent', count: 15, percent: 75 },
        { rating: 'good', count: 3, percent: 15 },
        { rating: 'fair', count: 2, percent: 10 },
        { rating: 'poor', count: 0, percent: 0 },
      ],
    },
  ],
  written: [
    {
      questionId: Q4,
      prompt: enabled.questions[1]!.prompt,
      responses: [
        {
          delegate: { id: 'd1', name: 'Dee Legate' },
          value: 'Measure first.',
          submittedAt: '2026-11-12T09:10:00.000Z',
        },
      ],
    },
  ],
  anonymised: false,
  generatedAt: '2026-11-12T10:00:00.000Z',
};

describe('FeedbackManager', () => {
  it('enables a session with the default questionnaire, shows the link, starts the period and opens the dashboard with percentages', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let session = disabled;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/feedback') && !init?.method) return json({ sessions: [session] });
        if (url.endsWith(`/feedback/sessions/${S1}`) && init?.method === 'PATCH') {
          session = enabled;
          return json({ session });
        }
        if (url.endsWith('/open')) {
          session = { ...enabled, openedAt: '2026-11-12T09:02:00.000Z' };
          return json({ session });
        }
        if (url.includes('/dashboard')) {
          const anonymised = url.includes('anonymised=true');
          return json({
            dashboard: {
              ...dashboard,
              anonymised,
              written: dashboard.written.map((w) => ({
                ...w,
                responses: w.responses.map((r) => ({
                  ...r,
                  delegate: anonymised ? null : r.delegate,
                })),
              })),
            },
          });
        }
        return json({});
      }),
    );
    const user = userEvent.setup();
    render(<FeedbackManager event={event} />);
    const card = await screen.findByRole('article', { name: 'Feedback: Measuring transfer' });
    expect(card.textContent).toMatch(/12 Nov 2026 09:00-10:00 · Dr A\. Speaker/);
    expect(within(card).getByText('Disabled')).toBeTruthy();

    await user.type(within(card).getByLabelText(/Deadline/), '2026-11-12T23:59');
    await user.click(within(card).getByRole('button', { name: 'Enable feedback' }));
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      enabled: true,
      closesAt: '2026-11-12T22:59:00.000Z',
    });
    expect((await screen.findByRole('status')).textContent).toMatch(/Feedback enabled/);
    const enabledCard = await screen.findByRole('article', {
      name: 'Feedback: Measuring transfer',
    });
    expect(within(enabledCard).getByText('Open')).toBeTruthy();
    expect(
      within(enabledCard).getByRole('list', { name: 'Questions: Measuring transfer' }).textContent,
    ).toMatch(
      /1\. How would you rate the relevance.*Rating.*Required.*2 answers.*2\. What was your main takeaway.*Written answer.*Optional/,
    );

    await user.click(within(enabledCard).getByRole('button', { name: 'Link and QR code' }));
    const link = await screen.findByRole('dialog', { name: 'Feedback link: Measuring transfer' });
    expect(link.textContent).toContain('/feedback/abc123def456');
    expect(
      await within(link).findByRole('img', { name: 'QR code for Measuring transfer feedback' }),
    ).toBeTruthy();
    await user.click(within(link).getByRole('button', { name: 'Close' }));

    await user.click(
      within(enabledCard).getByRole('button', { name: 'Start the 5-minute period' }),
    );
    expect(calls.some((c) => c.url.endsWith('/open') && c.init?.method === 'POST')).toBe(true);
    expect((await screen.findByRole('status')).textContent).toMatch(
      /5-minute feedback period started/,
    );

    await user.click(screen.getByRole('button', { name: 'Dashboard (2)' }));
    const dash = await screen.findByRole('dialog', { name: 'Feedback: Measuring transfer' });
    const relevance = await within(dash).findByRole('region', {
      name: enabled.questions[0]!.prompt,
    });
    expect(relevance.textContent).toMatch(/Excellent1575%Good315%Fair210%Poor00%Total20100%/);
    const written = within(dash).getByRole('region', { name: enabled.questions[1]!.prompt });
    expect(written.textContent).toMatch(/Measure first\.Dee Legate/);
    expect(
      within(dash)
        .getByRole('link', { name: /Export CSV/ })
        .getAttribute('href'),
    ).toBe(`/api/v1/events/e1/feedback/sessions/${S1}/export.csv`);
    await user.click(within(dash).getByLabelText(/Speaker view/));
    const anonymised = await within(dash).findByRole('region', {
      name: enabled.questions[1]!.prompt,
    });
    expect(anonymised.textContent).toContain('Measure first.');
    expect(anonymised.textContent).not.toContain('Dee Legate');
    expect(
      within(dash)
        .getByRole('link', { name: /Export anonymised CSV/ })
        .getAttribute('href'),
    ).toBe(`/api/v1/events/e1/feedback/sessions/${S1}/export.csv?anonymised=true`);
  });
});
