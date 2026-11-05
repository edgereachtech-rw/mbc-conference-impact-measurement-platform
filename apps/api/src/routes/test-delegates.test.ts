import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { authConfigFromEnv } from '../auth/config.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import type { PrismaClient } from '../db.js';
import {
  createRegisteredIdentity,
  createTestEvent,
  deleteIdentity,
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

/**
 * Test delegates (decision of 2026-11-05): imported like anyone else, marked by an admin from the
 * list, and kept out of the event's figures unless the event says otherwise. The rule that matters
 * most is the second one, so it is checked against the dashboard, which counts everyone.
 */
describe.skipIf(!hasDatabase)('test delegates', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const mailer = new MemoryMailer();
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const delegates: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-05T12:00:00.000Z');

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      // The sign-in flag is on, as on staging: that must not by itself put test delegates in the
      // figures.
      authConfig: authConfigFromEnv({
        NODE_ENV: 'test',
        APP_URL: ORIGIN,
        AUTH_ALLOW_TEST_REGISTRATIONS: 'true',
      }),
      mailConfig: {
        transport: 'memory' as const,
        from: 'Test <noreply@example.com>',
        contactEmail: 'conference@example.com',
        appUrl: ORIGIN,
        smtp: { host: 'x', port: 25, secure: false },
      },
      allowedOrigins: [ORIGIN],
      now: () => now,
    });

  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, cookie?: string) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? cookies.admin ?? '')
      .send(body);

  async function sessionFor(role: 'delegate' | 'admin', email: string) {
    const account = await prisma.userAccount.create({ data: { email, role } });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + 86_400_000),
        lastSeenAt: now,
      },
    });
    return { account, cookie: `mbc_session=${token}` };
  }

  /** The dashboard's registered count, wherever the response nests it. */
  const registeredOf = (body: { dashboard: Record<string, unknown> }) => {
    const d = body.dashboard;
    const nested = d.delegates as { registered?: number } | undefined;
    return nested?.registered ?? (d.registered as number);
  };

  beforeAll(async () => {
    prisma = testPrisma();
    const event = await createTestEvent(prisma);
    eventId = event.id;
    await prisma.event.update({ where: { id: eventId }, data: { status: 'active' } });
    cookies.admin = (await sessionFor('admin', `admin-td-${tag}@example.com`)).cookie;
    cookies.delegate = (await sessionFor('delegate', `del-td-${tag}@example.com`)).cookie;
    for (const [name, status] of [
      ['Ada', 'active'],
      ['Ben', 'active'],
      ['Cal', 'active'],
      ['Dee', 'cancelled'],
    ] as const) {
      const r = await createRegisteredIdentity(prisma, eventId, `${name}-td-${tag}@example.com`, {
        name,
        registrationStatus: status,
      });
      identityIds.push(r.identity.id);
      delegates[name] = r.delegate.id;
    }
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('marks only active registrations as test, skips the rest, and audits counts only', async () => {
    const marked = await call('post', `/events/${eventId}/delegates/test`, {
      delegateIds: [delegates.Ada, delegates.Ben, delegates.Dee],
      test: true,
    });
    expect(marked.status, marked.text).toBe(200);
    // Dee is cancelled: a bulk mark never revives a cancellation.
    expect(marked.body).toEqual({ updated: 2, skipped: 1 });
    const rows = await prisma.delegate.findMany({
      where: { id: { in: Object.values(delegates) } },
      select: { name: true, registrationStatus: true },
      orderBy: { name: 'asc' },
    });
    expect(rows.map((r) => [r.name, r.registrationStatus])).toEqual([
      ['Ada', 'test'],
      ['Ben', 'test'],
      ['Cal', 'active'],
      ['Dee', 'cancelled'],
    ]);

    const audits = await prisma.auditLog.findMany({
      where: { eventId, action: 'delegate.test_marked' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.newValue).toMatchObject({ to: 'test', updated: 2, skipped: 1 });
    expect(JSON.stringify(audits[0]!.newValue)).not.toContain('@example.com');
  });

  it('is for admins only', async () => {
    const asDelegate = await call(
      'post',
      `/events/${eventId}/delegates/test`,
      { delegateIds: [delegates.Cal], test: true },
      cookies.delegate,
    );
    expect(asDelegate.status).toBe(403);
    expect((await call('post', `/events/${eventId}/delegates/test`, {}, '')).status).toBe(401);
  });

  it('keeps test delegates out of the figures until the event says otherwise', async () => {
    // Ada and Ben are test; Cal is the only real active registration.
    const before = await call('get', `/events/${eventId}/dashboard`);
    expect(before.status, before.text).toBe(200);
    expect(registeredOf(before.body)).toBe(1);

    const detail = await call('get', `/events/${eventId}`);
    expect(detail.body.event.countTestDelegates).toBe(false);

    const on = await call('patch', `/events/${eventId}`, { countTestDelegates: true });
    expect(on.status, on.text).toBe(200);
    expect(on.body.event.countTestDelegates).toBe(true);

    const after = await call('get', `/events/${eventId}/dashboard`);
    expect(registeredOf(after.body)).toBe(3);

    // And off again: the switch is reversible without touching any registration.
    await call('patch', `/events/${eventId}`, { countTestDelegates: false });
    expect(registeredOf((await call('get', `/events/${eventId}/dashboard`)).body)).toBe(1);
  });

  it('marks test delegates back to real ones', async () => {
    const back = await call('post', `/events/${eventId}/delegates/test`, {
      delegateIds: [delegates.Ada, delegates.Ben, delegates.Cal],
      test: false,
    });
    expect(back.body).toEqual({ updated: 2, skipped: 1 });
    expect(registeredOf((await call('get', `/events/${eventId}/dashboard`)).body)).toBe(3);
  });
});
