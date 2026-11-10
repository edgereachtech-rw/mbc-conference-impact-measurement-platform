import { describe, expect, it } from 'vitest';

import { signInPathFor } from './return-path';

/** A protected page sends the visitor to sign in with the exact address asked for (2026-11-10). */
describe('signInPathFor', () => {
  it('returns to the address asked for, query included', () => {
    expect(signInPathFor('/admin/events/e1', '/admin')).toBe('/signin?next=%2Fadmin%2Fevents%2Fe1');
    expect(signInPathFor('/account/events/e1?x=1', '/account')).toBe(
      '/signin?next=%2Faccount%2Fevents%2Fe1%3Fx%3D1',
    );
  });

  it('falls back when the address is unknown or not an in-app path', () => {
    expect(signInPathFor(null, '/admin')).toBe('/signin?next=%2Fadmin');
    expect(signInPathFor('//evil.example', '/admin')).toBe('/signin?next=%2Fadmin');
    expect(signInPathFor('https://evil.example/x', '/account')).toBe('/signin?next=%2Faccount');
  });
});
