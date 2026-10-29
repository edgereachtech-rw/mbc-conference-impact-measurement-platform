// Loads .env for host-run development (no-op in Docker and CI, where the environment is injected).
import 'dotenv/config';

import { initSentry } from './lib/sentry.js';

initSentry('api');

const { APP_NAME } = await import('@mbc/shared');
const { createApp } = await import('./app.js');
const { authConfigFromEnv } = await import('./auth/config.js');
const { getLogger } = await import('./lib/logger.js');
const { mailConfigFromEnv } = await import('./mail/config.js');

const logger = getLogger();
const port = Number(process.env.PORT ?? 4000);

// Fail early and safely: an invalid or contradictory configuration (insecure cookies in production,
// a placeholder secret, no proxy trust decision, a test mail transport) never serves a request.
// The messages name variables, never values.
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

createApp({ logger }).listen(port, () => {
  logger.info({ port, app: APP_NAME }, 'api listening');
});
