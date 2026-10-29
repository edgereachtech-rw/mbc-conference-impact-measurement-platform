import { Router } from 'express';

import type { AuthConfig } from '../auth/config.js';
import { createAuthMiddleware, originCheck } from '../auth/middleware.js';
import type { AuthService } from '../auth/service.js';
import type { PrismaClient } from '../db.js';
import type { ConflictResolver } from '../imports/resolution.js';
import type { ImportService } from '../imports/service.js';
import { authRouter } from './auth.js';
import { delegateRouter } from './delegates.js';
import { eventRouter } from './events.js';
import { importRouter } from './imports.js';
import { staffRouter } from './staff.js';

export interface ApiDeps {
  prisma: () => PrismaClient;
  auth: AuthService;
  config: AuthConfig;
  imports: ImportService;
  resolver: ConflictResolver;
  /** Extra origins allowed to make state-changing requests (dev servers). */
  allowedOrigins?: readonly string[];
}

/** Everything under /api/v1: origin check, session loading, then the resource routers. */
export function apiRouter(deps: ApiDeps): Router {
  const middleware = createAuthMiddleware(deps.auth, deps.config);
  const router = Router();

  router.use(
    originCheck([deps.config.appUrl, ...(deps.allowedOrigins ?? deps.config.allowedOrigins)]),
  );
  router.use(middleware.loadSession);

  router.use('/auth', authRouter({ auth: deps.auth, config: deps.config, middleware }));
  router.use(delegateRouter({ prisma: deps.prisma, middleware }));
  router.use(staffRouter({ prisma: deps.prisma, auth: deps.auth, middleware }));
  router.use(importRouter({ imports: deps.imports, resolver: deps.resolver, middleware }));
  router.use(eventRouter({ prisma: deps.prisma, middleware }));

  return router;
}
