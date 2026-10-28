import { scrubEventPayload } from '@mbc/shared';
import { describe, expect, it } from 'vitest';

import { initSentry } from './sentry.js';

describe('Sentry', () => {
  it('stays disabled when SENTRY_DSN is unset', () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      expect(initSentry('api')).toBe(false);
    } finally {
      if (previous !== undefined) process.env.SENTRY_DSN = previous;
    }
  });

  it('beforeSend scrubbing removes personal data and credentials from an event', () => {
    const event = {
      message: 'Failed for ada@example.com',
      user: { id: '42', email: 'ada@example.com', username: 'ada', name: 'Ada' },
      request: {
        url: 'https://impact.example.com/signin?token=abc',
        headers: { Authorization: 'Bearer abc', Cookie: 'session=1' },
        cookies: { session: '1' },
        query_string: 'token=abc',
        data: { email: 'ada@example.com' },
      },
      extra: { name: 'Ada', token: 'abc', note: 'contact ada@example.com' },
      exception: { values: [{ type: 'Error', value: 'mail to ada@example.com bounced' }] },
    };
    const scrubbed = scrubEventPayload(event);
    const text = JSON.stringify(scrubbed);
    expect(scrubbed.user).toEqual({ id: '42' });
    expect(scrubbed.request.headers).toBeUndefined();
    expect(scrubbed.request.cookies).toBeUndefined();
    expect(scrubbed.request.query_string).toBeUndefined();
    expect(scrubbed.request.url).toBe('https://impact.example.com/signin');
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('Ada');
    expect(text).not.toContain('abc');
    expect(scrubbed.exception.values[0]?.value).toBe('mail to [email] bounced');
  });
});
