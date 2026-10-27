import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RatingGroup, type RatingOption } from './rating-group';

const fiveOptions: RatingOption[] = [
  { value: '1', label: 'Strongly disagree' },
  { value: '2', label: 'Disagree' },
  { value: '3', label: 'Neutral' },
  { value: '4', label: 'Agree' },
  { value: '5', label: 'Strongly agree' },
];

describe('RatingGroup', () => {
  it('renders one radio per option under the question text', () => {
    render(<RatingGroup legend="I can apply what I learned" options={fiveOptions} />);

    const group = screen.getByRole('radiogroup', { name: 'I can apply what I learned' });
    expect(group.getAttribute('data-scale')).toBe('5');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('reports the chosen value when an option is tapped', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RatingGroup
        legend="Rate the session"
        options={fiveOptions.slice(0, 4)}
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByText('Agree'));

    expect(onValueChange).toHaveBeenCalledWith('4');
    expect(screen.getByRole('radio', { name: 'Agree' }).getAttribute('aria-checked')).toBe('true');
  });

  it('exposes an error message to assistive tech', () => {
    render(
      <RatingGroup legend="Rate the session" options={fiveOptions} error="Choose one option" />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Choose one option');
    expect(screen.getByRole('radiogroup').getAttribute('aria-invalid')).toBe('true');
  });
});
