import { safeReturnPath } from '@mbc/shared';
import { headers } from 'next/headers';

/** The request header the proxy fills with the address asked for (path and query). */
export const REQUEST_PATH_HEADER = 'x-mbc-path';

/**
 * The sign-in address that brings the visitor back to the page they asked for (2026-11-10):
 * `/signin?next=<the address>`, or the fallback when the address is unknown or not a safe
 * in-app path. The `#tab` part is added by the sign-in form from the browser.
 */
export function signInPathFor(requested: string | null | undefined, fallback: string): string {
  const next = safeReturnPath(requested ?? undefined) ?? fallback;
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** The same, read from the current request. */
export async function signInRedirect(fallback: string): Promise<string> {
  const store = await headers();
  return signInPathFor(store.get(REQUEST_PATH_HEADER), fallback);
}
