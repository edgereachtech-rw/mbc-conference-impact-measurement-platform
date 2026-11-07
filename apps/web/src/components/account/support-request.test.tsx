import type { MySupportRequest } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportRequestPanel } from './support-request';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const EVENT = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333';

describe('SupportRequestPanel', () => {
  it('sends a request naming an action, confirms it, and lists it as open with the organisers’ reply later', async () => {
    const existing: MySupportRequest = {
      id: '11111111-1111-4111-8111-111111111111',
      eventId: EVENT,
      source: 'follow_up',
      context: '30-day follow-up',
      action: null,
      request: 'An introduction to the HR director.',
      barrier: '',
      status: 'addressed',
      actionTaken: 'Introduced on 16 Dec.',
      addressedBy: 'admin@example.com',
      addressedAt: '2026-12-16T10:00:00.000Z',
      createdAt: '2026-12-15T09:00:00.000Z',
      updatedAt: '2026-12-16T10:00:00.000Z',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { request: string; barrier: string };
          const created: MySupportRequest = {
            ...existing,
            id: '44444444-4444-4444-8444-444444444444',
            source: 'delegate',
            context: 'Transfer plan page',
            action: 'Introduce a tracking process',
            request: body.request,
            barrier: body.barrier,
            status: 'open',
            actionTaken: '',
            addressedBy: null,
            addressedAt: null,
            createdAt: '2026-12-20T09:00:00.000Z',
            updatedAt: '2026-12-20T09:00:00.000Z',
          };
          return json({ request: created }, 201);
        }
        return json({ requests: [existing] });
      }),
    );
    const user = userEvent.setup();
    render(
      <SupportRequestPanel
        eventId={EVENT}
        actions={[{ id: ACTION, action: 'Introduce a tracking process' }]}
      />,
    );
    const list = await screen.findByRole('list', { name: 'Your support requests' });
    expect(within(list).getByText(/An introduction to the HR director/)).toBeTruthy();
    expect(within(list).getByText(/M\.Bryan: Introduced on 16 Dec\./)).toBeTruthy();
    expect(within(list).getByText('Addressed')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Request support' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request support' });
    // Nothing goes without saying what is needed.
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Say what support you need/);
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);

    await user.type(
      within(dialog).getByLabelText(/What support do you need/),
      'A short call with someone who has set up tracking before.',
    );
    await user.type(
      within(dialog).getByLabelText(/standing in the way/),
      'No one here has done it.',
    );
    await user.selectOptions(within(dialog).getByLabelText(/Which planned action/), ACTION);
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe(`/api/v1/me/events/${EVENT}/support-requests`);
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      request: 'A short call with someone who has set up tracking before.',
      barrier: 'No one here has done it.',
      actionId: ACTION,
    });
    const sent = await screen.findByRole('dialog', { name: 'Request sent' });
    expect(within(sent).getByRole('status').textContent).toMatch(/M\.Bryan has your request/);
    await user.click(within(sent).getByRole('button', { name: 'Close' }));
    const items = within(screen.getByRole('list', { name: 'Your support requests' })).getAllByRole(
      'listitem',
    );
    expect(items[0]!.textContent).toMatch(
      /A short call with someone.*Introduce a tracking process/,
    );
    expect(within(items[0]!).getByText('Open')).toBeTruthy();
  });
});
