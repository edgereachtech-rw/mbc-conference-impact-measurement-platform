import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiSummaryPanel } from './ai-summary-panel';

const SUMMARY = {
  overview: 'Half of the delegates replied.',
  findings: ['Most heard about it on the website.'],
  basedOn: 3,
  generatedAt: '2026-11-25T08:00:00.000Z',
  batchId: null,
};

function stub(get: unknown, post?: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      return new Response(JSON.stringify(method === 'POST' ? post : get), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const props = {
  base: '/events/e1/assessments/pre_conference',
  roundQuery: '',
  batch: '',
  batchName: null,
  submitted: 3,
  timezone: 'Africa/Lagos',
};

describe('AiSummaryPanel', () => {
  it('writes a summary on request and shows it with when it was written', async () => {
    const calls = stub({ enabled: true, summary: null }, { enabled: true, summary: SUMMARY });
    const user = userEvent.setup();
    render(<AiSummaryPanel {...props} />);
    await user.click(await screen.findByRole('button', { name: /write a summary/i }));
    expect(await screen.findByText('Half of the delegates replied.')).toBeTruthy();
    expect(screen.getByText('Most heard about it on the website.')).toBeTruthy();
    expect(screen.getByText(/from 3 submitted responses/)).toBeTruthy();
    expect(calls.at(-1)).toEqual({
      url: '/api/v1/events/e1/assessments/pre_conference/ai-summary',
      method: 'POST',
    });
    expect(screen.getByRole('button', { name: /write again/i })).toBeTruthy();
  });

  it('asks for the batch and round chosen, and says when the figures have moved on', async () => {
    const calls = stub({ enabled: true, summary: SUMMARY });
    render(<AiSummaryPanel {...props} roundQuery="?wave=2" submitted={5} />);
    expect(await screen.findByText(/There are 5 now/)).toBeTruthy();
    expect(calls[0]!.url).toBe('/api/v1/events/e1/assessments/pre_conference/ai-summary?wave=2');
    vi.unstubAllGlobals();
    const batchCalls = stub({ enabled: true, summary: null });
    render(<AiSummaryPanel {...props} batch="b1" batchName="Day 1" />);
    expect(await screen.findByText(/· Day 1/)).toBeTruthy();
    expect(batchCalls[0]!.url).toContain('?batch=b1');
  });

  it('is hidden when the assistant is off and nothing was written', async () => {
    const calls = stub({ enabled: false, summary: null });
    const { container } = render(<AiSummaryPanel {...props} />);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(container.innerHTML).toBe('');
  });
});
