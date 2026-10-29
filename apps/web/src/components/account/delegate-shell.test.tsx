import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelegateShell } from './delegate-shell';

let pathname = '/account';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

afterEach(() => {
  pathname = '/account';
});

describe('DelegateShell', () => {
  it('offers Dashboard, My events and Profile in a sidebar and a phone tab bar, marking the current one', () => {
    pathname = '/account/profile';
    render(
      <DelegateShell displayName="Ada Lovelace" email="ada@example.com">
        <p>content</p>
      </DelegateShell>,
    );
    const navs = screen.getAllByRole('navigation', { name: 'Delegate navigation' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(
        within(nav)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(['Dashboard', 'My events', 'Profile']);
      expect(within(nav).getByRole('link', { name: 'Profile' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(
        within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current'),
      ).toBeNull();
      expect(within(nav).getByRole('link', { name: 'My events' }).getAttribute('href')).toBe(
        '/account/events',
      );
    }
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('marks Dashboard only on its exact path', () => {
    pathname = '/account/events';
    render(
      <DelegateShell displayName="A" email="a@example.com">
        <p>x</p>
      </DelegateShell>,
    );
    const nav = screen.getAllByRole('navigation', { name: 'Delegate navigation' })[0]!;
    expect(within(nav).getByRole('link', { name: 'My events' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current'),
    ).toBeNull();
  });
});
