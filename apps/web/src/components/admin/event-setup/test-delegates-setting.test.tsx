import type { EventDetail } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestDelegatesSetting } from './test-delegates-setting';

const event = (countTestDelegates: boolean): EventDetail => ({
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
  countTestDelegates,
  transferPlanVisibility: 'shown',
  transferPlanShownFrom: null,
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  dates: [],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
});

afterEach(() => vi.unstubAllGlobals());

describe('TestDelegatesSetting', () => {
  it('saves the switch through the event PATCH and hands the updated event back', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        return new Response(JSON.stringify({ event: event(true) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const saved = vi.fn();
    render(<TestDelegatesSetting event={event(false)} onSaved={saved} />);

    const box = screen.getByRole('checkbox', { name: /Count test delegates/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    // Off is the default, and nothing warns while it is off.
    expect(screen.queryByRole('note')).toBeNull();

    await userEvent.click(box);
    expect(calls[0]).toMatchObject({
      url: expect.stringMatching(/\/events\/e1$/),
      method: 'PATCH',
      body: { countTestDelegates: true },
    });
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ countTestDelegates: true }));
  });

  it('warns while test delegates are being counted', () => {
    render(<TestDelegatesSetting event={event(true)} onSaved={() => {}} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('note').textContent).toMatch(/Switch it off before reporting/);
  });
});
