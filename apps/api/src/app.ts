import express from 'express';

/** Builds the Express application without binding a port, so tests can mount it with supertest. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // /health is used by the container healthcheck; /api/health is the same check reached through
  // the reverse proxy, which forwards only /api/* to this service.
  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  return app;
}
