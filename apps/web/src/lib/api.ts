/**
 * API access from the web app.
 *
 * Browser: same-origin `/api/v1/...` (Caddy routes /api/* to the API in production; the Next
 * dev server rewrites it when API_PROXY_URL is set, see next.config.ts). The session cookie is
 * sent automatically and the Origin header satisfies the API's CSRF check.
 *
 * Server components: an absolute API_INTERNAL_URL (http://api:4000 in Docker) with the incoming
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

/** Browser-side JSON call to the API; throws ApiError on non-2xx. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...init.headers },
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Base URL for server-side calls (never used by the browser). */
export function apiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

/**
 * Browser-side multipart upload (registration import files). The browser sets the multipart
 * boundary itself, so no content-type header is given; the session cookie and Origin travel as
 * with JSON calls.
 */
export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}
