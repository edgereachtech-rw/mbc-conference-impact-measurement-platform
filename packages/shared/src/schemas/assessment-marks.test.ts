import { describe, expect, it } from 'vitest';

import { sectionMarkOf } from './assessments.js';

const knowledge = {
  id: 'k',
  type: 'single_choice' as const,
  isKnowledge: true,
  options: [
    { value: 'a', label: 'A', correct: true },
    { value: 'b', label: 'B' },
  ],
};
const rated = {
  id: 'r',
  type: 'single_choice' as const,
  isKnowledge: false,
  options: [
    { value: 'low', label: 'Low', score: 1 },
    { value: 'high', label: 'High', score: 5 },
  ],
};

describe('sectionMarkOf', () => {
  it('marks knowledge questions only, one point each', () => {
    expect(
      sectionMarkOf('knowledge', [knowledge, { ...knowledge, id: 'k2' }, rated], (id) =>
        id === 'k' ? 1 : 0,
      ),
    ).toEqual({ scored: 1, max: 2, percent: 50 });
  });

  it('never marks a rating-scale or text section for the delegate', () => {
    expect(sectionMarkOf('scored', [rated], () => 5)).toBeNull();
    expect(sectionMarkOf('none', [knowledge], () => 1)).toBeNull();
    expect(sectionMarkOf('knowledge', [rated], () => 5)).toBeNull();
  });
});
