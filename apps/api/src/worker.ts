import { APP_NAME } from '@mbc/shared';
import { PgBoss } from 'pg-boss';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set; the worker cannot start.');
  process.exit(1);
}

const boss = new PgBoss({ connectionString });

boss.on('error', (error: Error) => {
  console.error('pg-boss error', error);
});

async function main() {
  await boss.start();
  // Jobs are registered here in later increments (reminders, exports, heartbeat).
  console.log(`${APP_NAME} worker ready`);
}

async function shutdown(signal: NodeJS.Signals) {
  console.log(`received ${signal}, stopping worker`);
  await boss.stop({ graceful: true });
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error: unknown) => {
  console.error('worker failed to start', error);
  process.exit(1);
});
