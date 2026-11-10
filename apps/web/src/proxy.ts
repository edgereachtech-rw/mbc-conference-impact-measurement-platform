import { NextResponse, type NextRequest } from 'next/server';

/** The session cookie the API sets; its presence is all this file looks at. */
const SESSION_COOKIE = 'mbc_session';

/** The request header the layouts read for the address asked for (path and query). */
export const REQUEST_PATH_HEADER = 'x-mbc-path';

const isProtected = (pathname: string) =>
  pathname === '/admin' ||
  pathname.startsWith('/admin/') ||
  pathname === '/account' ||
  pathname.startsWith('/account/');

/**
 * Brings a signed-out visitor back to the exact address they asked for (2026-11-10).
 *
 * A visitor without a session cookie who asks for a protected address is sent to sign-in with
 * that address, path and query, as `next`, by a real HTTP redirect. That matters for the `#tab`
 * part of an address: it never reaches the server, but browsers keep it across an HTTP redirect
 * whose target has none, so it arrives on the sign-in page, where the form adds it to `next`.
 * (A redirect issued from a layout happens client-side, mid-stream, and loses it.)
 *
 * Nothing about authorisation happens here: a cookie may be stale, so the layouts still check
 * the session and the API still authorises every request. For those the address asked for is
 * passed on in a request header.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const asked = `${pathname}${search}`;
  if (isProtected(pathname) && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    url.search = `?next=${encodeURIComponent(asked)}`;
    url.hash = '';
    return NextResponse.redirect(url, 307);
  }
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, asked);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/admin/:path*', '/account/:path*', '/admin', '/account'],
};
