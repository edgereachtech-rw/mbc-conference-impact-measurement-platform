/**
 * Personal-data scrubbing shared by the API logger, the worker and the Sentry beforeSend hooks
 * in web and api. Rule from CLAUDE.md: never log personal data.
 *
 * - Keys that carry identity or credentials are replaced with "[redacted]" (email, name,
 *   authorization, cookie, token, password, secret, query strings, ...). Key matching is
 *   case-insensitive and understands camelCase and kebab-case (displayName, x-name, api_key).
 * - String values anywhere: email addresses become "[email]", bearer tokens are masked, and
 *   the query string is stripped from URL-like strings.
 * - Depth and cycles are bounded so a logger can never blow up on a weird object.
 */

export const REDACTED = '[redacted]';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_WITH_QUERY_RE = /^(https?:\/\/[^\s?]+|\/[^\s?]*)\?[^\s]*$/i;

const SENSITIVE_KEY_RE =
  /(^|_|-|\.)(e?mail|email_address|name|first_name|last_name|full_name|display_name|recipient_name|phone|mobile|authorization|cookie|set_cookie|token|access_token|refresh_token|id_token|password|passwd|secret|api_key|apikey|session|query|search|querystring|query_string|x_name)$/;

function normaliseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

/** True when a key name denotes personal data or a credential. */
export function isSensitiveKey(key: string): boolean {
  const k = normaliseKey(key);
  return SENSITIVE_KEY_RE.test(k) || /password|secret|token|cookie/.test(k);
}

/** Scrubs a single string: emails, bearer credentials and query strings. */
export function scrubString(value: string): string {
  let out = value;
  if (URL_WITH_QUERY_RE.test(out)) out = out.slice(0, out.indexOf('?'));
  out = out.replace(BEARER_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`);
  out = out.replace(EMAIL_RE, '[email]');
  return out;
}

/**
 * Returns a deep copy of `value` with personal data removed. Errors keep their name, message
 * (scrubbed) and stack (scrubbed); other objects are walked key by key.
 */
export function scrubValue<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (depth > 12) return REDACTED as unknown as T;
  if (typeof value === 'string') return scrubString(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]' as unknown as T;
  seen.add(value as object);

  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1, seen)) as unknown as T;
  }
  if (value instanceof Error) {
    const copy: Record<string, unknown> = {
      name: value.name,
      message: scrubString(value.message),
    };
    if (value.stack) copy.stack = scrubString(value.stack);
    for (const [k, v] of Object.entries(value)) {
      copy[k] = isSensitiveKey(k) ? REDACTED : scrubValue(v, depth + 1, seen);
    }
    return copy as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrubValue(v, depth + 1, seen);
  }
  return out as unknown as T;
}

/**
 * Scrubs an error-tracking event (Sentry shape) before it leaves the process: deep-scrubs every
 * field, keeps only the user id, and drops request headers, cookies, query string and body.
 */
export function scrubEventPayload<T extends object>(event: T): T {
  const e = scrubValue(event) as T & {
    user?: { id?: unknown } | null;
    request?: Record<string, unknown> | null;
  };
  if (e.user && typeof e.user === 'object') {
    e.user = e.user.id !== undefined && e.user.id !== null ? { id: String(e.user.id) } : undefined;
  }
  if (e.request && typeof e.request === 'object') {
    delete e.request.headers;
    delete e.request.cookies;
    delete e.request.query_string;
    delete e.request.data;
    if (typeof e.request.url === 'string') e.request.url = scrubString(e.request.url);
  }
  return e;
}
