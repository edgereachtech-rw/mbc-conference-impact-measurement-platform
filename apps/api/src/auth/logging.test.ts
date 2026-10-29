import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, testPrisma } from '../db/test-helpers.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailer } from '../mail/mailer.js';
import { authConfigFromEnv } from './config.js';

const ORIGIN = 'http://localhost:3000';
const mailConfig = {
  transport: 'memory' as const,
  from: 'Test <noreply@example.com>',
  contactEmail: 'conference@mbryanconsultinggroup.com',
  appUrl: ORIGIN,
  smtp: { host: 'x', port: 25, secure: false },
};

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger(stream, 'debug'), lines };
}

describe('production error responses', () => {
  it('never expose internal messages, stack traces or hosts', async () => {
    const { logger } = captureLogger();
    const app = createApp({
      logger,
      production: true,
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      extraRoutes: (a) => {
        a.get('/boom', () => {
          throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2');
        });
      },
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(res.body.error.requestId).toMatch(/[0-9a-f-]{36}/);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('db.internal');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toMatch(/at .*\.ts:\d+/);
  });
});

describe.skipIf(!hasDatabase)('sensitive values never reach the API log', () => {
  let prisma: PrismaClient;
  let eventId: string;

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
  });
  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.$disconnect();
  });

  it('captures the real sign-in flow and finds no token, code, cookie, link or email', async () => {
    const { logger, lines } = captureLogger();
    const mailer = new MemoryMailer();
    const config = authConfigFromEnv({
      NODE_ENV: 'test',
      APP_URL: ORIGIN,
      AUTH_RATE_LIMIT_PER_IP: '1000',
      AUTH_VERIFY_LIMIT_PER_IP: '1000',
    });
    const app = createApp({
      logger,
      prisma: () => prisma,
      mailer: () => mailer,
      authConfig: config,
      mailConfig,
      allowedOrigins: [ORIGIN],
    });
    const email = `log-${randomUUID().slice(0, 8)}@example.com`;
    const name = `Logged Delegate ${randomUUID().slice(0, 6)}`;
    await prisma.delegate.create({ data: { eventId, name, email, attendanceFormat: 'physical' } });

    const agent = request(app);
    // Validation failure (422), link request, wrong code, link verification, me, sign-out.
    await agent.post('/api/v1/auth/magic-link').set('Origin', ORIGIN).send({ email: 'nope' });
    expect(
      (await agent.post('/api/v1/auth/magic-link').set('Origin', ORIGIN).send({ email })).status,
    ).toBe(202);
    const text = mailer.sent[0]?.text ?? '';
    const link = /https?:\/\/\S+signin\/verify\?token=([A-Za-z0-9_%-]+)/.exec(text);
    const token = decodeURIComponent(link?.[1] ?? '');
    const code = (/sign-in page: (\d{3} ?\d{3})/.exec(text)?.[1] ?? '').replace(' ', '');
    expect(token).toHaveLength(43);
    expect(code).toHaveLength(6);

    await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ email, code: '000000' });
    const ok = await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    expect(ok.status).toBe(200);
    const setCookie = String(ok.headers['set-cookie']);
    const cookieValue = /mbc_session=([^;]+)/.exec(setCookie)?.[1] ?? '';
    expect(cookieValue.length).toBeGreaterThan(20);
    await agent.get('/api/v1/auth/me').set('Cookie', `mbc_session=${cookieValue}`);
    await agent
      .post('/api/v1/auth/sign-out')
      .set('Origin', ORIGIN)
      .set('Cookie', `mbc_session=${cookieValue}`);
    // Replay after sign-out and an unknown token, so failure paths are logged too.
    await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    await agent.get('/api/v1/auth/me').set('Cookie', `mbc_session=${cookieValue}`);

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(5);
    expect(log).not.toContain(token);
    expect(log).not.toContain(decodeURIComponent(token));
    expect(log).not.toContain(cookieValue);
    expect(log).not.toContain(code);
    expect(log).not.toContain('signin/verify?token=');
    expect(log).not.toContain(email);
    expect(log).not.toContain(name);
    expect(log).not.toContain('"cookie"');
    expect(log).not.toContain('"authorization"');
    expect(log).not.toMatch(/\?[a-z]+=/);

    // Diagnostics stay useful: method, safe path, numeric status, duration and a request id.
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const completed = entries.filter((e) => e.msg === 'request completed');
    expect(completed.length).toBeGreaterThanOrEqual(6);
    for (const entry of completed) {
      const req = entry.req as { method: string; path: string; id: string };
      const res = entry.res as { statusCode: unknown };
      expect(req.method).toMatch(/^(GET|POST)$/);
      expect(req.path).toMatch(/^\/api\/v1\/auth\//);
      expect(req.id).toMatch(/[0-9a-f-]{36}/);
      expect(typeof res.statusCode).toBe('number');
      expect(typeof entry.responseTime).toBe('number');
    }
    const statuses = completed.map((e) => (e.res as { statusCode: number }).statusCode);
    expect(statuses).toContain(422);
    expect(statuses).toContain(401);
    expect(statuses).toContain(200);
    expect(statuses).toContain(204);
  });
});
