import type { NextFunction, Request, Response } from 'express';

/**
 * Cross-origin access for the browser (2026-10-31: the reverse proxy was removed, so the web app
 * and the API answer on different origins).
 *
 * The allowlist is the same one `originCheck` enforces for state-changing requests: APP_URL plus
 * AUTH_ALLOWED_ORIGINS. Nothing is echoed for an origin outside it, so a stray site gets no
 * reply the browser will hand to its scripts.
 *
 * Credentials are allowed because the session cookie travels with every call. That obliges us to
 * name one concrete origin in the response ("*" is refused by browsers alongside credentials),
 * hence the echo of the request's own origin rather than a wildcard.
 */
export function cors(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/+$/, '')));
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get('origin');
    // Server-to-server calls (the Next server, the health probes) send no Origin: nothing to negotiate.
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    // The body and headers depend on the request's origin whether or not it was allowed, so a
    // shared cache must never serve one origin's response to another.
    res.appendHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      // Ten minutes: long enough to spare the preflight on a burst of calls, short enough that an
      // origin removed from the allowlist stops working promptly.
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}
