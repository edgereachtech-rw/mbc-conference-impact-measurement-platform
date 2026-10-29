import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageComposer } from './message-composer';

function stubPost(body: unknown, status = 201) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('MessageComposer', () => {
  it('formats with the toolbar, inserts placeholders, previews the rendered email and sends after confirmation', async () => {
    const calls = stubPost({ messageId: 'm1', total: 2, sent: 2, failed: 0, skipped: 0 });
    const onSent = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageComposer
        eventId="e1"
        eventName="ITTEC 2026"
        recipients={{ delegateIds: ['d1', 'd2'] }}
        recipientCount={2}
        sample={{ name: 'Zara Zed', email: 'zara@example.com', organisation: 'Acme' }}
        onClose={onClose}
        onSent={onSent}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'New message' });
    expect(dialog.textContent).toMatch(/2 selected delegates/);
    const send = within(dialog).getByRole('button', { name: 'Send to 2 delegates' });
    expect(send).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Subject'), 'Welcome ');
    await user.selectOptions(screen.getByLabelText('Insert placeholder'), 'firstName');
    const body = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(body.value).toBe('{{firstName}}');
    await user.clear(body);
    await user.type(body, 'Dear {{{{name}}, see ');
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(body.value).toBe('Dear {{name}}, see **bold text**');
    // With the caret at the end (no selection) the list starts on a new line with a placeholder item.
    body.setSelectionRange(body.value.length, body.value.length);
    await user.click(screen.getByRole('button', { name: 'Bulleted list' }));
    expect(body.value).toBe('Dear {{name}}, see **bold text**\n- List item');

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = screen.getByLabelText('Message preview');
    expect(preview.innerHTML).toContain('Dear Zara Zed, see <strong>bold text</strong>');
    expect(preview.innerHTML).toContain('<li');
    expect(dialog.textContent).toMatch(/Preview as it will read for Zara Zed/);

    await user.click(send);
    expect(dialog.textContent).toMatch(/Send this message to 2 selected delegates\?/);
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Sent to 2 delegates/);
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/v1/events/e1/messages');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      subject: 'Welcome',
      body: 'Dear {{name}}, see **bold text**\n- List item',
      recipients: { delegateIds: ['d1', 'd2'] },
    });
    expect(onSent).toHaveBeenCalledWith({
      messageId: 'm1',
      total: 2,
      sent: 2,
      failed: 0,
      skipped: 0,
    });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks unknown placeholders, shows API errors, and closes on Escape', async () => {
    stubPost({ error: { code: 'event_archived', message: 'Archived.', requestId: 'r9' } }, 409);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageComposer
        eventId="e1"
        eventName="ITTEC 2026"
        recipients={{ filter: { status: 'pending' } }}
        recipientCount={14}
        onClose={onClose}
        onSent={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog').textContent).toMatch(
      /all 14 delegates matching the current filter/,
    );
    await user.type(screen.getByLabelText('Subject'), 'Hi {{{{nickname}}');
    await user.type(screen.getByLabelText('Message'), 'Body');
    expect(screen.getByRole('alert').textContent).toMatch(/Unknown placeholder: \{\{nickname\}\}/);
    const send = screen.getByRole('button', { name: 'Send to 14 delegates' });
    expect(send).toHaveProperty('disabled', true);

    await user.clear(screen.getByLabelText('Subject'));
    await user.type(screen.getByLabelText('Subject'), 'Hi');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(send);
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Archived\./);
    expect(alert.textContent).toMatch(/r9/);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
