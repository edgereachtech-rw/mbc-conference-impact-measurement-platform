import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// A placeholder keeps `prisma generate` (and therefore lint/typecheck/build) working on machines
// without a database. Every command that actually connects fails clearly against "unset".
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://unset:unset@127.0.0.1:5432/unset?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Idempotent: safe to run on every deploy. Production images run `node dist/seed.js` instead.
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
