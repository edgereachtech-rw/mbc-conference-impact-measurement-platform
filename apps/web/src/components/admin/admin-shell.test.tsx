import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from './admin-shell';

let pathname = '/admin';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

afterEach(() => {
  pathname = '/admin';
});

describe('AdminShell', () => {
  it('marks the current section, links every screen, and shows who is signed in', () => {
    pathname = '/admin/imports';
    render(
      <AdminShell displayName="Olu Admin" role="admin">
        <p>content</p>
      </AdminShell>,
    );
    const navs = screen.getAllByRole('navigation', { name: 'Admin navigation' });
    expect(navs).toHaveLength(2); // sidebar and phone tab bar
    const sidebar = navs[0]!;
    expect(
      within(sidebar).getByRole('link', { name: 'Imports' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(sidebar).getByRole('link', { name: 'Overview' }).getAttribute('aria-current'),
    ).toBeNull();
    // Staff and Reports are built now, so both are real links rather than "coming soon" labels.
    expect(within(sidebar).getByRole('link', { name: 'Staff' }).getAttribute('href')).toBe(
      '/admin/staff',
    );
    expect(within(sidebar).getByRole('link', { name: 'Reports' }).getAttribute('href')).toBe(
      '/admin/reports',
    );
    expect(within(sidebar).queryByText('Staff')?.closest('[aria-disabled]')).toBeNull();
    expect(screen.getByText('Olu Admin')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });
});
