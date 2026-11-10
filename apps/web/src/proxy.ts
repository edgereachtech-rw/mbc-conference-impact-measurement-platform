import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tells the server pages which address was asked for (2026-11-10). A protected page that finds
 * no session sends the visitor to sign in with that exact address as `next`, so they come back
 * to it, instead of to a fixed `/admin` or `/account`. Nothing about authorisation happens here:
 * the layouts still check the session and the API still authorises every request.
 *
 * The `#tab` part of an address never reaches the server; browsers keep it across the redirect
 * to sign-in, where the form adds it to `next` (see SignInForm).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-mbc-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/admin/:path*', '/account/:path*', '/admin', '/account'],
};
