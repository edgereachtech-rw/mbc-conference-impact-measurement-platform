import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DatePicker, monthGrid } from './date-picker';

describe('DatePicker', () => {
  it('lays out a month Monday-first', () => {
    const grid = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(grid.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(grid.filter(Boolean)).toHaveLength(30);
    expect(grid.length % 7).toBe(0);
  });

  it('toggles individual dates, keeps them sorted, lists them in order and protects dates with sessions', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DatePicker
        value={['2026-11-12', '2026-11-10']}
        onChange={onChange}
        locked={{ '2026-11-10': 2 }}
      />,
    );
    expect(screen.getByText('November 2026')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Selected dates' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['10 Nov 20262 sessions', '12 Nov 2026']);
    // A date with sessions cannot be unselected.
    const locked = screen.getByRole('button', { name: 'Tuesday 10 November 2026' });
    expect(locked).toHaveProperty('disabled', true);
    expect(locked.getAttribute('aria-pressed')).toBe('true');
    // Adding a non-consecutive date; the result is sorted.
    await user.click(screen.getByRole('button', { name: 'Tuesday 17 November 2026' }));
    expect(onChange).toHaveBeenLastCalledWith(['2026-11-10', '2026-11-12', '2026-11-17']);
    // Removing a free date from the list.
    await user.click(screen.getByRole('button', { name: 'Remove Thursday 12 November 2026' }));
    expect(onChange).toHaveBeenLastCalledWith(['2026-11-10']);
    // Month navigation.
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('December 2026')).toBeTruthy();
  });
});
