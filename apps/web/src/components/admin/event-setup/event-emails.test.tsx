import type { EventDetail, EventEmailView } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventEmails } from './event-emails';

afterEach(() => vi.unstubAllGlobals());

const event = { id: 'e1', name: 'Transfer Summit', status: 'draft' } as unknown as EventDetail;

const view = (over: Partial<EventEmailView>): EventEmailView => ({
  kind: 'onboarding',
  label: 'Welcome pack',
  description: 'Sent from the Delegates tab.',
  placeholders: ['firstName', 'name', 'eventName', 'eventDates', 'venue'],
  defaults: {
    subject: 'Welcome to Transfer Summit: your check-in codes and what happens when',
    title: 'You are set for Transfer Summit',
    intro: 'You are registered for Transfer Summit.',
    closing: 'You sign in with this email address.',
    buttonLabel: 'Open my dashboard',
  },
  custom: null,
  preview: { subject: 'Welcome to Transfer Summit', html: '<p>platform wording</p>' },
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('EventEmails', () => {
  it('lists each kind, previews unsaved wording, saves a kind and clears it back', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/preview')) {
          const body = JSON.parse(String(init?.body));
          return json({ subject: `Preview: ${body.subject ?? ''}`, html: '<p>your wording</p>' });
        }
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          return json({
            email: view({
              custom: body.subject ? { ...body, title: null, closing: null } : null,
              preview: {
                subject: body.subject ?? 'Welcome to Transfer Summit',
                html: '<p>saved</p>',
              },
            }),
          });
        }
        return json({
          emails: [
            view({}),
            view({
              kind: 'session_feedback',
              label: 'Session feedback request',
              placeholders: ['firstName', 'name', 'eventName', 'sessionTitle', 'speaker', 'when'],
            }),
          ],
        });
      }),
    );
    const user = userEvent.setup();
    render(<EventEmails event={event} />);
    expect(await screen.findByRole('heading', { name: 'Welcome pack' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Session feedback request' })).toBeTruthy();
    expect(screen.getAllByText('The platform’s wording is in use.')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Edit wording' })[0]!);
    const form = screen.getByRole('form', { name: 'Welcome pack wording' });
    // The platform's wording is the starting point, as real text in each field.
    expect((within(form).getByLabelText('Button label') as HTMLInputElement).value).toBe(
      'Open my dashboard',
    );
    expect((within(form).getByLabelText('Subject') as HTMLInputElement).value).toBe(
      'Welcome to Transfer Summit: your check-in codes and what happens when',
    );
    expect(form.textContent).toContain('{{eventDates}}');
    expect(form.textContent).not.toContain('{{sessionTitle}}');

    await user.clear(within(form).getByLabelText('Subject'));
    await user.type(within(form).getByLabelText('Subject'), 'Welcome aboard, {{{{firstName}}');
    await user.click(within(form).getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Preview: Welcome aboard, \{\{firstName\}\}/)).toBeTruthy();
    const previewCall = calls.find((c) => c.url.endsWith('/preview'));
    expect(previewCall?.url).toBe('/api/v1/events/e1/emails/onboarding/preview');

    await user.click(within(form).getByRole('button', { name: 'Save wording' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe('/api/v1/events/e1/emails/onboarding');
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      subject: 'Welcome aboard, {{firstName}}',
      title: null,
      intro: null,
      closing: null,
      buttonLabel: null,
    });
    expect(await within(form).findByRole('status')).toBeTruthy();
    expect(screen.getByText('Your wording is in use.')).toBeTruthy();

    // Back to the platform's wording: the fields read it again, and nothing of ours is sent.
    await user.click(within(form).getByRole('button', { name: 'Clear to the platform’s wording' }));
    expect((within(form).getByLabelText('Subject') as HTMLInputElement).value).toBe(
      'Welcome to Transfer Summit: your check-in codes and what happens when',
    );
    await user.click(within(form).getByRole('button', { name: 'Save wording' }));
    const puts = calls.filter((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(puts.at(-1)?.init?.body)).subject).toBeNull();
  });
});
