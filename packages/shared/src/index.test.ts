import { describe, expect, it } from 'vitest';

import { APP_NAME, healthResponseSchema } from './index.js';

describe('@mbc/shared', () => {
  it('exports the application name', () => {
    expect(APP_NAME).toBe('Conference Impact Measurement Platform');
  });

  it('accepts a valid health response', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      time: '2026-11-12T08:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid health response', () => {
    const parsed = healthResponseSchema.safeParse({ status: 'down', time: 'not-a-date' });
    expect(parsed.success).toBe(false);
  });
});
