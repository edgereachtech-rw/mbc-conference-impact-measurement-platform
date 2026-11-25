import type { EventDetail } from '@mbc/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInLinkSetting } from './sign-in-link-setting';

const event = {
  id: 'e1',
  signInLinkTtlMinutes: null,
  signInLinkReusable: false,
} as unknown as EventDetail;

function stubPatch() {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(JSON.stringify({ event: { ...event, ...body } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe('SignInLinkSetting', () => {
  it('saves the expiry and reuse choices and warns while they are relaxed', async () => {
    const bodies = stubPatch();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SignInLinkSetting event={event} onSaved={onSaved} />);
    expect(screen.queryByRole('note')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Link expires after'), 'Does not expire');
    expect(bodies.at(-1)).toEqual({ signInLinkTtlMinutes: 0 });
    await user.click(screen.getByLabelText('A link can be used more than once'));
    expect(bodies.at(-1)).toEqual({ signInLinkReusable: true });
    expect(onSaved).toHaveBeenCalledTimes(2);

    rerender(
      <SignInLinkSetting
        event={{ ...event, signInLinkTtlMinutes: 0, signInLinkReusable: true }}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByRole('note').textContent).toMatch(/at any time/);

    await user.selectOptions(screen.getByLabelText('Link expires after'), 'Platform setting');
    expect(bodies.at(-1)).toEqual({ signInLinkTtlMinutes: null });
  });
});
