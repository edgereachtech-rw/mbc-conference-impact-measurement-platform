import type { EventDetail } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferPlanModeSetting } from './transfer-plan-mode-setting';

const event: EventDetail = {
  id: 'e1',
  code: 'line-managers',
  slug: 'line-managers',
  name: 'Line managers',
  description: 'd',
  eventType: 'training',
  organiser: 'M.Bryan',
  format: 'physical',
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
  startsOn: '2026-11-23',
  endsOn: '2026-11-25',
  dates: [],
  sessions: [],
  assessmentStages: [],
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('TransferPlanModeSetting', () => {
  it('switches an event to the checklist and commitment, in edited wording, through the event PATCH', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
        calls.push({ url, method: init?.method, body });
        return new Response(JSON.stringify({ event: { ...event, ...(body as object) } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<TransferPlanModeSetting event={event} onSaved={onSaved} />);
    // The full plan has no wording to edit.
    expect(screen.queryByLabelText('Form name')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Form'), 'commitment');
    await user.selectOptions(
      screen.getByLabelText('Place in the delegate’s journey'),
      'before_closing',
    );
    const name = screen.getByLabelText('Form name');
    expect((name as HTMLInputElement).value).toBe('My Training Checklist and Commitment');
    await user.clear(name);
    await user.type(name, 'Line manager checklist');
    // The default groups and actions are there to change; a group keeps at least one action.
    expect(screen.getAllByRole('group', { name: /^Group \d$/ })).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Remove group 3 action 2' }));
    await user.click(screen.getByRole('button', { name: 'Save the form setting' }));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/v1/events/e1');
    const body = patch?.body as {
      transferPlanMode: string;
      transferPlanPosition: string;
      transferPlanTemplate: { title: string; groups: Array<{ actions: unknown[] }> };
    };
    expect(body.transferPlanMode).toBe('commitment');
    expect(body.transferPlanPosition).toBe('before_closing');
    expect(body.transferPlanTemplate.title).toBe('Line manager checklist');
    expect(body.transferPlanTemplate.groups.map((g) => g.actions.length)).toEqual([3, 3, 1, 3]);
    expect(onSaved).toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent).toMatch(/checklist and commitment/);
  });

  it('refuses to save wording with a blank field', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const user = userEvent.setup();
    render(
      <TransferPlanModeSetting
        event={{ ...event, transferPlanMode: 'commitment' }}
        onSaved={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Button'));
    await user.click(screen.getByRole('button', { name: 'Save the form setting' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Complete every field.*buttonLabel/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
