import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produces .next/standalone with a minimal node_modules for the Docker image.
  output: 'standalone',
  // Required in a pnpm monorepo so file tracing includes workspace packages.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
};

export default nextConfig;
