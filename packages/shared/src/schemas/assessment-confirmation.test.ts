import { describe, expect, it } from 'vitest';

import { assessmentConfirmationSchema, DEFAULT_CONFIRMATION, parseConfirmation } from './events.js';

describe('assessment submission confirmation', () => {
  it('fills the defaults, blanks the empty words, and refuses values outside the choices', () => {
    expect(assessmentConfirmationSchema.parse({})).toEqual(DEFAULT_CONFIRMATION);
    expect(
      assessmentConfirmationSchema.parse({ title: '  ', message: 'Done ', tone: 'ink' }),
    ).toEqual({ ...DEFAULT_CONFIRMATION, message: 'Done', tone: 'ink' });
    expect(assessmentConfirmationSchema.safeParse({ tone: 'purple' }).success).toBe(false);
    expect(assessmentConfirmationSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
  });

  it('reads stored settings and treats nothing or garbage as the defaults', () => {
    expect(parseConfirmation(null)).toBeNull();
    expect(parseConfirmation(undefined)).toBeNull();
    expect(parseConfirmation('nope')).toBeNull();
    expect(parseConfirmation({ title: 'Thanks', align: 'left' })).toEqual({
      ...DEFAULT_CONFIRMATION,
      title: 'Thanks',
      align: 'left',
    });
  });
});
