import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { authConfigFromEnv } from '../auth/config.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, testPrisma } from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('GET /events (admin import screen)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  const accountIds: string[] = [];
  const cookies: Record<string, string> = {};

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
    });

  async function signedIn(role: 'delegate' | 'admin' | 'analyst' | 'support' | 'speaker') {
    const account = await prisma.userAccount.create({
      data: { email: `${role}-${randomUUID().slice(0, 8)}@example.com`, role },
    });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    cookies[role] = `mbc_session=${token}`;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    for (const role of ['admin', 'delegate', 'analyst', 'support', 'speaker'] as const) {
      await signedIn(role);
    }
  });
  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('lists events with id, name, dates and status for admins only', async () => {
    const server = app();
    expect((await request(server).get('/api/v1/events')).status).toBe(401);
    for (const role of ['delegate', 'analyst', 'support', 'speaker'] as const) {
      const res = await request(server)
        .get('/api/v1/events')
        .set('Cookie', cookies[role] ?? '');
      expect(res.status, role).toBe(role === 'analyst' || role === 'support' ? 401 : 403);
    }
    const res = await request(server)
      .get('/api/v1/events')
      .set('Cookie', cookies.admin ?? '');
    expect(res.status).toBe(200);
    const mine = (res.body.events as Array<Record<string, unknown>>).find((e) => e.id === eventId);
    expect(mine).toMatchObject({ status: 'draft' });
    expect(Object.keys(mine ?? {}).sort()).toEqual(
      [
        'endsOn',
        'eventType',
        'format',
        'id',
        'name',
        'slug',
        'startsOn',
        'status',
        'timezone',
      ].sort(),
    );
    // One event by id, with theme and location for the detail page; unknown ids are 404.
    const one = await request(server)
      .get(`/api/v1/events/${eventId}`)
      .set('Cookie', cookies.admin ?? '');
    expect(one.status).toBe(200);
    expect(one.body.event).toMatchObject({ id: eventId, status: 'draft', theme: null });
    expect(
      (
        await request(server)
          .get(`/api/v1/events/${randomUUID()}`)
          .set('Cookie', cookies.admin ?? '')
      ).status,
    ).toBe(404);
    expect(
      (
        await request(server)
          .get(`/api/v1/events/${eventId}`)
          .set('Cookie', cookies.delegate ?? '')
      ).status,
    ).toBe(403);
  });
});
