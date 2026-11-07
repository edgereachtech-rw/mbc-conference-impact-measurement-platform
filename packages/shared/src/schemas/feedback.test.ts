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

  it('is pending until started, open until closed, and never closes on the clock', () => {
    const opened = '2026-11-12T10:00:00.000Z';
    expect(feedbackWindowState({ enabled: true, openedAt: null, closedAt: null })).toBe('pending');
    expect(feedbackWindowState({ enabled: true, openedAt: opened, closedAt: null })).toBe('open');
    expect(
      feedbackWindowState({
        enabled: true,
        openedAt: opened,
        closedAt: '2026-11-12T18:00:00.000Z',
      }),
    ).toBe('closed');
    expect(feedbackWindowState({ enabled: false, openedAt: opened, closedAt: null })).toBe(
      'disabled',
    );
  });
});
