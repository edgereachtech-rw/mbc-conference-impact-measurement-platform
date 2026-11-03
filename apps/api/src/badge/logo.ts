import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { Logger } from '../lib/logger.js';

/**
 * Fetches an event's logo and returns it as a data URI for the badge (task of 2026-11-03).
 *
 * The URL comes from the event profile, where an admin pastes it, so it is treated as hostile
 * input: the server must not be talked into fetching something on its own network. Every request
 * is https, to a public address, of an image type, under a size cap, with a short timeout and no
 * redirects followed blindly. A URL that fails any of those yields nothing and the card falls back
 * to type — a missing logo is never a reason to fail a download.
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 2;

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

/** Private, loopback, link-local and unique-local ranges: an address the server must not fetch. */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:10.0.0.1) hides a v4 address inside a v6 one.
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isPrivateAddress(mapped[1]!) : false;
  }
  const [a, b] = address.split('.').map(Number);
  if (a === undefined || b === undefined) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** Resolves the host and refuses anything that is not a public address. */
async function resolvesPublicly(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

async function fetchOnce(
  url: URL,
  logger: Logger,
  redirects: number,
): Promise<{ bytes: Buffer; type: string } | null> {
  if (url.protocol !== 'https:') return null;
  if (!(await resolvesPublicly(url.hostname))) {
    logger.warn('event logo refused: the address is not public');
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'image/*' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || redirects >= MAX_REDIRECTS) return null;
      // Every hop is checked again: the first URL being safe says nothing about where it points.
      return fetchOnce(new URL(location, url), logger, redirects + 1);
    }
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED.has(type)) return null;
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    return { bytes, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The logo as a data URI, or null when it cannot be fetched safely. */
export async function logoDataUri(imageUrl: string | null, logger: Logger): Promise<string | null> {
  if (!imageUrl) return null;
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  const fetched = await fetchOnce(url, logger, 0);
  if (!fetched) return null;
  return `data:${fetched.type};base64,${fetched.bytes.toString('base64')}`;
}
