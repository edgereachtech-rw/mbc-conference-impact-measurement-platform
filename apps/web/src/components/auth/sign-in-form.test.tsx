import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInForm } from './sign-in-form';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 500, body: { error: { code: 'x', message: 'x' } } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
  refresh.mockReset();
});

describe('SignInForm', () => {
  it('requests a link for a normalised email and shows the generic confirmation with the support contact', async () => {
    const calls = stubFetch([{ status: 202, body: { ok: true, message: 'sent' } }]);
    const user = userEvent.setup();
    render(<SignInForm supportEmail="conference@mbryanconsultinggroup.com" next="/account/plan" />);

    await user.type(
      screen.getByLabelText(/email address you registered with/i),
      '  Ada@Example.COM ',
    );
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    expect(calls[0]?.url).toBe('/api/v1/auth/magic-link');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: 'ada@example.com',
      next: '/account/plan',
    });
    expect(await screen.findByText(/check your email/i)).toBeTruthy();
    expect(screen.getByText(/is registered for the conference/i)).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: 'conference@mbryanconsultinggroup.com' }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects an invalid email before calling the API', async () => {
    const calls = stubFetch([]);
    const user = userEvent.setup();
    render(<SignInForm supportEmail="help@example.com" />);
    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/valid email/i);
    expect(calls).toHaveLength(0);
  });

  it('signs in with the one-time code and navigates to the returned destination', async () => {
    const calls = stubFetch([
      { status: 202, body: { ok: true, message: 'sent' } },
      { status: 200, body: { ok: true, next: '/account', user: {} } },
    ]);
    const user = userEvent.setup();
    render(<SignInForm supportEmail="help@example.com" />);
    await user.type(screen.getByLabelText(/email address/i), 'grace@example.com');
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    await user.type(await screen.findByLabelText(/6-digit code/i), '123 456');
    await user.click(screen.getByRole('button', { name: /sign in with the code/i }));

    expect(calls[1]?.url).toBe('/api/v1/auth/verify');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      email: 'grace@example.com',
      code: '123456',
    });
    expect(replace).toHaveBeenCalledWith('/account');
  });

  it('shows a clear message when the code is wrong or expired', async () => {
    stubFetch([
      { status: 202, body: { ok: true, message: 'sent' } },
      { status: 401, body: { error: { code: 'invalid_token', message: 'nope', requestId: 'r' } } },
    ]);
    const user = userEvent.setup();
    render(<SignInForm supportEmail="help@example.com" />);
    await user.type(screen.getByLabelText(/email address/i), 'grace@example.com');
    await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    await user.type(await screen.findByLabelText(/6-digit code/i), '000000');
    await user.click(screen.getByRole('button', { name: /sign in with the code/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not valid or has expired/i);
    expect(replace).not.toHaveBeenCalled();
  });
});
