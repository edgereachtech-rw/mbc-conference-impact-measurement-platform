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
  placeholders: ['firstName', 'name', 'eventName', 'link', 'eventDates', 'venue'],
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

function stub() {
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
        const customised = Object.values(body).some((v) => v);
        return json({
          email: view({
            custom: customised ? body : null,
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
            placeholders: ['firstName', 'name', 'eventName', 'link', 'sessionTitle'],
          }),
        ],
      });
    }),
  );
  return calls;
}

describe('EventEmails', () => {
  it('starts from the real wording, previews unsaved wording, saves a kind and clears it back', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<EventEmails event={event} />);
    expect(await screen.findByRole('heading', { name: 'Welcome pack' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Session feedback request' })).toBeTruthy();
    expect(screen.getAllByText('The platform’s wording is in use.')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Edit email' })[0]!);
    const form = screen.getByRole('form', { name: 'Welcome pack wording' });
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
    expect(calls.find((c) => c.url.endsWith('/preview'))?.url).toBe(
      '/api/v1/events/e1/emails/onboarding/preview',
    );

    await user.click(within(form).getByRole('button', { name: 'Save email' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe('/api/v1/events/e1/emails/onboarding');
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      subject: 'Welcome aboard, {{firstName}}',
      title: null,
      intro: null,
      closing: null,
      buttonLabel: null,
      body: null,
      style: null,
    });
    expect(await within(form).findByRole('status')).toBeTruthy();
    expect(screen.getByText('Your wording or look is in use.')).toBeTruthy();

    await user.click(within(form).getByRole('button', { name: 'Back to the platform’s email' }));
    expect((within(form).getByLabelText('Subject') as HTMLInputElement).value).toBe(
      'Welcome to Transfer Summit: your check-in codes and what happens when',
    );
    await user.click(within(form).getByRole('button', { name: 'Save email' }));
    const puts = calls.filter((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(puts.at(-1)?.init?.body)).subject).toBeNull();
  });

  it('lets the organisers write the whole content and set the look, keeping the frame', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<EventEmails event={event} />);
    await user.click((await screen.findAllByRole('button', { name: 'Edit email' }))[0]!);
    const form = screen.getByRole('form', { name: 'Welcome pack wording' });
    await user.click(within(form).getByLabelText(/Write the whole email/));
    // The platform's content is the starting point of the whole email too.
    const content = within(form).getByLabelText('Content') as HTMLTextAreaElement;
    expect(content.value).toBe(
      'You are registered for Transfer Summit.\n\nYou sign in with this email address.',
    );
    expect(within(form).queryByLabelText(/Introduction/)).toBeNull();
    await user.clear(content);
    await user.type(content, '## Welcome, {{{{firstName}}\n\nSee you there.');
    await user.selectOptions(within(form).getByLabelText('Alignment'), 'center');
    await user.selectOptions(within(form).getByLabelText('Text size'), 'large');

    await user.click(within(form).getByRole('button', { name: 'Save email' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      subject: null,
      title: null,
      intro: null,
      closing: null,
      buttonLabel: null,
      body: '## Welcome, {{firstName}}\n\nSee you there.',
      style: {
        accentColor: null,
        textColor: null,
        headingColor: null,
        align: 'center',
        fontSize: 'large',
      },
    });
    expect(await screen.findByText('Your whole content is in use.')).toBeTruthy();
  });
});
