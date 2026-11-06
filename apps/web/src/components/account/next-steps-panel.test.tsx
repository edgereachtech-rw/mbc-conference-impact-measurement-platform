import type { Journey, MyEvent } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextStepsPanel } from './next-steps-panel';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

const event = {
  id: EVENT_ID,
  slug: 'ittec-2026',
  name: 'ITTEC 2026: Impact Through Training',
  period: 'upcoming',
  attendance: { status: 'pending' },
} as unknown as MyEvent;

const journey = {
  event: { id: EVENT_ID, name: 'ITTEC 2026', timezone: 'Africa/Lagos' },
  attendance: { status: 'pending', dates: [] },
  assessments: [{ stage: 'pre_conference', state: 'open', submittedAt: null }],
  reflections: { available: 0, submitted: 0 },
  feedback: { sessions: 0, submitted: 0 },
  plan: null,
  supportRequests: { state: 'none_recorded' },
} as unknown as Journey;

describe('NextStepsPanel', () => {
  it('lists what is outstanding, each linking to the tab that holds it', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return json({ journey });
      }),
    );
    render(<NextStepsPanel event={event} />);

    const assessment = await screen.findByRole('link', {
      name: /Complete your pre-conference assessment/,
    });
    expect(assessment.getAttribute('href')).toBe(`/account/events/${EVENT_ID}#assessments`);
    // The first outstanding item is the one big card with the only accent button: the delegate's
    // first act on the platform must not be one row among several (2026-11-06).
    expect(assessment.getAttribute('aria-label')).toBe(
      'Start now: Complete your pre-conference assessment',
    );
    expect(screen.getByText(/Start here/)).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'First thing, create your expectation' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Complete your pre-conference assessment' }),
    ).toBeTruthy();
    expect(screen.getByText(/records where you start/)).toBeTruthy();
    expect(screen.getByText('Also waiting for you')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Start your transfer plan/ }).getAttribute('href'),
    ).toBe(`/account/events/${EVENT_ID}#transfer-plan`);
    // One request, for the one event in focus.
    expect(calls).toEqual([`/api/v1/me/events/${EVENT_ID}/journey`]);
  });

  it('says so plainly when nothing is waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          journey: {
            ...journey,
            assessments: [{ stage: 'pre_conference', state: 'submitted', submittedAt: 'x' }],
            plan: {
              status: 'submitted',
              actions: 1,
              priority: null,
              applied: 0,
              measures: 0,
              withResult: 0,
              evidence: 0,
              reminder: 'none',
              nextReminderAt: null,
              updatedAt: 'x',
            },
          },
        }),
      ),
    );
    render(<NextStepsPanel event={event} />);
    expect(await screen.findByText(/Nothing is waiting for you right now/)).toBeTruthy();
  });

  it('stays out of the way when the journey cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'not_found', message: 'no' } }, 404)),
    );
    const { container } = render(<NextStepsPanel event={event} />);
    // The dashboard is not the place for an alarm about a panel that only suggests things.
    await vi.waitFor(() => expect(container.textContent).not.toMatch(/What to do next/));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives up rather than spinning forever when the body is not a journey', async () => {
    // Regression (2026-11-06): the panel read the body as the journey itself, and the throw from
    // reading its fields in the success branch left the spinner on screen indefinitely.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ unexpected: true })),
    );
    const { container } = render(<NextStepsPanel event={event} />);
    await vi.waitFor(() => expect(container.textContent).not.toMatch(/Checking what is waiting/));
    expect(container.textContent).not.toMatch(/What to do next/);
  });
});
