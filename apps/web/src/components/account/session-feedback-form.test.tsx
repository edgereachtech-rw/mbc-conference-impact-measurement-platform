import type { MyFeedback } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionFeedbackForm } from './session-feedback-form';

afterEach(() => vi.unstubAllGlobals());

const Q = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;
const SESSION = '66666666-6666-4666-8666-666666666666';
const EVENT = '77777777-7777-4777-8777-777777777777';

const question = (id: string, prompt: string, type: 'rating' | 'long_text', required: boolean) => ({
  id,
  questionKey: id,
  version: 1,
  order: 1,
  prompt,
  type,
  required,
});
const base: MyFeedback = {
  session: {
    id: SESSION,
    eventId: EVENT,
    eventName: 'Summit',
    date: '2026-11-12',
    title: 'Measuring transfer',
    speaker: 'Dr A. Speaker',
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Africa/Lagos',
  },
  window: 'open',
  openedAt: '2026-11-12T09:02:00.000Z',
  closedAt: null,
  attended: true,
  questions: [
    question(
      Q[0],
      'How would you rate the relevance of this session to your work?',
      'rating',
      true,
    ),
    question(
      Q[1],
      'How would you rate the clarity and quality of the session delivery?',
      'rating',
      true,
    ),
    question(Q[2], 'How would you rate the practical usefulness of the session?', 'rating', true),
    question(Q[3], 'What was your main takeaway from this session?', 'long_text', false),
    question(Q[4], 'What could be improved about this session?', 'long_text', false),
  ],
  response: null,
  canSubmit: true,
};

function stub(feedback: MyFeedback) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let current = feedback;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { answers: Record<string, string> };
        // The server records once: the answers are not served back and the questions go.
        void body;
        current = {
          ...current,
          questions: [],
          canSubmit: false,
          response: {
            submittedAt: '2026-11-12T09:05:00.000Z',
            updatedAt: '2026-11-12T09:05:00.000Z',
            revision: 1,
            answers: {},
          },
        };
        return new Response(JSON.stringify({ feedback: current }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ feedback: current }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('SessionFeedbackForm', () => {
  it('shows the session automatically, requires the three ratings, accepts blank written answers, submits once after a review and confirms with a popup', async () => {
    const calls = stub(base);
    const user = userEvent.setup();
    render(<SessionFeedbackForm code="abc123def456" />);
    const card = await screen.findByRole('article', { name: 'Feedback: Measuring transfer' });
    expect(card.textContent).toMatch(
      /Summit.*Measuring transfer.*12 Nov 2026 09:00-10:00 · Dr A\. Speaker/,
    );
    expect(card.textContent).toMatch(/take about 5 minutes now/);
    expect(calls[0]?.url).toBe('/api/v1/me/feedback/abc123def456');

    await user.click(within(card).getByRole('button', { name: 'Submit feedback' }));
    expect(within(card).getAllByRole('alert')[0]!.textContent).toMatch(
      /3 questions need an answer/,
    );
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);

    const relevance = within(card).getByRole('group', { name: /relevance of this session/ });
    await user.click(within(relevance).getByLabelText('Excellent'));
    await user.click(
      within(within(card).getByRole('group', { name: /clarity and quality/ })).getByLabelText(
        'Good',
      ),
    );
    await user.click(
      within(within(card).getByRole('group', { name: /practical usefulness/ })).getByLabelText(
        'Fair',
      ),
    );
    await user.click(within(card).getByRole('button', { name: 'Submit feedback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit your feedback?' });
    const summary = within(dialog).getByRole('region', { name: 'Summary: Measuring transfer' });
    expect(summary.textContent).toMatch(/relevance of this session to your work\?Excellent/);
    expect(summary.textContent).toMatch(/main takeaway from this session\?No answer/);
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      answers: { [Q[0]]: 'excellent', [Q[1]]: 'good', [Q[2]]: 'fair' },
    });
    const done = await screen.findByRole('dialog', { name: 'Feedback submitted' });
    expect(done.textContent).toMatch(/recorded once and cannot be changed/);
    expect(done.textContent).toMatch(/What next/);
    expect(within(done).getByRole('link', { name: 'Back to my event' }).getAttribute('href')).toBe(
      `/account/events/${EVENT}#feedback`,
    );
    await user.click(within(done).getByRole('button', { name: 'Close' }));
    // No second go: the form is gone, the session is marked done.
    expect(within(card).getByText(/Submitted 12 Nov 2026/)).toBeTruthy();
    expect(within(card).getByRole('status').textContent).toMatch(/already given feedback/);
    expect(within(card).queryByRole('button', { name: /feedback/ })).toBeNull();
    expect(within(card).queryByRole('radio')).toBeNull();
  });

  it('shows a session already answered as done, with no form, when its code is scanned again', async () => {
    stub({
      ...base,
      questions: [],
      canSubmit: false,
      response: {
        submittedAt: '2026-11-12T09:05:00.000Z',
        updatedAt: '2026-11-12T09:05:00.000Z',
        revision: 1,
        answers: {},
      },
    });
    render(<SessionFeedbackForm code="abc123def456" />);
    const card = await screen.findByRole('article', { name: 'Feedback: Measuring transfer' });
    expect(within(card).getByRole('status').textContent).toMatch(/already given feedback/);
    expect(within(card).getByRole('link', { name: 'Back to my event' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /feedback/ })).toBeNull();
  });

  it('explains when attendance is not recorded and offers no submission', async () => {
    stub({ ...base, attended: false, canSubmit: false });
    render(<SessionFeedbackForm code="abc123def456" />);
    const card = await screen.findByRole('article', { name: 'Feedback: Measuring transfer' });
    expect(within(card).getByRole('alert').textContent).toMatch(
      /checked in on the day of this session/,
    );
    expect(within(card).queryByRole('button', { name: /Submit feedback/ })).toBeNull();
  });

  it('tells a delegate who scans early that feedback has not opened yet', async () => {
    stub({ ...base, window: 'pending', openedAt: null, canSubmit: false });
    render(<SessionFeedbackForm code="abc123def456" />);
    const card = await screen.findByRole('article', { name: 'Feedback: Measuring transfer' });
    expect(within(card).getByText('Not open yet')).toBeTruthy();
    expect(card.textContent).toMatch(/has not opened yet/);
    expect(within(card).queryByRole('button', { name: /Submit feedback/ })).toBeNull();
  });

  it('shows a closed session as closed only: no questions, no answers, whoever scans it', async () => {
    stub({
      ...base,
      window: 'closed',
      closedAt: '2026-11-12T18:00:00.000Z',
      attended: false,
      canSubmit: false,
      questions: [],
      response: null,
    });
    render(<SessionFeedbackForm code="abc123def456" />);
    const card = await screen.findByRole('article', { name: 'Feedback: Measuring transfer' });
    expect(within(card).getByText('Closed')).toBeTruthy();
    expect(card.textContent).toMatch(/Feedback for this session is closed/);
    expect(card.textContent).toMatch(/Closed 12 Nov 2026/);
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(within(card).queryByRole('radio')).toBeNull();
    expect(within(card).queryByRole('button', { name: /feedback/ })).toBeNull();
  });
});
