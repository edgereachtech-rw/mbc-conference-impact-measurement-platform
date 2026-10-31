/**
 * API access from the web app.
 *
 * Browser: `<apiBase>/api/v1/...`.
 *   - `apiBase` is empty when the API answers on the page's own origin. That is what the Next dev
 *     server's rewrite gives (API_PROXY_URL, see next.config.ts), and calls stay same-origin.
 *   - Otherwise the API has an origin of its own (2026-10-31: the reverse proxy was removed). The
 *     root layout publishes that origin as a `mbc-api-base` meta tag from API_PUBLIC_URL and
 *     calls go there with credentials, which the API's CORS allowlist admits. It is read from the
 *     document rather than a NEXT_PUBLIC_ variable so it stays a runtime setting and one built
 *     image can serve both staging and production.
 *
 * Either way the session cookie travels automatically and the Origin header satisfies the API's
 * CSRF check. The cookie reaches both origins because they are same-site; COOKIE_DOMAIN widens it
 * when the two are different hostnames under one domain.
 *
 * Server components: an absolute API_INTERNAL_URL (http://api:44444 in Docker) with the incoming
 * request's cookie forwarded explicitly.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    /** The parsed error response, for callers that read extra fields such as per-question problems. */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = undefined;
  }
  return new ApiError(
    res.status,
    body?.error?.code ?? 'request_failed',
    body?.error?.message ?? 'The request failed. Please try again.',
    body?.error?.requestId,
    body,
  );
}

/**
 * Where the browser reaches the API, from the meta tag the root layout renders. Empty means the
 * API answers on this page's origin. Looked up once: the tag is server-rendered and never changes.
 */
let cachedBase: string | undefined;
export function apiBase(): string {
  if (cachedBase !== undefined) return cachedBase;
  if (typeof document === 'undefined') return '';
  const content = document.querySelector('meta[name="mbc-api-base"]')?.getAttribute('content');
  cachedBase = (content ?? '').replace(/\/+$/, '');
  return cachedBase;
}

/** Absolute URL for a browser call or a download link. */
export function apiUrl(path: string): string {
  return `${apiBase()}/api/v1${path}`;
}

/** Browser-side JSON call to the API; throws ApiError on non-2xx. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = apiBase();
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    credentials: base ? 'include' : 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...init.headers },
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * The API origin the browser should use, for the meta tag in the root layout. Empty (the default)
 * leaves calls same-origin. Read on the server, so it stays a runtime setting.
 */
export function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL ?? '').replace(/\/+$/, '');
}

/** Base URL for server-side calls (never used by the browser). */
export function apiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:44444').replace(/\/+$/, '');
}

/**
 * Browser-side multipart upload (registration import files). The browser sets the multipart
 * boundary itself, so no content-type header is given; the session cookie and Origin travel as
 * with JSON calls.
 */
export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const base = apiBase();
  const res = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    body,
    credentials: base ? 'include' : 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}
