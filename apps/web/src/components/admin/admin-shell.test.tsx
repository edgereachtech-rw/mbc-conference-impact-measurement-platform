import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from './admin-shell';

let pathname = '/admin';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

afterEach(() => {
  pathname = '/admin';
});

describe('AdminShell', () => {
  it('marks the current section, links only the screens that exist, and shows who is signed in', () => {
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
    expect(within(sidebar).queryByRole('link', { name: 'Delegates' })).toBeNull(); // coming soon: not a link
    expect(
      within(sidebar)
        .getByText('Delegates')
        .closest('[aria-disabled]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByText('Olu Admin')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });
});
