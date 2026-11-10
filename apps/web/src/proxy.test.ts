import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy, REQUEST_PATH_HEADER } from './proxy';

/**
 * A signed-out visitor is sent to sign in by a real HTTP redirect carrying the exact address
 * asked for (2026-11-10), so the browser keeps the `#tab` part on the way to sign-in.
 */
describe('proxy', () => {
  it('redirects a protected address without a session cookie to sign-in with that address', () => {
    const res = proxy(new NextRequest('http://localhost:3000/admin/events/e1?tab=x'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/signin?next=%2Fadmin%2Fevents%2Fe1%3Ftab%3Dx',
    );
    expect(proxy(new NextRequest('http://localhost:3000/account')).status).toBe(307);
  });

  it('lets a request with a session cookie through, naming the address for the layouts', () => {
    const res = proxy(
      new NextRequest('http://localhost:3000/admin/events/e1', {
        headers: { cookie: 'mbc_session=abc' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-' + REQUEST_PATH_HEADER)).toBe('/admin/events/e1');
  });

  it('leaves other addresses alone', () => {
    const res = proxy(new NextRequest('http://localhost:3000/signin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
