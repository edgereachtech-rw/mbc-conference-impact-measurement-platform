import { describe, expect, it } from 'vitest';

import { sameAnswer } from './assessments.js';

/** A submitted answer compared by meaning (2026-11-24). */
describe('sameAnswer', () => {
  it('treats an answer with its keys in another order as the same answer', () => {
    // The form's order, and the order PostgreSQL stores it in.
    expect(
      sameAnswer({ selected: ['a', 'b'], other: null }, { other: null, selected: ['a', 'b'] }),
    ).toBe(true);
    expect(sameAnswer({ selected: ['x'], other: 'Mine' }, { other: 'Mine', selected: ['x'] })).toBe(
      true,
    );
  });

  it('still tells a changed answer apart', () => {
    expect(sameAnswer({ selected: ['a'], other: null }, { other: null, selected: ['b'] })).toBe(
      false,
    );
    // The order of the choices themselves is kept as given.
    expect(sameAnswer({ selected: ['a', 'b'] }, { selected: ['b', 'a'] })).toBe(false);
    expect(sameAnswer('text', 'text ')).toBe(false);
    expect(sameAnswer(true, false)).toBe(false);
    expect(sameAnswer(3, '3')).toBe(false);
  });

  it('compares plain values as they are', () => {
    expect(sameAnswer('A long answer', 'A long answer')).toBe(true);
    expect(sameAnswer(4, 4)).toBe(true);
    expect(sameAnswer(true, true)).toBe(true);
    expect(sameAnswer(null, null)).toBe(true);
  });
});
