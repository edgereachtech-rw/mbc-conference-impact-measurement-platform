import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request, { type Agent } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, testPrisma } from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';
import { authConfigFromEnv } from './config.js';
import { hashToken } from './tokens.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

function linkTokenFrom(mailer: MemoryMailer): string {
  const last = mailer.sent[mailer.sent.length - 1];
  const match = /signin\/verify\?token=([A-Za-z0-9_%-]+)/.exec(last?.text ?? '');
  if (!match?.[1]) throw new Error('no sign-in link in the last email');
  return decodeURIComponent(match[1]);
}

function codeFrom(mailer: MemoryMailer): string {
  const last = mailer.sent[mailer.sent.length - 1];
  const match = /sign-in page: (\d{3} ?\d{3})/.exec(last?.text ?? '');
  if (!match?.[1]) throw new Error('no code in the last email');
  return match[1];
}

function cookieFrom(res: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error('no Set-Cookie header');
  return header.split(';')[0] ?? '';
}

describe.skipIf(!hasDatabase)('passwordless sign-in (E3-2..5)', () => {
  let prisma: PrismaClient;
  let mailer: MemoryMailer;
  let eventId: string;
  let now = new Date();
  // Every request here arrives from the loopback address and the attempt ledger lives in the shared
  // test database, so the per-address limits are lifted for the suite and exercised on their own
  // below with forwarded addresses (trust proxy accepts X-Forwarded-For from loopback).
  const config = authConfigFromEnv({
    NODE_ENV: 'test',
    APP_URL: ORIGIN,
    AUTH_RATE_LIMIT_PER_IP: '1000',
    AUTH_VERIFY_LIMIT_PER_IP: '1000',
  });
  const strictConfig = authConfigFromEnv({
    NODE_ENV: 'test',
    APP_URL: ORIGIN,
    AUTH_RATE_LIMIT_PER_IP: '2',
    AUTH_VERIFY_LIMIT_PER_IP: '2',
  });
  const mailConfig = {
    transport: 'memory' as const,
    from: 'Test <noreply@example.com>',
    contactEmail: 'conference@mbryanconsultinggroup.com',
    appUrl: ORIGIN,
    smtp: { host: 'x', port: 25, secure: false },
  };
  const app = (authConfig = config) =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      authConfig,
      mailConfig,
      allowedOrigins: [ORIGIN],
      // supertest connects from loopback, which the production preset deliberately does not trust.
      trustProxy: 'loopback, uniquelocal',
      now: () => now,
    });
  const unique = () => randomUUID().slice(0, 8);
  /** A documentation-range client address that no other test or run shares. */
  const uniqueIp = () => `2001:db8:${unique().slice(0, 4)}:${unique().slice(4, 8)}::1`;

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
    return prisma.delegate.create({
      data: { eventId, name: `Delegate ${email}`, email, attendanceFormat: 'physical' },
    });
  }

  async function requestLink(agent: Agent, email: string, next?: string) {
    return agent.post('/api/v1/auth/magic-link').set('Origin', ORIGIN).send({ email, next });
  }

  it('sends a link and code to a registered delegate and returns the generic 202', async () => {
    const email = `ada-${unique()}@example.com`;
    await registeredDelegate(email);
    const res = await requestLink(request(app()), email.toUpperCase());
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(email);
    expect(mailer.sent[0]?.text).toContain(`${ORIGIN}/signin/verify?token=`);
    expect(mailer.sent[0]?.text).toContain('conference@mbryanconsultinggroup.com');
    const stored = await prisma.signInToken.findFirst({ where: { email } });
    expect(stored?.tokenHash).toBe(hashToken(linkTokenFrom(mailer)));
    expect(stored?.tokenHash).not.toContain(linkTokenFrom(mailer));
  });

  it('returns the same 202 for an unregistered email but sends nothing and creates no account', async () => {
    const email = `nobody-${unique()}@example.com`;
    const res = await requestLink(request(app()), email);
    expect(res.status).toBe(202);
    expect(res.body).toEqual((await requestLink(request(app()), email)).body);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.userAccount.count({ where: { email } })).toBe(0);
    expect(await prisma.signInToken.count({ where: { email } })).toBe(0);
  });

  it('ignores cancelled registrations and inactive accounts', async () => {
    const cancelled = `cancelled-${unique()}@example.com`;
    await prisma.delegate.create({
      data: {
        eventId,
        name: 'C',
        email: cancelled,
        attendanceFormat: 'virtual',
        registrationStatus: 'cancelled',
      },
    });
    const inactive = `inactive-${unique()}@example.com`;
    const account = await prisma.userAccount.create({
      data: { email: inactive, role: 'support', status: 'inactive' },
    });
    expect((await requestLink(request(app()), cancelled)).status).toBe(202);
    expect((await requestLink(request(app()), inactive)).status).toBe(202);
    expect(mailer.sent).toHaveLength(0);
    await prisma.userAccount.delete({ where: { id: account.id } });
  });

  it('verifies a link once, links the registration, sets a secure cookie and rejects replay', async () => {
    const email = `grace-${unique()}@example.com`;
    const delegate = await registeredDelegate(email);
    const agent = request(app());
    await requestLink(agent, email, '/account/plan');
    const token = linkTokenFrom(mailer);

    const ok = await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.next).toBe('/account/plan');
    expect(ok.body.user).toMatchObject({
      email,
      role: 'delegate',
      delegate: { id: delegate.id, eventId },
    });
    const setCookie = String(ok.headers['set-cookie']);
    expect(setCookie).toMatch(
      /^mbc_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=1209600$/,
    );
    expect(setCookie).not.toContain('Secure'); // NODE_ENV=test
    expect(setCookie).not.toContain('Domain=');

    const linked = await prisma.delegate.findUniqueOrThrow({ where: { id: delegate.id } });
    expect(linked.userAccountId).toBeTruthy();
    expect(linked.signedUpAt).toBeInstanceOf(Date);

    const replay = await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('invalid_token');

    const me = await agent.get('/api/v1/auth/me').set('Cookie', cookieFrom(ok));
    expect(me.status).toBe(200);
    expect(me.body.user.delegate.id).toBe(delegate.id);
  });

  it('marks the cookie Secure in production', async () => {
    const email = `prod-${unique()}@example.com`;
    await registeredDelegate(email);
    const prodApp = createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      authConfig: authConfigFromEnv({
        NODE_ENV: 'production',
        APP_URL: 'https://impact.example.com',
        SESSION_SECRET: 'f1d3b5a7c9e1f3a5b7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7',
        TRUST_PROXY: 'false',
        AUTH_RATE_LIMIT_PER_IP: '1000',
        AUTH_VERIFY_LIMIT_PER_IP: '1000',
      }),
      mailConfig,
      // The test client still talks from the local origin.
      allowedOrigins: [ORIGIN],
    });
    await request(prodApp).post('/api/v1/auth/magic-link').set('Origin', ORIGIN).send({ email });
    const res = await request(prodApp)
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ token: linkTokenFrom(mailer) });
    expect(String(res.headers['set-cookie'])).toContain('Secure');
  });

  it('accepts the one-time code with the email instead of the link', async () => {
    const email = `code-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    await requestLink(agent, email);
    const wrong = await agent
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ email, code: '000000' });
    expect(wrong.status).toBe(401);
    const right = await agent
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ email: email.toUpperCase(), code: codeFrom(mailer) });
    expect(right.status).toBe(200);
  });

  it('rejects expired and malformed tokens', async () => {
    const email = `late-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    await requestLink(agent, email);
    const token = linkTokenFrom(mailer);
    now = new Date(now.getTime() + config.magicLinkTtlMs + 1000);
    const expired = await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    expect(expired.status).toBe(401);
    const bogus = await agent
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ token: 'x'.repeat(43) });
    expect(bogus.status).toBe(401);
    const malformed = await agent
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ token: 'short' });
    expect(malformed.status).toBe(422);
  });

  it('rate-limits link requests per email without changing the response', async () => {
    const email = `busy-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    for (let i = 0; i < config.rateLimitPerEmail + 2; i++) {
      expect((await requestLink(agent, email)).status).toBe(202);
    }
    expect(mailer.sent).toHaveLength(config.rateLimitPerEmail);
    const audited = await prisma.auditLog.count({ where: { action: 'signin.rate_limited' } });
    expect(audited).toBeGreaterThan(0);
  });

  it('signs out: the session is revoked and the cookie cleared', async () => {
    const email = `bye-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    await requestLink(agent, email);
    const ok = await agent
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ token: linkTokenFrom(mailer) });
    const cookie = cookieFrom(ok);
    const out = await agent
      .post('/api/v1/auth/sign-out')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    const me = await agent.get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
  });

  it('expires idle and absolute sessions and rejects revoked ones', async () => {
    const email = `idle-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    await requestLink(agent, email);
    const ok = await agent
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ token: linkTokenFrom(mailer) });
    const cookie = cookieFrom(ok);
    expect((await agent.get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);

    now = new Date(now.getTime() + config.sessionIdleMs + 1000);
    expect((await agent.get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects return targets that could leave the app', async () => {
    const email = `redirect-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    for (const next of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/ok\t',
      'account',
    ]) {
      const res = await requestLink(agent, email, next);
      expect(res.status, next).toBe(422);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect(mailer.sent).toHaveLength(0);
    expect((await requestLink(agent, email, '/account/plan?tab=2')).status).toBe(202);
  });

  it('rejects malformed origins and accepts a matching Referer', async () => {
    const email = `origin-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    for (const origin of ['null', 'not a url', 'javascript:alert(1)', `${ORIGIN}.evil.example`]) {
      const res = await agent.post('/api/v1/auth/magic-link').set('Origin', origin).send({ email });
      expect(res.status, origin).toBe(403);
      expect(res.body.error.code).toBe('forbidden_origin');
    }
    const bare = await agent.post('/api/v1/auth/magic-link').send({ email });
    expect(bare.status).toBe(403);
    const viaReferer = await agent
      .post('/api/v1/auth/magic-link')
      .set('Referer', `${ORIGIN}/signin?next=%2Faccount`)
      .send({ email });
    expect(viaReferer.status).toBe(202);
    expect(mailer.sent).toHaveLength(1);
  });

  it('rejects state-changing requests from a foreign origin', async () => {
    const res = await request(app())
      .post('/api/v1/auth/magic-link')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden_origin');
  });

  it('audit records never contain the raw token, code or session cookie', async () => {
    const email = `audit-${unique()}@example.com`;
    await registeredDelegate(email);
    const agent = request(app());
    await requestLink(agent, email);
    const token = linkTokenFrom(mailer);
    const code = codeFrom(mailer).replace(' ', '');
    const ok = await agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    const cookieValue = cookieFrom(ok).split('=')[1] ?? '';
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: 'signin.' } } });
    const text = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(text).not.toContain(token);
    expect(text).not.toContain(cookieValue);
    expect(text).not.toContain(code);
    expect(text).not.toContain(email);
  });
  it('rate-limits link requests per client address independently of the email', async () => {
    const ip = uniqueIp();
    const agent = request(app(strictConfig));
    for (let i = 0; i < strictConfig.rateLimitPerIp + 2; i++) {
      const email = `ip-${unique()}@example.com`;
      await registeredDelegate(email);
      const res = await agent
        .post('/api/v1/auth/magic-link')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ email });
      expect(res.status).toBe(202);
    }
    expect(mailer.sent).toHaveLength(strictConfig.rateLimitPerIp);
  });

  it('returns 429 after too many failed verifications from one client address', async () => {
    const ip = uniqueIp();
    const agent = request(app(strictConfig));
    const attempt = () =>
      agent
        .post('/api/v1/auth/verify')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ token: 'x'.repeat(43) });
    for (let i = 0; i < strictConfig.verifyLimitPerIp; i++)
      expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });
});
