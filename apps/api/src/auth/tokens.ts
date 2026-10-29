import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Emailed once; never stored or logged. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Six-digit one-time code with leading zeros allowed. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** SHA-256 hex. Tokens are high-entropy, so a plain hash (no salt) is sufficient for lookup. */
export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Codes are low-entropy, so they are bound to the token they belong to before hashing. */
export function hashCode(code: string, tokenHash: string): string {
  return createHash('sha256').update(`${tokenHash}:${code}`).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Keyed hash (HMAC-SHA256, 128 bits) of a low-entropy identity such as an email address or a
 * client address. Without the key a stored hash cannot be matched against a dictionary of
 * addresses, so the attempt ledger and the audit log hold no plaintext identities.
 */
export function hashIdentity(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

/** Keyed hash of a client IP for rate limiting and audit; the IP itself is never stored. */
export function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null;
  return hashIdentity(ip, secret);
}
