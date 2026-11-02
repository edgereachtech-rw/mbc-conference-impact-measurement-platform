import type { ConsentNotice } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrivacyNotice } from './privacy-notice';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
  refresh.mockClear();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const notice: ConsentNotice = {
  document: 'privacy',
  version: 'v1',
  title: 'Privacy Information for Delegates',
  headline: 'Your Privacy Matters to Us',
  paragraphs: [
    'M.Bryan Consulting Limited collects the information you provide when you sign up.',
    'We use this information to manage your participation.',
  ],
  effectiveFrom: '2026-11-03T00:00:00.000Z',
};

const outstanding = {
  notice,
  outstanding: true,
  acceptedAt: null,
  acceptedVersion: null,
};

describe('PrivacyNotice', () => {
  it('shows the notice with its version, whoever is reading', () => {
    render(<PrivacyNotice notice={notice} state={null} next="/account" timezone="Africa/Lagos" />);
    expect(screen.getByText('Your Privacy Matters to Us')).toBeTruthy();
    expect(screen.getByText(/M.Bryan Consulting Limited collects/)).toBeTruthy();
    expect(screen.getByText(/version v1/)).toBeTruthy();
    // A visitor who is only reading is not asked to accept anything.
    expect(screen.queryByRole('button', { name: /I have read this/ })).toBeNull();
  });

  it('records an acceptance and sends the delegate on to where they were going', async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
        });
        return json({ ...outstanding, outstanding: false, acceptedVersion: 'v1' }, 201);
      }),
    );
    const user = userEvent.setup();
    render(
      <PrivacyNotice
        notice={notice}
        state={outstanding}
        next="/account/events"
        timezone="Africa/Lagos"
      />,
    );
    await user.click(screen.getByRole('button', { name: /I have read this/ }));

    expect(calls[0]!.url).toBe('/api/v1/me/consent');
    expect(calls[0]!.method).toBe('POST');
    // The version on screen is the version accepted: a notice revised meanwhile is refused.
    expect(calls[0]!.body).toEqual({ document: 'privacy', version: 'v1' });
    expect(replace).toHaveBeenCalledWith('/account/events');
  });

  it('keeps the delegate here and says why when the acceptance cannot be recorded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          {
            error: {
              code: 'notice_changed',
              message: 'The privacy notice was updated while this page was open.',
            },
          },
          409,
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <PrivacyNotice notice={notice} state={outstanding} next="/account" timezone="Africa/Lagos" />,
    );
    await user.click(screen.getByRole('button', { name: /I have read this/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/updated while this page/);
    expect(replace).not.toHaveBeenCalled();
    // Still offered, so they can read again and accept.
    expect(screen.getByRole('button', { name: /I have read this/ })).toBeTruthy();
  });

  it('tells a delegate who has already accepted when they did', () => {
    render(
      <PrivacyNotice
        notice={notice}
        state={{
          notice,
          outstanding: false,
          acceptedAt: '2026-11-03T10:30:00.000Z',
          acceptedVersion: 'v1',
        }}
        next="/account"
        timezone="Africa/Lagos"
      />,
    );
    expect(screen.getByText(/You accepted version v1 on/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /I have read this/ })).toBeNull();
  });
});
