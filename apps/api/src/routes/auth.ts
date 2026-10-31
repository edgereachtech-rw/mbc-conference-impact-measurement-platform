import { magicLinkRequestSchema, verifyRequestSchema } from '@mbc/shared';
import { Router } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { serializeClearedCookie, serializeSessionCookie } from '../auth/cookies.js';
import {
  clientOf,
  rawSessionToken,
  sessionOf,
  type createAuthMiddleware,
} from '../auth/middleware.js';
import type { AuthService } from '../auth/service.js';
import { validate } from '../lib/validate.js';

interface Deps {
  auth: AuthService;
  config: AuthConfig;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const REQUESTED_MESSAGE =
  'If that email is registered, a sign-in link and code are on their way. Check your inbox and spam folder.';

export function authRouter({ auth, config, middleware }: Deps): Router {
  const router = Router();

  // E3-3 / E3-4: request a magic link (and one-time code). Always 202 to prevent enumeration.
  router.post('/magic-link', validate(magicLinkRequestSchema), async (req, res) => {
    await auth.requestMagicLink(req.body, clientOf(res));
    res.status(202).json({ ok: true, message: REQUESTED_MESSAGE });
  });

  // Verify a link token or an email + code; creates the session cookie.
  router.post('/verify', validate(verifyRequestSchema), async (req, res) => {
    const result = await auth.verify(req.body, clientOf(res));
    res.setHeader(
      'Set-Cookie',
      serializeSessionCookie(result.sessionToken, {
        name: config.cookieName,
        secure: config.cookieSecure,
        maxAgeSeconds: result.sessionMaxAgeSeconds,
        domain: config.cookieDomain,
      }),
    );
    res.json({ ok: true, user: result.user, next: result.next });
  });

  // E3-5: who am I (used by the web shell on every request).
  router.get('/me', middleware.requireAuth, (_req, res) => {
    const session = sessionOf(res);
    res.json({ user: session?.user });
  });

  // Logout: revokes the server-side session and clears the cookie. Idempotent.
  router.post('/sign-out', async (req, res) => {
    const raw = rawSessionToken(req, config.cookieName);
    if (raw) await auth.signOut(raw, clientOf(res));
    res.setHeader(
      'Set-Cookie',
      serializeClearedCookie(config.cookieName, config.cookieSecure, config.cookieDomain),
    );
    res.status(204).end();
  });

  return router;
}
