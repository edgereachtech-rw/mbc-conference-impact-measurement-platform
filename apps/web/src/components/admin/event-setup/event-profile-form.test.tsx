import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventProfileForm } from './event-profile-form';

afterEach(() => vi.unstubAllGlobals());

describe('EventProfileForm', () => {
  it('asks the API whether the name is taken and shows the code it will get', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const name = new URL(url, 'http://x').searchParams.get('name');
        const base = 'ittec-2026';
        const taken = name === 'ITTEC 2026';
        return new Response(
          JSON.stringify({ base, code: taken ? `${base}-2` : base, available: !taken }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const user = userEvent.setup();
    render(<EventProfileForm mode="create" submitLabel="Create" onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText('Event name'), 'ITTEC 2026');
    expect(screen.getByTestId('event-code').textContent).toBe('ittec-2026'); // local, at once
    expect((await screen.findByRole('status')).textContent).toBe(
      'Another event already uses ittec-2026; this one will be saved as ittec-2026-2.',
    );
    expect(screen.getByTestId('event-code').textContent).toBe('ittec-2026-2');
  });

  it(
    'shows the code as the name is typed, requires a venue for hybrid events, and submits the parsed profile',
    { timeout: 30_000 },
    async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<EventProfileForm mode="create" submitLabel="Create event" onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText('Event name'), 'Transfer Summit 2027');
      expect(screen.getByTestId('event-code').textContent).toBe('transfer-summit-2027');
      expect(screen.queryByLabelText('Event code')).toBeNull();
      await user.type(screen.getByLabelText('Description'), 'One day on transfer.');
      await user.type(screen.getByLabelText('Organiser'), 'M.Bryan');
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toMatch(/venue or location is required/i);

      await user.selectOptions(screen.getByLabelText('Event format'), 'virtual');
      expect(screen.getByLabelText(/Venue or location \(optional\)/)).toBeTruthy();
      await user.type(screen.getByLabelText('Event website'), 'https://example.com');
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Transfer Summit 2027',
          format: 'virtual',
          eventType: 'conference',
          timezone: 'Africa/Lagos',
          website: 'https://example.com',
          location: null,
          theme: null,
        }),
      );
    },
  );

  it('shows the generated code read-only when editing, and server errors', () => {
    render(
      <EventProfileForm
        mode="edit"
        code="ittec-2026"
        initial={{ name: 'ITTEC 2026', format: 'virtual' }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        error={{ message: 'The profile could not be saved.', requestId: 'r1' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/);
    expect(screen.getByText('ittec-2026')).toBeTruthy();
    expect(screen.queryByLabelText('Event code')).toBeNull();
  });
});
