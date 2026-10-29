import { healthResponseSchema } from '@mbc/shared';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { authConfigFromEnv } from './auth/config.js';
import { HttpError } from './lib/errors.js';

const silent = pino({ level: 'silent' });

describe('health endpoints', () => {
  it.each(['/health', '/api/health'])(
    'GET %s returns status ok and an ISO timestamp',
    async (path) => {
      const response = await request(createApp({ logger: silent })).get(path);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
    },
  );
});

describe('readiness', () => {
  it('returns 200 when the database answers', async () => {
    const app = createApp({ logger: silent, checkDatabase: async () => undefined });
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
  });

  it('returns 503 when the database is down', async () => {
    const app = createApp({
      logger: silent,
      checkDatabase: async () => {
        throw new Error('connection refused');
      },
    });
    const response = await request(app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'error', checks: { database: 'down' } });
  });

  it('returns 503 when the database check hangs', async () => {
    const app = createApp({
      logger: silent,
      readinessTimeoutMs: 20,
      checkDatabase: () => new Promise(() => undefined),
    });
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(503);
  });
});

describe('request id and error responses', () => {
  it('404 is JSON with code, message and requestId, echoed in X-Request-Id', async () => {
    const response = await request(createApp({ logger: silent })).get('/api/v1/nothing-here');
    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body).toEqual({
      error: {
        code: 'not_found',
        message: 'No route for GET /api/v1/nothing-here',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('honours a sane incoming X-Request-Id and replaces a bad one', async () => {
    const app = createApp({ logger: silent });
    const good = await request(app).get('/nope').set('X-Request-Id', 'client-abc-123');
    expect(good.headers['x-request-id']).toBe('client-abc-123');
    const bad = await request(app).get('/nope').set('X-Request-Id', 'x y <script>');
    expect(bad.headers['x-request-id']).not.toBe('x y <script>');
  });

  it('malformed JSON gives a 400 JSON body', async () => {
    const response = await request(createApp({ logger: silent }))
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{bad json');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_json');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('unhandled errors give 500 JSON without stack trace in production and report to error tracking', async () => {
    const captureException = vi.fn();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = createApp({
        logger: silent,
        captureException,
        // A production env is validated at startup (see auth/config.test.ts); here only the
        // error-handling behaviour of production is under test.
        authConfig: authConfigFromEnv({ NODE_ENV: 'test' }),
        production: true,
        extraRoutes: (a) => {
          a.get('/boom', () => {
            throw new Error('database password is hunter2 for ada@example.com');
          });
        },
      });
      const response = await request(app).get('/boom');
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('internal_error');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('ada@example.com');
      expect(text).not.toContain('at ');
      expect(text).not.toMatch(/\.ts:\d+/);
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException.mock.calls[0]?.[1]).toEqual({
        requestId: response.headers['x-request-id'],
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('HttpError carries its status and code to the client', async () => {
    const app = createApp({
      logger: silent,
      extraRoutes: (a) => {
        a.get('/teapot', () => {
          throw new HttpError(422, 'validation_failed', 'email is required');
        });
      },
    });
    const response = await request(app).get('/teapot');
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'validation_failed',
      message: 'email is required',
    });
  });
});
