import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produces .next/standalone with a minimal node_modules for the Docker image.
  output: 'standalone',
  // Required in a pnpm monorepo so file tracing includes workspace packages.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  // The dev server logs incoming request URLs; the emailed link carries its single-use token in the
  // query string, so keep that path out of the terminal. Production (next start) does not log requests.
  logging: { incomingRequests: { ignore: [new RegExp('^/signin/verify')] } },
  // Local development only: the browser calls same-origin /api/* exactly as it does behind Caddy,
  // and the dev server forwards it to the API (API_PROXY_URL=http://127.0.0.1:44444).
  async rewrites() {
    const target = process.env.API_PROXY_URL?.replace(/\/+$/, '');
    if (!target) return [];
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
