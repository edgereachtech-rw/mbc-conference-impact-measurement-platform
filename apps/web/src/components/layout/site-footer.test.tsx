import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { platform } from '@/config/platform';

import { SiteFooter } from './site-footer';

describe('SiteFooter', () => {
  it('shows the organiser, the support address and the copyright', () => {
    render(<SiteFooter />);

    expect(screen.getByText(`${platform.company.name} · ${platform.shortName}`)).toBeTruthy();
    expect(screen.getByRole('link', { name: platform.contactEmail }).getAttribute('href')).toBe(
      `mailto:${platform.contactEmail}`,
    );
    expect(screen.getByText(platform.copyright)).toBeTruthy();
  });

  it('has no event footer: the venue block and social links went with the landing page', () => {
    render(<SiteFooter />);

    expect(screen.queryByTestId('footer-venue')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Social media' })).toBeNull();
  });
});
