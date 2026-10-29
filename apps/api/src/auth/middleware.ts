import type { UserRole } from '@mbc/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { HttpError } from '../lib/errors.js';
import type { AuthConfig } from './config.js';
import { parseCookies } from './cookies.js';
import { hasRole, type Principal } from './policies.js';
import type { AuthService, ClientContext, ResolvedSession } from './service.js';
import { hashIp } from './tokens.js';

/** Where the resolved session and the client identity live for the rest of the request. */
export interface AuthLocals {
  session?: ResolvedSession;
  client?: ClientContext;
}

export function sessionOf(res: Response): ResolvedSession | undefined {
  return (res.locals as AuthLocals).session;
}

/** Throws if no session; use after requireAuth. */
export function principalOf(res: Response): Principal {
  const session = sessionOf(res);
  if (!session) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  return session.principal;
}

/**
 * Client identity for rate limiting and audit: a keyed hash of `req.ip` (which honours forwarded
 * headers only from the proxies named by `trust proxy`) and a bounded user agent.
 */
export function clientContext(req: Request, hashSecret: string): ClientContext {
  return {
    ipHash: hashIp(req.ip, hashSecret),
    userAgent: req.get('user-agent')?.slice(0, 200) ?? null,
  };
}

/** The identity computed by loadSession; throws if the middleware did not run (fail closed). */
export function clientOf(res: Response): ClientContext {
  const client = (res.locals as AuthLocals).client;
  if (!client) throw new Error('client context missing: loadSession must run before this route');
  return client;
}

export function rawSessionToken(req: Request, cookieName: string): string | undefined {
  return parseCookies(req.get('cookie'))[cookieName];
}

export function createAuthMiddleware(auth: AuthService, config: AuthConfig) {
  /** Records the client identity and resolves the cookie into res.locals.session when valid. */
  const loadSession: RequestHandler = async (req, res, next) => {
    try {
      (res.locals as AuthLocals).client = clientContext(req, config.hashSecret);
      const raw = rawSessionToken(req, config.cookieName);
      if (raw) {
        const session = await auth.resolveSession(raw);
        if (session) (res.locals as AuthLocals).session = session;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  /** 401 for missing, invalid, expired or revoked sessions (fail closed). */
  const requireAuth: RequestHandler = (_req, res, next) => {
    if (!sessionOf(res)) {
      next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
      return;
    }
    next();
  };

  /** 403 unless the signed-in user has one of the roles. */
  const requireRole = (...roles: readonly UserRole[]): RequestHandler => {
    return (_req, res, next) => {
      const session = sessionOf(res);
      if (!session) {
        next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
        return;
      }
      if (!hasRole(session.principal, roles)) {
        next(new HttpError(403, 'forbidden', 'You do not have access to this.'));
        return;
      }
      next();
    };
  };

  /** 403 unless the signed-in user is a delegate with a linked registration. */
  const requireDelegate: RequestHandler = (_req, res, next) => {
    const session = sessionOf(res);
    if (!session) {
      next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
      return;
    }
    if (session.principal.role !== 'delegate' || session.principal.delegateIds.length === 0) {
      next(new HttpError(403, 'forbidden', 'This area is for registered delegates.'));
      return;
    }
    next();
  };

  return { loadSession, requireAuth, requireRole, requireDelegate };
}

/**
 * CSRF defence for cookie sessions: state-changing requests must come from our own origin.
 * SameSite=Lax already blocks cross-site POSTs in modern browsers; this check closes the gap
 * for older clients and for GET-to-POST redirects. Requests without Origin/Referer (curl, tests)
 * are rejected too, so API clients must send an Origin header. A malformed Origin never matches.
 */
export function originCheck(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/+$/, '')));
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const origin = parseOrigin(req.get('origin')) ?? parseOrigin(req.get('referer'));
    if (!origin || !allowed.has(origin)) {
      next(new HttpError(403, 'forbidden_origin', 'Request origin not allowed.'));
      return;
    }
    next();
  };
}

/** The normalised origin of a header value, or undefined when it is absent or not a URL. */
function parseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
