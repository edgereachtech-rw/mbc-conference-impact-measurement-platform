import { describe, expect, it } from 'vitest';

import { isSensitiveKey, REDACTED, scrubString, scrubValue } from './scrub.js';

describe('scrub', () => {
  it('recognises sensitive keys in any casing', () => {
    for (const key of [
      'email',
      'Email',
      'userEmail',
      'name',
      'displayName',
      'first_name',
      'authorization',
      'Cookie',
      'set-cookie',
      'x-name',
      'token',
      'accessToken',
      'password',
      'SESSION_SECRET',
      'query',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['hostname', 'status', 'requestId', 'eventId', 'count', 'method']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it('scrubs emails, bearer tokens and query strings inside strings', () => {
    expect(scrubString('contact ada@example.com now')).toBe('contact [email] now');
    expect(scrubString('Bearer abc.def-123')).toBe(`Bearer ${REDACTED}`);
    expect(scrubString('/api/health?email=x@y.com&name=Ada')).toBe('/api/health');
    expect(scrubString('https://h.example/signin?token=abc')).toBe('https://h.example/signin');
    expect(scrubString('plain text')).toBe('plain text');
  });

  it('deep-scrubs objects, arrays and errors without mutating the input', () => {
    const input = {
      email: 'ada@example.com',
      name: 'Ada',
      nested: { authorization: 'Bearer x', note: 'mail ada@example.com', ok: 1 },
      list: [{ token: 't' }, 'grace@example.com'],
      when: new Date('2026-01-01T00:00:00Z'),
    };
    const out = scrubValue(input);
    expect(out.email).toBe(REDACTED);
    expect(out.name).toBe(REDACTED);
    expect(out.nested.authorization).toBe(REDACTED);
    expect(out.nested.note).toBe('mail [email]');
    expect(out.nested.ok).toBe(1);
    expect(out.list[0]).toEqual({ token: REDACTED });
    expect(out.list[1]).toBe('[email]');
    expect(out.when).toBeInstanceOf(Date);
    expect(input.email).toBe('ada@example.com');

    const err = new Error('failed for ada@example.com');
    const scrubbedErr = scrubValue(err) as unknown as { message: string; stack?: string };
    expect(scrubbedErr.message).toBe('failed for [email]');
    expect(scrubbedErr.stack ?? '').not.toContain('ada@example.com');
  });

  it('handles cycles and depth', () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    expect(() => scrubValue(a)).not.toThrow();
  });
});
