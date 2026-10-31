import { describe, expect, it } from 'vitest';

import { feedbackWindowState, ratingDistribution } from './feedback.js';

describe('session feedback helpers', () => {
  it('computes counts and percentages over the valid answers to one question', () => {
    const d = ratingDistribution([
      ...Array<string>(15).fill('excellent'),
      'good',
      'good',
      'good',
      'fair',
      'fair',
      'not-a-rating',
    ]);
    expect(d.total).toBe(20);
    expect(d.ratings).toEqual([
      { rating: 'excellent', count: 15, percent: 75 },
      { rating: 'good', count: 3, percent: 15 },
      { rating: 'fair', count: 2, percent: 10 },
      { rating: 'poor', count: 0, percent: 0 },
    ]);
  });

  it('handles a question nobody answered without dividing by zero', () => {
    const d = ratingDistribution([]);
    expect(d.total).toBe(0);
    expect(d.ratings.every((r) => r.count === 0 && r.percent === 0)).toBe(true);
  });

  it('keeps the form open until the configured deadline, never closing after five minutes', () => {
    const opened = new Date('2026-11-12T10:00:00.000Z');
    const session = { enabled: true, closesAt: '2026-11-12T23:59:00.000Z' };
    expect(feedbackWindowState(session, opened)).toBe('open');
    expect(feedbackWindowState(session, new Date('2026-11-12T10:06:00.000Z'))).toBe('open');
    expect(feedbackWindowState(session, new Date('2026-11-13T00:00:00.000Z'))).toBe('closed');
    expect(feedbackWindowState({ enabled: true, closesAt: null }, opened)).toBe('open');
    expect(feedbackWindowState({ enabled: false, closesAt: null }, opened)).toBe('disabled');
  });
});
