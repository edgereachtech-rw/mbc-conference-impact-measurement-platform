import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    // userEvent-driven flows (upload, map, preview, confirm) take several seconds on a loaded machine.
    testTimeout: 15_000,
    // Testing Library cleans up rendered trees after each test only when afterEach is global.
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
