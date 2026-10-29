import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ShellSession } from '@/lib/session';

import { SiteHeader } from './site-header';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const session = (role: ShellSession['role']): ShellSession =>
  ({
    displayName: 'Olu',
    role,
    participationMode: role === 'delegate' ? 'physical' : undefined,
    user: { id: 'u', email: 'o@example.com', role, displayName: 'Olu', delegate: null },
  }) as ShellSession;

describe('SiteHeader', () => {
  it('shows the M.Bryan console bar for staff: corporate logo on the left, no event logo, name and role on the right', () => {
    render(<SiteHeader session={session('admin')} />);
    const home = screen.getByRole('link', { name: 'Admin console home' });
    expect(home.getAttribute('href')).toBe('/admin');
    expect(screen.getByAltText(/M\.Bryan/i)).toBeTruthy();
    expect(screen.queryByAltText(/ITTEC/i)).toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(1); // exactly one logo
    expect(screen.getByText('Olu')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /sign out/i }).length).toBeGreaterThan(0);
  });

  it('gives delegates the same corporate bar, with the dashboard as home', () => {
    render(<SiteHeader session={session('delegate')} />);
    const home = screen.getByRole('link', { name: 'Delegate home' });
    expect(home.getAttribute('href')).toBe('/account');
    expect(screen.getByAltText(/M\.Bryan/i)).toBeTruthy();
    expect(screen.queryByAltText(/ITTEC/i)).toBeNull();
    expect(screen.getByText('Olu')).toBeTruthy();
    expect(screen.getByText('delegate')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /sign out/i }).length).toBeGreaterThan(0);
  });

  it('keeps the ITTEC event bar for visitors', () => {
    render(<SiteHeader session={null} />);
    expect(screen.getByAltText(/ITTEC/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /home$/ })?.getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });
});
