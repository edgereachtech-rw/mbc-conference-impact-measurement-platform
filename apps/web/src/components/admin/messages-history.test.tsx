import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessagesHistory } from './messages-history';

const summary = {
  id: '11111111-1111-4111-8111-111111111111',
  subject: 'Welcome {{firstName}}',
  status: 'partially_failed',
  recipientCount: 3,
  sentCount: 2,
  failedCount: 1,
  sentBy: 'admin@example.com',
  createdAt: '2026-10-30T10:00:00Z',
  completedAt: '2026-10-30T10:00:05Z',
};

function stub(handler: (url: string) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const res = handler(url);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('MessagesHistory', () => {
  it('lists sent messages and expands one to the per-recipient outcome', async () => {
    stub((url) =>
      url.endsWith(`/messages/${summary.id}`)
        ? {
            status: 200,
            body: {
              message: {
                ...summary,
                body: 'Dear {{name}}',
                recipients: [
                  {
                    delegateId: 'd1',
                    name: 'Ada',
                    email: 'ada@example.com',
                    status: 'sent',
                    sentAt: '2026-10-30T10:00:01Z',
                  },
                  {
                    delegateId: 'd2',
                    name: 'Bob',
                    email: 'bob@example.com',
                    status: 'failed',
                    sentAt: null,
                  },
                ],
              },
            },
          }
        : { status: 200, body: { messages: [summary] } },
    );
    const user = userEvent.setup();
    render(<MessagesHistory eventId="e1" />);
    const table = await screen.findByRole('table', { name: 'Messages' });
    expect(within(table).getByText('2 of 3')).toBeTruthy();
    expect(within(table).getByText('1 failed')).toBeTruthy();
    expect(within(table).getByText('Partly failed')).toBeTruthy();
    await user.click(within(table).getByRole('button', { name: 'Welcome {{firstName}}' }));
    expect(await within(table).findByText('Dear {{name}}')).toBeTruthy();
    expect(within(table).getByText('Ada')).toBeTruthy();
    expect(within(table).getByText('Failed')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    stub(() => ({ status: 200, body: { messages: [] } }));
    render(<MessagesHistory eventId="e1" />);
    expect(await screen.findByText(/No messages have been sent/)).toBeTruthy();
  });
});
