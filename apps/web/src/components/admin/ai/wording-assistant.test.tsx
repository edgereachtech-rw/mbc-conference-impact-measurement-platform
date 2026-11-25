import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAiStatus } from './use-ai-status';
import { isAssistable, WordingAssistant } from './wording-assistant';

function stubApi(enabled: boolean, suggestion = 'How confident are you today?') {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = url.endsWith('/ai/status') ? { enabled } : { suggestion };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

/** A controlled field, as the console's forms have. */
function Form() {
  const [value, setValue] = useState('how confident r u today');
  return (
    <>
      <label htmlFor="q">Question</label>
      <textarea id="q" value={value} onChange={(e) => setValue(e.target.value)} />
      <p data-testid="saved">{value}</p>
      <div data-no-ai>
        <label htmlFor="n">Delegate name</label>
        <input id="n" defaultValue="Private Person" />
      </div>
      <WordingAssistant />
    </>
  );
}

beforeEach(() => resetAiStatus());
afterEach(() => vi.unstubAllGlobals());

describe('WordingAssistant', () => {
  it('offers a suggestion on a focused field and uses it only when accepted', async () => {
    const calls = stubApi(true);
    const user = userEvent.setup();
    render(<Form />);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/ai/status'))).toBe(true));
    await user.click(screen.getByLabelText('Question'));
    await user.click(await screen.findByRole('button', { name: /improve wording/i }));
    const suggestion = await screen.findByLabelText('Suggested');
    expect((suggestion as HTMLTextAreaElement).value).toBe('How confident are you today?');
    const request = calls.find((c) => c.url.endsWith('/ai/wording'))!;
    expect(request.body).toMatchObject({
      text: 'how confident r u today',
      mode: 'improve',
      field: 'Question',
      singleLine: false,
    });
    // Nothing changed yet.
    expect(screen.getByTestId('saved').textContent).toBe('how confident r u today');
    await user.click(screen.getByRole('button', { name: 'Use this wording' }));
    expect(screen.getByTestId('saved').textContent).toBe('How confident are you today?');
  });

  it('stays away from fields of personal details, and shows nothing when switched off', async () => {
    const calls = stubApi(true);
    const user = userEvent.setup();
    render(<Form />);
    await waitFor(() => expect(calls.length).toBe(1));
    await user.click(screen.getByLabelText('Delegate name'));
    expect(screen.queryByRole('button', { name: /improve wording/i })).toBeNull();
  });

  it('is off when the server has no key', async () => {
    const calls = stubApi(false);
    const user = userEvent.setup();
    render(<Form />);
    await waitFor(() => expect(calls.length).toBe(1));
    await user.click(screen.getByLabelText('Question'));
    expect(screen.queryByRole('button', { name: /improve wording/i })).toBeNull();
  });

  it('only treats free text as assistable', () => {
    const email = document.createElement('input');
    email.type = 'email';
    const search = document.createElement('input');
    search.placeholder = 'Search delegates';
    const text = document.createElement('input');
    expect(isAssistable(email)).toBe(false);
    expect(isAssistable(search)).toBe(false);
    expect(isAssistable(text)).toBe(true);
    expect(isAssistable(document.createElement('textarea'))).toBe(true);
  });
});
