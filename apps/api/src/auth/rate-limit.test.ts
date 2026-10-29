import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request, { type Agent } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { PrismaClient } from '../db.js';
import {
  createRegisteredIdentity,
  createTestEvent,
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';
import { authConfigFromEnv } from './config.js';
import { AttemptLedger, EMAIL_WINDOW_MS } from './rate-limit.js';
import { hashIdentity } from './tokens.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });
const mailConfig = {
  transport: 'memory' as const,
  from: 'Test <noreply@example.com>',
  contactEmail: 'conference@mbryanconsultinggroup.com',
  appUrl: ORIGIN,
  smtp: { host: 'x', port: 25, secure: false },
};

describe.skipIf(!hasDatabase)('sign-in rate limiting (ledger in PostgreSQL)', () => {
  let prisma: PrismaClient;
  let mailer: MemoryMailer;
  let eventId: string;
  let now = new Date();
  const unique = () => randomUUID().slice(0, 8);
  /** A documentation-range client address that no other test or run shares. */
  const uniqueIp = () => `2001:db8:${unique().slice(0, 4)}:${unique().slice(4, 8)}::1`;

  /**
   * Builds an app with explicit limits. `trusted` models the production topology (requests arrive
   * through a proxy whose X-Forwarded-For is honoured); `false` models a client talking to the API
   * directly, whose forwarded headers must be ignored.
   */
  function build(
    overrides: Record<string, string>,
    trusted: boolean,
    extra: { prisma?: () => PrismaClient; production?: boolean } = {},
  ) {
    const config = authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN, ...overrides });
    const app = createApp({
      logger: silent,
      prisma: extra.prisma ?? (() => prisma),
      mailer: () => mailer,
      authConfig: config,
      mailConfig,
      allowedOrigins: [ORIGIN],
      // supertest connects from loopback; only the "trusted" variant honours forwarded headers.
      trustProxy: trusted ? 'loopback' : false,
      production: extra.production,
      now: () => now,
    });
    return { config, app };
  }

  const HIGH = { AUTH_RATE_LIMIT_PER_EMAIL: '1000', AUTH_RATE_LIMIT_PER_IP: '1000' };

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
  });
  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.$disconnect();
  });
  beforeEach(() => {
    mailer = new MemoryMailer();
    now = new Date();
  });

  async function registeredDelegate(email: string) {
    return (await createRegisteredIdentity(prisma, eventId, email)).delegate;
  }

  function requestLink(agent: Agent, email: string, forwardedFor?: string) {
    const req = agent.post('/api/v1/auth/magic-link').set('Origin', ORIGIN);
    if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
    return req.send({ email });
  }

  it('enforces the per-email limit even when every request comes from a different address', async () => {
    const { app } = build({ ...HIGH, AUTH_RATE_LIMIT_PER_EMAIL: '2' }, true);
    const email = `one-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app);
    for (let i = 0; i < 4; i++) {
      expect((await requestLink(agent, email, uniqueIp())).status).toBe(202);
    }
    expect(mailer.sent).toHaveLength(2);
  });

  it('enforces the per-address limit across different emails (delegates sharing a venue address)', async () => {
    const { app } = build({ ...HIGH, AUTH_RATE_LIMIT_PER_IP: '2' }, true);
    const venue = uniqueIp();
    const agent = request(app);
    for (let i = 0; i < 4; i++) {
      const email = `venue-${unique()}@example.com`;
      await registeredDelegate(email);
      expect((await requestLink(agent, email, venue)).status).toBe(202);
    }
    expect(mailer.sent).toHaveLength(2);
    const limited = await prisma.auditLog.count({ where: { action: 'signin.rate_limited' } });
    expect(limited).toBeGreaterThan(0);
  });

  it('ignores forged forwarded headers unless the request comes through a trusted proxy', async () => {
    const forged = [uniqueIp(), uniqueIp(), uniqueIp()];
    const secret = authConfigFromEnv({ NODE_ENV: 'test' }).hashSecret;

    // Direct client: every request is keyed by the real (loopback) address, whatever it claims.
    const direct = build(HIGH, false);
    const directEmails: string[] = [];
    for (const ip of forged) {
      const email = `direct-${unique()}@example.com`;
      directEmails.push(email);
      await registeredDelegate(email);
      expect((await requestLink(request(direct.app), email, ip)).status).toBe(202);
    }
    const directRows = await prisma.authAttempt.findMany({
      where: { emailHash: { in: directEmails.map((e) => hashIdentity(e, secret)) } },
      select: { ipHash: true },
    });
    expect(directRows).toHaveLength(3);
    expect(new Set(directRows.map((r) => r.ipHash)).size).toBe(1);

    // Behind the trusted proxy the same headers select three different client identities.
    const proxied = build(HIGH, true);
    const proxiedEmails: string[] = [];
    for (const ip of forged) {
      const email = `proxied-${unique()}@example.com`;
      proxiedEmails.push(email);
      await registeredDelegate(email);
      expect((await requestLink(request(proxied.app), email, ip)).status).toBe(202);
    }
    const proxiedRows = await prisma.authAttempt.findMany({
      where: { emailHash: { in: proxiedEmails.map((e) => hashIdentity(e, secret)) } },
      select: { ipHash: true },
    });
    expect(new Set(proxiedRows.map((r) => r.ipHash)).size).toBe(3);
    // Neither set shares an identity with the other, and no plaintext address is stored.
    expect(directRows[0]?.ipHash).not.toBe(proxiedRows[0]?.ipHash);
    expect(Object.keys(directRows[0] ?? {})).not.toContain('email');
  });

  it('counts atomically: a concurrent burst at the threshold sends exactly the limit', async () => {
    const { app } = build({ ...HIGH, AUTH_RATE_LIMIT_PER_EMAIL: '3' }, true);
    const email = `burst-${unique()}@example.com`;
    await registeredDelegate(email);
    const ip = uniqueIp();
    const agent = request(app);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => requestLink(agent, email, ip)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202));
    expect(mailer.sent).toHaveLength(3);
    const secret = authConfigFromEnv({ NODE_ENV: 'test' }).hashSecret;
    expect(
      await prisma.authAttempt.count({ where: { emailHash: hashIdentity(email, secret) } }),
    ).toBe(8);
  });

  it('shares the limit between separate API instances', async () => {
    const a = build({ ...HIGH, AUTH_RATE_LIMIT_PER_EMAIL: '2' }, true);
    const b = build({ ...HIGH, AUTH_RATE_LIMIT_PER_EMAIL: '2' }, true);
    const email = `shared-${unique()}@example.com`;
    await registeredDelegate(email);
    const ip = uniqueIp();
    await requestLink(request(a.app), email, ip);
    await requestLink(request(a.app), email, ip);
    expect(mailer.sent).toHaveLength(2);
    expect((await requestLink(request(b.app), email, ip)).status).toBe(202);
    expect(mailer.sent).toHaveLength(2);
  });

  it('allows requests again once the window has passed', async () => {
    const { app } = build({ ...HIGH, AUTH_RATE_LIMIT_PER_EMAIL: '1' }, true);
    const email = `later-${unique()}@example.com`;
    await registeredDelegate(email);
    const ip = uniqueIp();
    const agent = request(app);
    await requestLink(agent, email, ip);
    await requestLink(agent, email, ip);
    expect(mailer.sent).toHaveLength(1);
    now = new Date(now.getTime() + EMAIL_WINDOW_MS + 1000);
    await requestLink(agent, email, ip);
    expect(mailer.sent).toHaveLength(2);
  });

  it('fails closed when the ledger cannot be reached: nothing is sent and no detail leaks', async () => {
    const broken = () =>
      new Proxy(prisma, {
        get(target, prop, receiver) {
          if (prop === '$transaction') return () => Promise.reject(new Error('ledger unavailable'));
          return Reflect.get(target, prop, receiver);
        },
      });
    const { app } = build(HIGH, true, { prisma: broken, production: true });
    const email = `down-${unique()}@example.com`;
    await registeredDelegate(email);
    const res = await requestLink(request(app), email, uniqueIp());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(JSON.stringify(res.body)).not.toContain('ledger unavailable');
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns 429 with Retry-After once the failed-verification budget of an address is spent', async () => {
    const { app } = build({ ...HIGH, AUTH_VERIFY_LIMIT_PER_IP: '2' }, true);
    const ip = uniqueIp();
    const attempt = () =>
      request(app)
        .post('/api/v1/auth/verify')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ token: 'x'.repeat(43) });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    // Another address is unaffected.
    expect((await attempt().set('X-Forwarded-For', uniqueIp())).status).toBe(401);
  });

  it('answers registered and unregistered addresses with the same body and status', async () => {
    const { app } = build(HIGH, true);
    const known = `known-${unique()}@example.com`;
    await registeredDelegate(known);
    const a = await requestLink(request(app), known, uniqueIp());
    const b = await requestLink(request(app), `nobody-${unique()}@example.com`, uniqueIp());
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    expect(mailer.sent).toHaveLength(1);
  });

  it('purges rows older than the longest window so the ledger cannot grow without bound', async () => {
    const ledger = new AttemptLedger(() => prisma, {
      rateLimitPerEmail: 10,
      rateLimitPerIp: 10,
      verifyLimitPerIp: 10,
    });
    const emailHash = hashIdentity(`purge-${unique()}@example.com`, 'k');
    // Rows are dated in the past and the purge uses the real clock, so nothing another test
    // file is inserting right now can be swept away.
    const wallClock = new Date();
    const stale = new Date(wallClock.getTime() - 61 * 60_000);
    const recent = new Date(wallClock.getTime() - 30 * 60_000);
    await ledger.recordLinkRequest({ emailHash, ipHash: null }, stale);
    await ledger.recordVerifyFailure({ emailHash, ipHash: null }, recent);
    expect(await prisma.authAttempt.count({ where: { emailHash } })).toBe(2);
    await ledger.purgeExpired(wallClock);
    const left = await prisma.authAttempt.findMany({ where: { emailHash } });
    expect(left).toHaveLength(1);
    expect(left[0]?.attemptedAt.getTime()).toBe(recent.getTime());
  });
});
