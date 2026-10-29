import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Database tests talk to a real PostgreSQL; allow for cold connections and slow CI runners.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Every database-backed file shares one database (and the sign-in attempt ledger in it), and
    // several tests move the clock. Running files one after another keeps them from observing or
    // purging each other's rows.
    fileParallelism: false,
  },
});
