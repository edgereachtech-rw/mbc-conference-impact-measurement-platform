import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { event } from '@/config/event';

import { SiteFooter } from './site-footer';

describe('SiteFooter', () => {
  it('shows the venue line, contact email, social links and copyright from the event config', () => {
    render(<SiteFooter />);

    expect(screen.getByTestId('footer-venue').textContent).toBe(
      `${event.venue.display} | ${event.dates.display}`,
    );
    expect(screen.getByRole('link', { name: event.contactEmail }).getAttribute('href')).toBe(
      `mailto:${event.contactEmail}`,
    );
    const social = screen.getByRole('list', { name: 'Social media' });
    expect(social.querySelectorAll('a')).toHaveLength(event.social.length);
    expect(screen.getByText(event.copyright)).toBeTruthy();
  });
});
