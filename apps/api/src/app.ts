import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';

import { getPrisma } from './db.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { getLogger, type Logger } from './lib/logger.js';
import { pathOnly, requestId } from './lib/request-id.js';
import { captureException } from './lib/sentry.js';

export interface AppOptions {
  logger?: Logger;
  /** Resolves when the database answers; rejects otherwise. Defaults to `SELECT 1` through Prisma. */
  checkDatabase?: () => Promise<void>;
  /** Milliseconds the readiness check may take before it is reported as down. */
  readinessTimeoutMs?: number;
  /** Test hook to mount extra routes before the 404/error handlers. */
  extraRoutes?: (app: Express) => void;
  captureException?: (error: unknown, context: { requestId: string }) => void;
}

async function defaultDatabaseCheck(): Promise<void> {
  await getPrisma().$queryRaw`SELECT 1`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Builds the Express application without binding a port, so tests can mount it with supertest. */
export function createApp(options: AppOptions = {}) {
  const logger = options.logger ?? getLogger();
  const checkDatabase = options.checkDatabase ?? defaultDatabaseCheck;
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 2_000;

  const app = express();
  app.disable('x-powered-by');
  // Caddy terminates TLS on the private Docker network; trust only private-range proxies.
  app.set('trust proxy', 'uniquelocal');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id ?? '',
      // Liveness probes every 30 s would drown the log.
      autoLogging: { ignore: (req) => pathOnly(req.url) === '/health' },
      serializers: {
        req: (req: { id?: unknown; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          path: pathOnly(req.url),
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request errored',
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Liveness: the process is up. Does not touch the database (the container healthcheck uses it).
  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Readiness: the API can serve requests, i.e. the database answers. 503 otherwise.
  app.get(['/ready', '/api/ready'], async (req, res) => {
    const time = new Date().toISOString();
    try {
      await withTimeout(checkDatabase(), readinessTimeoutMs);
      res.json({ status: 'ok', checks: { database: 'ok' }, time });
    } catch (error) {
      req.log.warn(
        { reason: error instanceof Error ? error.message : 'unknown' },
        'readiness check failed',
      );
      res.status(503).json({ status: 'error', checks: { database: 'down' }, time });
    }
  });

  options.extraRoutes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler({ captureException: options.captureException ?? captureException }));

  return app;
}
