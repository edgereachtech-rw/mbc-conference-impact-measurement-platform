import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';

import { authConfigFromEnv, type AuthConfig } from './auth/config.js';
import { AuthService } from './auth/service.js';
import { getPrisma, type PrismaClient } from './db.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { getLogger, type Logger } from './lib/logger.js';
import { pathOnly, requestId } from './lib/request-id.js';
import { captureException } from './lib/sentry.js';
import { createMailer, mailConfigFromEnv, type MailConfig } from './mail/index.js';
import type { Mailer } from './mail/mailer.js';
import { apiRouter } from './routes/index.js';

export interface AppOptions {
  logger?: Logger;
  /** Resolves when the database answers; rejects otherwise. Defaults to `SELECT 1` through Prisma. */
  checkDatabase?: () => Promise<void>;
  /** Milliseconds the readiness check may take before it is reported as down. */
  readinessTimeoutMs?: number;
  /** Test hook to mount extra routes before the 404/error handlers. */
  extraRoutes?: (app: Express) => void;
  captureException?: (error: unknown, context: { requestId: string }) => void;
  /** Database client factory; tests pass their own. Resolved lazily so health checks need no DB. */
  prisma?: () => PrismaClient;
  /** Outgoing mail; tests pass a MemoryMailer. */
  mailer?: () => Mailer;
  authConfig?: AuthConfig;
  mailConfig?: MailConfig;
  /** Extra origins accepted for state-changing requests (the Next dev server, tests). */
  allowedOrigins?: readonly string[];
  /** Express `trust proxy` setting; defaults to TRUST_PROXY from the auth configuration. */
  trustProxy?: string | boolean;
  /** Hides internal error messages; defaults to NODE_ENV === "production". */
  production?: boolean;
  /** Clock override for expiry tests. */
  now?: () => Date;
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
  const prisma = options.prisma ?? (() => getPrisma());
  const authConfig = options.authConfig ?? authConfigFromEnv();
  let mailerInstance: Mailer | undefined;
  const mailer =
    options.mailer ??
    (() => {
      mailerInstance ??= createMailer(options.mailConfig ?? mailConfigFromEnv());
      return mailerInstance;
    });
  let mailConfig: MailConfig | undefined = options.mailConfig;
  const auth = new AuthService({
    prisma,
    mailer,
    config: authConfig,
    get mailConfig() {
      mailConfig ??= mailConfigFromEnv();
      return mailConfig;
    },
    logger,
    now: options.now,
  });

  const app = express();
  app.disable('x-powered-by');
  // Forwarded headers are honoured only from the proxy network named by TRUST_PROXY (false = none).
  app.set('trust proxy', options.trustProxy ?? authConfig.trustProxy);

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
        // pino-http hands the serializer a wrapper whose `raw` is the Node response.
        res: (res: { statusCode?: number; raw?: { statusCode?: number } }) => ({
          statusCode: res.raw?.statusCode ?? res.statusCode ?? null,
        }),
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

  app.use(
    '/api/v1',
    apiRouter({
      prisma,
      auth,
      config: authConfig,
      allowedOrigins: options.allowedOrigins ?? authConfig.allowedOrigins,
    }),
  );

  options.extraRoutes?.(app);

  app.use(notFoundHandler);
  app.use(
    errorHandler({
      captureException: options.captureException ?? captureException,
      production: options.production ?? authConfig.production,
    }),
  );

  return app;
}
