import { describe, expect, it } from 'vitest';

import { parseCookies, serializeClearedCookie, serializeSessionCookie } from './cookies.js';
import { generateCode, generateToken, hashCode, hashesEqual, hashIp, hashToken } from './tokens.js';

describe('tokens', () => {
  it('generates unpredictable URL-safe tokens and six-digit codes', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('hashes deterministically and binds codes to their token', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toHaveLength(64);
    expect(hashCode('123456', hashToken(t))).not.toBe(
      hashCode('123456', hashToken(generateToken())),
    );
    expect(hashesEqual(hashToken(t), hashToken(t))).toBe(true);
    expect(hashesEqual(hashToken(t), hashToken('other'))).toBe(false);
    expect(hashIp('203.0.113.9', 'k')).toHaveLength(32);
    expect(hashIp(undefined, 'k')).toBeNull();
  });
});

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax, host-only, Secure outside development', () => {
    const prod = serializeSessionCookie('abc', {
      name: 'mbc_session',
      secure: true,
      maxAgeSeconds: 100,
    });
    expect(prod).toBe('mbc_session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=100; Secure');
    expect(prod).not.toMatch(/Domain=/);
    const dev = serializeSessionCookie('abc', {
      name: 'mbc_session',
      secure: false,
      maxAgeSeconds: 100,
    });
    expect(dev).not.toMatch(/Secure/);
    expect(serializeClearedCookie('mbc_session', true)).toContain('Max-Age=0');
  });

  it('parses cookie headers', () => {
    expect(parseCookies('a=1; mbc_session=tok%2Fen; b=2')).toEqual({
      a: '1',
      mbc_session: 'tok/en',
      b: '2',
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});
