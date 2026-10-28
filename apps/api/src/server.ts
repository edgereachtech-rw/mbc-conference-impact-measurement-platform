import { initSentry } from './lib/sentry.js';

initSentry('api');

const { APP_NAME } = await import('@mbc/shared');
const { createApp } = await import('./app.js');
const { getLogger } = await import('./lib/logger.js');

const logger = getLogger();
const port = Number(process.env.PORT ?? 4000);

createApp({ logger }).listen(port, () => {
  logger.info({ port, app: APP_NAME }, 'api listening');
});
