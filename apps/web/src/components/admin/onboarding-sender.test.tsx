import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnboardingSender } from './onboarding-sender';

const STATE = {
  eligible: 10,
  sent: 8,
  pending: 2,
  failed: 0,
  notSignedIn: 5,
  lastSentAt: null,
};

function stub(batches: Array<{ id: string; name: string; date: string }>) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = url.includes('/batches')
        ? { batches }
        : url.includes('/onboarding/send')
          ? { ...STATE, notSignedIn: 0, justSent: 5, justFailed: 0 }
          : STATE;
      return new Response(JSON.stringify(body), {
        status: url.includes('/send') ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('OnboardingSender (2026-11-23)', () => {
  it('sends again only to those not signed in, and has no "everyone" button', async () => {
    const calls = stub([]);
    const user = userEvent.setup();
    render(<OnboardingSender eventId="e1" timezone="Africa/Lagos" />);
    const again = await screen.findByRole('button', {
      name: /send again to the 5 not signed in/i,
    });
    expect(screen.queryByRole('button', { name: /everyone/i })).toBeNull();
    // No batches: no batch choice.
    expect(screen.queryByLabelText(/send to/i)).toBeNull();
    await user.click(again);
    await screen.findByText(/sent 5 packs/i);
    const sent = calls.find((c) => c.url.includes('/onboarding/send'));
    expect(sent?.body).toEqual({ scope: 'not_signed_in' });
  });

  it('narrows the figures and the send to the batch chosen', async () => {
    const calls = stub([{ id: 'b2', name: 'Batch 2', date: '2026-11-13' }]);
    const user = userEvent.setup();
    render(<OnboardingSender eventId="e1" timezone="Africa/Lagos" />);
    const select = await screen.findByLabelText(/send to/i);
    await user.selectOptions(select, 'b2');
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/events/e1/onboarding?batch=b2'))).toBe(true),
    );
    await user.click(await screen.findByRole('button', { name: /send to the 2 waiting/i }));
    await screen.findByText(/sent 5 packs/i);
    const sent = calls.find((c) => c.url.includes('/onboarding/send'));
    expect(sent?.body).toEqual({ scope: 'not_yet_sent', batch: 'b2' });
  });
});
