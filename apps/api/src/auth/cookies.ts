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
}

/**
 * HttpOnly + SameSite=Lax (magic links and QR deep links arrive as top-level navigations) +
 * Secure outside development + Path=/ and no Domain (host-only, the narrowest scope).
 */
export function serializeSessionCookie(value: string, options: SessionCookieOptions): string {
  const parts = [
    `${options.name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeClearedCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
