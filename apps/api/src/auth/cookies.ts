/** Minimal cookie handling (no extra dependency): one session cookie, host-only, path "/". */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface SessionCookieOptions {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
  /**
   * Widens the cookie to a parent domain, e.g. "example.com" so that both app.example.com and
   * api.example.com send it. Omitted (the default) keeps it host-only, which is the narrowest
   * scope and already enough when the web app and the API share a host and differ only by port,
   * because cookies ignore the port.
   */
  domain?: string | null;
}

/**
 * HttpOnly + SameSite=Lax (magic links and QR deep links arrive as top-level navigations) +
 * Secure outside development + Path=/ and, unless COOKIE_DOMAIN widens it, no Domain.
 *
 * SameSite stays Lax with the API on its own origin: the two origins have to be same-site for the
 * server-rendered pages to see the session at all, and same-site requests carry a Lax cookie.
 */
export function serializeSessionCookie(value: string, options: SessionCookieOptions): string {
  const parts = [
    `${options.name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Clearing must repeat Domain, or the browser keeps the wider cookie. */
export function serializeClearedCookie(
  name: string,
  secure: boolean,
  domain?: string | null,
): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
