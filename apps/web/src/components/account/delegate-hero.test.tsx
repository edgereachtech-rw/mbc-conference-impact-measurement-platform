import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { event } from '@/config/event';

import { DelegateHero, JourneyStrip } from './delegate-hero';

describe('DelegateHero', () => {
  it('greets the delegate under the conference identity with their participation mode and the event facts', () => {
    render(<DelegateHero displayName="Ada Lovelace" participationMode="virtual" />);
    const hero = screen.getByRole('region', { name: 'Welcome, Ada Lovelace' });
    expect(within(hero).getByText(/Delegate/)).toBeTruthy();
    expect(within(hero).getByText('Virtual')).toBeTruthy();
    expect(within(hero).getByText(event.dates.display)).toBeTruthy();
    expect(within(hero).getByText(new RegExp(event.venue.name))).toBeTruthy();
  });

  it('renders the four journey steps in order without claiming any attendance', () => {
    render(<JourneyStrip />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]?.textContent).toMatch(/Pre-conference/);
    expect(steps[3]?.textContent).toMatch(/Follow-ups/);
    expect(screen.queryByText(/attended/i)).toBeNull();
  });
});
