import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Database tests talk to a real PostgreSQL; allow for cold connections and slow CI runners.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
