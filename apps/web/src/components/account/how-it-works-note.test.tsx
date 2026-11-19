import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HowItWorksNote } from './how-it-works-note';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('HowItWorksNote', () => {
  it('tells the three-phase story in the event’s words, and stays closed once closed', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { unmount } = render(<HowItWorksNote dismissed={false} eventType="training" />);
    const note = screen.getByRole('complementary', { name: 'How this works' });
    expect(note.textContent).toContain('get out of the training');
    expect(note.textContent).toContain('At the training');
    expect(note.textContent).toContain('Afterwards');

    await user.click(screen.getByRole('button', { name: 'Close this note' }));
    expect(screen.queryByRole('complementary', { name: 'How this works' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/dashboard-note/dismiss',
      expect.objectContaining({ method: 'POST' }),
    );
    unmount();

    // The browser remembers the closing until the account's flag arrives with the next session.
    render(<HowItWorksNote dismissed={false} eventType="training" />);
    expect(screen.queryByRole('complementary', { name: 'How this works' })).toBeNull();
  });

  it('is not shown when the account already closed it', () => {
    render(<HowItWorksNote dismissed eventType={null} />);
    expect(screen.queryByRole('complementary', { name: 'How this works' })).toBeNull();
  });
});
