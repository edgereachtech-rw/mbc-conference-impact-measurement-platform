import { z } from 'zod';

import { withoutBlankValues } from '../lib/env.js';

/**
 * Authentication settings from the environment.
 *
 *   SESSION_TTL_DAYS            absolute session lifetime (default 14)
 *   SESSION_IDLE_DAYS           idle lifetime: a session unused this long ends (default 7)
 *   MAGIC_LINK_TTL_MINUTES      link / code validity (default 15)
 *   AUTH_RATE_LIMIT_PER_EMAIL   link requests per email per 15 minutes (default 3)
 *   AUTH_RATE_LIMIT_PER_IP      link requests per client address per hour (default 10)
 *   AUTH_VERIFY_LIMIT_PER_IP    failed verifications per client address per hour (default 20)
 *   APP_URL                     the web app origin; always an allowed origin; https in production
 *   AUTH_ALLOWED_ORIGINS        comma-separated extra origins for state-changing requests
 *   COOKIE_SECURE               "true"/"false"; false only when NODE_ENV is development or test
 *   COOKIE_DOMAIN               optional parent domain for the session cookie, e.g. "example.com",
 *                               so app.example.com and api.example.com both send it. Leave unset
 *                               when the two share a host and differ only by port.
 *   SESSION_SECRET              keys the hashes of client addresses and email identities kept in
 *                               the sign-in attempt ledger and the audit log (32+ chars in production)
 *   AUTH_ALLOW_TEST_REGISTRATIONS "true" lets registrations with status test sign in (development
 *                               and staging rehearsals, OQ-27). Refused in production; never a default.
 *   TRUST_PROXY                 Express `trust proxy` value naming a reverse proxy network, for
 *                               a load balancer or TLS terminator in front of the container;
 *                               "false" or unset trusts nobody, so forwarded headers are ignored.
 *                               Required in production so the decision is explicit.
 */
const schema = z.object({
  SESSION_TTL_DAYS: z.coerce.number().positive().default(14),
  SESSION_IDLE_DAYS: z.coerce.number().positive().default(7),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().positive().default(15),
  AUTH_RATE_LIMIT_PER_EMAIL: z.coerce.number().int().positive().default(3),
  AUTH_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(10),
  AUTH_VERIFY_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),
  APP_URL: z.url().default('http://localhost:33333'),
  AUTH_ALLOWED_ORIGINS: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_DOMAIN: z.string().optional(),
  NODE_ENV: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  AUTH_ALLOW_TEST_REGISTRATIONS: z.enum(['true', 'false']).optional(),
});

export interface AuthConfig {
  sessionTtlMs: number;
  sessionIdleMs: number;
  magicLinkTtlMs: number;
  rateLimitPerEmail: number;
  rateLimitPerIp: number;
  verifyLimitPerIp: number;
  appUrl: string;
  /** Origins (scheme://host[:port]) allowed to make state-changing requests, appUrl included. */
  allowedOrigins: string[];
  cookieName: string;
  cookieSecure: boolean;
  /** Parent domain for the session cookie, or null for a host-only cookie. */
  cookieDomain: string | null;
  /** Keys the HMAC of client addresses and email identities; never logged or stored. */
  hashSecret: string;
  /** Express `trust proxy` value, or false to ignore forwarded headers entirely. */
  trustProxy: string | false;
  production: boolean;
  /** Registrations with status test may sign in (never in production; D8 item 1, OQ-27). */
  allowTestRegistrations: boolean;
}

export const COOKIE_NAME = 'mbc_session';

/** Used only outside production, where the ledger holds throwaway data. */
const DEVELOPMENT_HASH_SECRET = 'development-only-hash-secret-do-not-use-in-production';
const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRET = /change-me|changeme|example|placeholder|secret-here/i;

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = schema.safeParse(withoutBlankValues(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid auth configuration: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const local = e.NODE_ENV === 'development' || e.NODE_ENV === 'test';
  const problems: string[] = [];

  // Cookie: Secure unless a local environment explicitly opts out.
  let cookieSecure = !local;
  if (e.COOKIE_SECURE === 'true') cookieSecure = true;
  if (e.COOKIE_SECURE === 'false') {
    if (!local) {
      problems.push('COOKIE_SECURE=false is only allowed when NODE_ENV is development or test');
    }
    cookieSecure = local ? false : true;
  }

  // Cookie domain: a bare hostname, never a scheme, port or leading dot.
  let cookieDomain: string | null = null;
  const domainRaw = e.COOKIE_DOMAIN?.trim().replace(/^\./, '') ?? '';
  if (domainRaw) {
    if (/[:/]/.test(domainRaw)) {
      problems.push('COOKIE_DOMAIN must be a bare hostname without a scheme, port or path');
    } else {
      cookieDomain = domainRaw;
    }
  }

  // Origins: APP_URL plus AUTH_ALLOWED_ORIGINS, each a bare http(s) origin.
  const appUrl = originOf(e.APP_URL, 'APP_URL', problems);
  if (production && appUrl && !appUrl.startsWith('https://')) {
    problems.push('APP_URL must use https in production');
  }
  const allowedOrigins = new Set<string>();
  if (appUrl) allowedOrigins.add(appUrl);
  for (const raw of (e.AUTH_ALLOWED_ORIGINS ?? '').split(',')) {
    const value = raw.trim();
    if (!value) continue;
    const origin = originOf(value, 'AUTH_ALLOWED_ORIGINS', problems);
    if (!origin) continue;
    if (production && !origin.startsWith('https://')) {
      problems.push(`AUTH_ALLOWED_ORIGINS entries must use https in production (${origin})`);
    }
    allowedOrigins.add(origin);
  }

  // Secret for keyed hashes.
  let hashSecret = e.SESSION_SECRET ?? '';
  if (production) {
    if (hashSecret.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRET.test(hashSecret)) {
      problems.push(
        `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters and not a placeholder in production`,
      );
    }
  } else if (!hashSecret) {
    hashSecret = DEVELOPMENT_HASH_SECRET;
  }

  // Proxy trust: explicit in production, nobody by default.
  const trustRaw = e.TRUST_PROXY?.trim() ?? '';
  let trustProxy: string | false = false;
  if (trustRaw && trustRaw !== 'false') {
    if (trustRaw === 'true') {
      problems.push('TRUST_PROXY=true would trust every client; name the proxy network instead');
    } else {
      trustProxy = trustRaw;
    }
  }
  if (production && !trustRaw) {
    problems.push(
      'TRUST_PROXY must name the reverse proxy network in production (e.g. uniquelocal) or be "false"',
    );
  }

  // Test registrations: an explicit non-production allowance only (OQ-27, D8 item 1).
  const allowTestRegistrations = e.AUTH_ALLOW_TEST_REGISTRATIONS === 'true';
  if (production && allowTestRegistrations) {
    problems.push('AUTH_ALLOW_TEST_REGISTRATIONS must not be set in production');
  }

  if (problems.length > 0) {
    throw new Error(`invalid auth configuration: ${problems.join('; ')}`);
  }

  return {
    sessionTtlMs: e.SESSION_TTL_DAYS * 86_400_000,
    sessionIdleMs: e.SESSION_IDLE_DAYS * 86_400_000,
    magicLinkTtlMs: e.MAGIC_LINK_TTL_MINUTES * 60_000,
    rateLimitPerEmail: e.AUTH_RATE_LIMIT_PER_EMAIL,
    rateLimitPerIp: e.AUTH_RATE_LIMIT_PER_IP,
    verifyLimitPerIp: e.AUTH_VERIFY_LIMIT_PER_IP,
    appUrl: appUrl ?? e.APP_URL,
    allowedOrigins: [...allowedOrigins],
    cookieName: COOKIE_NAME,
    cookieSecure,
    cookieDomain,
    hashSecret,
    trustProxy,
    production,
    allowTestRegistrations,
  };
}

/** The scheme://host[:port] of a URL, or null (with a problem recorded) when it is not a bare origin. */
function originOf(value: string, name: string, problems: string[]): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${name} is not a valid URL`);
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    problems.push(`${name} must use http or https`);
    return null;
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    problems.push(`${name} must be a bare origin without a path, query or fragment`);
    return null;
  }
  return url.origin;
}
