import type { Journey } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JourneyPanel } from './journey-panel';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function journey(partial: Partial<Journey> = {}): Journey {
  return {
    event: { id: 'e1', name: 'Summit', timezone: 'Africa/Lagos' },
    attendance: {
      status: 'partial',
      dates: [
        { date: '2026-11-12', status: 'attended', closed: true },
        { date: '2026-11-13', status: 'not_checked_in', closed: false },
      ],
    },
    assessments: [
      {
        stage: 'pre_conference',
        wave: 1,
        waveLabel: '',
        state: 'submitted',
        submittedAt: '2026-11-10T09:00:00.000Z',
      },
      {
        stage: 'during_conference',
        wave: 1,
        waveLabel: '',
        state: 'not_configured',
        submittedAt: null,
      },
      { stage: 'end_of_conference', wave: 1, waveLabel: '', state: 'draft', submittedAt: null },
      { stage: 'follow_up', wave: 1, waveLabel: '', state: 'not_yet_open', submittedAt: null },
    ],
    reflections: { available: 2, submitted: 1 },
    feedback: { sessions: 3, submitted: 2 },
    plan: {
      status: 'submitted',
      actions: 2,
      priority: 'Brief stakeholders',
      applied: 1,
      measures: 2,
      withResult: 1,
      evidence: 1,
      reminder: 'weekly',
      nextReminderAt: '2026-12-01T09:00:00.000Z',
      updatedAt: '2026-11-24T09:00:00.000Z',
    },
    supportRequests: { state: 'not_collected' },
    ...partial,
  };
}

function stub(body: Journey | null, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (status !== 200) {
        return json(
          { error: { code: 'forbidden', message: 'The journey belongs to delegates.' } },
          status,
        );
      }
      return json({ journey: body });
    }),
  );
  return calls;
}

describe('JourneyPanel', () => {
  it('shows the delegate their own attendance, responses and plan', async () => {
    const calls = stub(journey());
    render(<JourneyPanel eventId="e1" timezone="Africa/Lagos" />);
    expect(await screen.findByRole('region', { name: 'Your journey at a glance' })).toBeTruthy();
    expect(calls).toEqual(['/api/v1/me/events/e1/journey']);

    const attendance = screen.getByRole('region', { name: 'Your attendance' });
    expect(attendance.textContent).toMatch(/12 Nov 2026Attended/);
    // A date still open is "not checked in", never absent.
    expect(attendance.textContent).toMatch(/13 Nov 2026Not checked instill open/);
    expect(attendance.textContent).not.toMatch(/Absent/);

    const assessments = screen.getByRole('region', { name: 'Your assessment responses' });
    expect(assessments.textContent).toMatch(/Pre-conference assessmentSubmitted/);
    expect(assessments.textContent).toMatch(/During-conference assessmentNot part of this event/);
    expect(assessments.textContent).toMatch(/End-of-conference evaluationSaved as a draft/);
    expect(assessments.textContent).toMatch(/Follow-up assessmentOpens later/);

    const plan = screen.getByRole('region', { name: 'Your transfer plan' });
    expect(plan.textContent).toMatch(/Submitted/);
    expect(plan.textContent).toMatch(/First priorityBrief stakeholders/);
    expect(plan.textContent).toMatch(/Planned actions2/);
    expect(plan.textContent).toMatch(
      /Actions you have applied1 \(applied or applied consistently\)/,
    );
    expect(plan.textContent).toMatch(/Measures recorded2, 1 with a result/);
    expect(plan.textContent).toMatch(/Evidence records1/);
    expect(plan.textContent).toMatch(/RemindersEvery week; next/);

    const support = screen.getByRole('region', { name: 'Your support requests' });
    expect(support.textContent).toMatch(/Not collected by the platform/);
  });

  it('invites a delegate with no plan to start one', async () => {
    stub(journey({ plan: null, reflections: { available: 0, submitted: 0 } }));
    render(<JourneyPanel eventId="e1" timezone="Africa/Lagos" />);
    expect(await screen.findByText(/You have not started a plan yet/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your journey at a glance' }).textContent).toMatch(
      /Reflections0 of 0/,
    );
  });

  it('shows the error state with a retry', async () => {
    stub(null, 403);
    render(<JourneyPanel eventId="e1" timezone="Africa/Lagos" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/belongs to delegates/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
