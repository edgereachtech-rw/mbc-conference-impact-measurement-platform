import { describe, expect, it } from 'vitest';

import { stableShuffle } from './assessments.js';

/** Knowledge questions are asked in a random order that stays put for a delegate (2026-11-10). */
describe('stableShuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('is a permutation that depends only on the seed', () => {
    const one = stableShuffle(items, 'delegate-1:section-1');
    expect([...one].sort()).toEqual(items);
    expect(stableShuffle(items, 'delegate-1:section-1')).toEqual(one);
    expect(one).not.toEqual(items);
  });

  it('gives another delegate another order', () => {
    expect(stableShuffle(items, 'delegate-2:section-1')).not.toEqual(
      stableShuffle(items, 'delegate-1:section-1'),
    );
  });

  it('leaves the input untouched', () => {
    const copy = [...items];
    stableShuffle(items, 'x');
    expect(items).toEqual(copy);
  });
});
