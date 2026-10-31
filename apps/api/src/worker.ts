// Loads .env for host-run development (no-op in Docker and CI, where the environment is injected).
import 'dotenv/config';

import { captureException, flushSentry, initSentry } from './lib/sentry.js';

initSentry('worker');

const { APP_NAME } = await import('@mbc/shared');
const { authConfigFromEnv } = await import('./auth/config.js');
const { mailConfigFromEnv } = await import('./mail/config.js');
const { PgBoss } = await import('pg-boss');
const { startHeartbeat } = await import('./lib/heartbeat.js');
const { createLogger } = await import('./lib/logger.js');
const { getPrisma } = await import('./db.js');
const { createMailer } = await import('./mail/index.js');
const { registerTransferPlanReminders } = await import('./reminders/transfer-plans.js');

const logger = createLogger(undefined, undefined).child({ service: 'worker' });

// Same early configuration check as the API: the worker sends mail and shares the auth settings.
try {
  authConfigFromEnv();
  mailConfigFromEnv();
} catch (error) {
  logger.fatal(
    { reason: error instanceof Error ? error.message : 'unknown' },
    'configuration invalid; refusing to start',
  );
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  logger.error('DATABASE_URL is not set; the worker cannot start');
  process.exit(1);
}

const boss = new PgBoss({ connectionString });

boss.on('error', (error: Error) => {
  logger.error({ err: error }, 'pg-boss error');
  captureException(error);
});

let heartbeat: { stop(): void } | undefined;

async function main() {
  await boss.start();
  await registerTransferPlanReminders({
    boss,
    prisma: () => getPrisma(),
    mailer: createMailer(mailConfigFromEnv()),
    mailConfig: mailConfigFromEnv(),
    appUrl: authConfigFromEnv().appUrl,
    logger,
  });

  const heartbeatUrl = process.env.HEALTHCHECKS_WORKER_URL;
  if (heartbeatUrl) {
    heartbeat = startHeartbeat({
      url: heartbeatUrl,
      intervalSeconds: Number(process.env.HEARTBEAT_INTERVAL_SECONDS ?? 120) || 120,
      logger,
    });
  } else {
    logger.info('HEALTHCHECKS_WORKER_URL not set; heartbeat disabled');
  }

  logger.info({ app: APP_NAME }, 'worker ready');
  console.log(`${APP_NAME} worker ready`);
}

async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'stopping worker');
  heartbeat?.stop();
  await boss.stop({ graceful: true });
  await flushSentry();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
  captureException(reason);
});

main().catch(async (error: unknown) => {
  logger.error({ err: error }, 'worker failed to start');
  captureException(error);
  await flushSentry();
  process.exit(1);
});
