import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { event } from '@/config/event';

import HomePage from './page';

describe('HomePage', () => {
  it('renders the event name, format label and sign-in link from the event config', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(event.shortName);
    expect(screen.getByText(event.format.label)).toBeTruthy();
    expect(screen.getByText(event.dates.display)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
  });

  it('has no registration links', () => {
    render(<HomePage />);

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(links.some((href) => href.includes('regist'))).toBe(false);
  });
});
