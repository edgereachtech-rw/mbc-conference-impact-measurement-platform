import type { EventDetail } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferPlanVisibilitySetting } from './transfer-plan-visibility-setting';

const event: EventDetail = {
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
  countTestDelegates: false,
  transferPlanVisibility: 'shown',
  transferPlanShownFrom: null,
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  dates: [],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('TransferPlanVisibilitySetting', () => {
  it('hides Transfer Planning until a date and time in the event time zone, through the event PATCH', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
        calls.push({ url, method: init?.method, body });
        return new Response(
          JSON.stringify({
            event: { ...event, ...(body as object) },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<TransferPlanVisibilitySetting event={event} onSaved={onSaved} />);
    expect(screen.getByText(/Right now: shown to delegates/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Delegates see Transfer Planning'), 'scheduled');
    await user.click(screen.getByRole('button', { name: 'Save visibility' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter the date and time/);
    expect(calls).toHaveLength(0);
    await user.type(screen.getByLabelText('Shown from'), '2026-11-12T14:30');
    await user.click(screen.getByRole('button', { name: 'Save visibility' }));
    expect(calls[0]).toMatchObject({
      url: '/api/v1/events/e1',
      method: 'PATCH',
      body: {
        transferPlanVisibility: 'scheduled',
        transferPlanShownFrom: '2026-11-12T13:30:00.000Z',
      },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toMatch(/hidden until/);
  });

  it('hides it for the whole event and says the plans are kept', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ event: { ...event, transferPlanVisibility: 'hidden' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const user = userEvent.setup();
    render(<TransferPlanVisibilitySetting event={event} onSaved={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Delegates see Transfer Planning'), 'hidden');
    await user.click(screen.getByRole('button', { name: 'Save visibility' }));
    expect((await screen.findByRole('status')).textContent).toMatch(
      /hidden from delegates. Their plans are kept/,
    );
  });
});
