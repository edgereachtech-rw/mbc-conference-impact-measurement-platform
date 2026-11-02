import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { event } from '@/config/event';

import { SiteFooter } from './site-footer';

describe('SiteFooter', () => {
  it('shows the organiser, the support address and the copyright', () => {
    render(<SiteFooter />);

    expect(
      screen.getByText(`${event.organiser.name} · Conference Impact Measurement Platform`),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: event.contactEmail }).getAttribute('href')).toBe(
      `mailto:${event.contactEmail}`,
    );
    expect(screen.getByText(event.copyright)).toBeTruthy();
  });

  it('has no event footer: the venue block and social links went with the landing page', () => {
    render(<SiteFooter />);

    expect(screen.queryByTestId('footer-venue')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Social media' })).toBeNull();
  });
});
