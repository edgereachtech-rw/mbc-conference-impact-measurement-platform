import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HomePage from './page';

const redirect = vi.fn();
const getSession = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  redirect: (path: string) => redirect(path),
}));
vi.mock('@/lib/session', () => ({ getSession: () => getSession() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const home = async (params: { next?: string; invite?: string } = {}) =>
  render(await HomePage({ searchParams: Promise.resolve(params) }));

describe('HomePage', () => {
  it('is the sign-in page: the organiser logo, the form, and no event logo or marketing', async () => {
    getSession.mockResolvedValue(null);
    await home();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in');
    expect(screen.getByAltText(/M\.Bryan/i)).toBeTruthy();
    expect(screen.queryByAltText(/ITTEC/i)).toBeNull();
    // Exactly one logo, and it is the organiser's.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByText(/one-time code to the email address you registered with/)).toBeTruthy();
    // The marketing landing page is gone: no journey steps, no venue, no registration.
    expect(screen.queryByText(/Three moments/)).toBeNull();
    expect(screen.queryByRole('heading', { name: /Transfer Plan/ })).toBeNull();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(links.some((href) => href.includes('regist'))).toBe(false);
  });

  it('sends someone already signed in to where they were heading', async () => {
    getSession.mockResolvedValue({ displayName: 'Olu', role: 'delegate' });
    await home({ next: '/account/events' });
    expect(redirect).toHaveBeenCalledWith('/account/events');

    redirect.mockClear();
    await home();
    expect(redirect).toHaveBeenCalledWith('/account');
  });

  it('greets an invited delegate by the email their link stands for', async () => {
    getSession.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ email: 'dee@example.com' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await home({ invite: 'a'.repeat(32) });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Activate your account');
    expect(screen.getByDisplayValue('dee@example.com')).toBeTruthy();
  });

  it('explains a dead invitation link instead of failing', async () => {
    getSession.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    await home({ invite: 'a'.repeat(32) });
    expect(screen.getByRole('note').textContent).toMatch(/no longer valid/);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in');
  });
});
