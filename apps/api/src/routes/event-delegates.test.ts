import { randomUUID } from 'node:crypto';

import { delegateListResponseSchema } from '@mbc/shared';
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

describe.skipIf(!hasDatabase)('GET /events/:eventId/delegates (admin listing)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  let otherEventId: string;
  const accountIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
    });
  async function signedIn(role: 'delegate' | 'admin' | 'speaker' | 'support') {
    const account = await prisma.userAccount.create({
      data: { email: `${role}-${tag}@example.com`, role },
    });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    cookies[role] = `mbc_session=${token}`;
  }
  const list = (query: string, cookie = cookies.admin, target = eventId) =>
    request(app())
      .get(`/api/v1/events/${target}/delegates${query}`)
      .set('Cookie', cookie ?? '');

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    otherEventId = (await createTestEvent(prisma)).id;
    for (const role of ['admin', 'delegate', 'speaker', 'support'] as const) await signedIn(role);
    const people = [
      ['Zara Zed', 'zara', 'Acme', 'physical', 'active', 'Z1'],
      ['Adam Able', 'adam', 'Beta', 'virtual', 'active', 'A1'],
      ['Mia Mid', 'mia', 'Acme', 'virtual', 'pending', 'M1'],
      ['Cal Cancel', 'cal', null, 'physical', 'cancelled', null],
      ['Tess Test', 'tess', 'Gamma', 'physical', 'test', null],
    ] as const;
    for (const [
      name,
      local,
      organisation,
      attendanceFormat,
      registrationStatus,
      externalRegistrationId,
    ] of people) {
      await prisma.delegate.create({
        data: {
          eventId,
          name,
          email: `${local}-${tag}@example.com`,
          organisation,
          attendanceFormat,
          registrationStatus,
          externalRegistrationId,
          registrationSource: externalRegistrationId ? 'eventbrite' : null,
        },
      });
    }
    await prisma.delegate.create({
      data: {
        eventId: otherEventId,
        name: 'Other Event',
        email: `other-${tag}@example.com`,
        attendanceFormat: 'virtual',
      },
    });
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is admin-only and scoped to the event', async () => {
    expect((await list('', '')).status).toBe(401);
    expect((await list('', cookies.delegate)).status).toBe(403);
    expect((await list('', cookies.speaker)).status).toBe(403);
    expect((await list('', cookies.support)).status).toBe(401); // retired role: no session
    expect((await list('', cookies.admin, randomUUID())).status).toBe(404);
    const res = await list('');
    expect(res.status).toBe(200);
    expect(delegateListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.total).toBe(5);
    expect(res.body.delegates.some((d: { name: string }) => d.name === 'Other Event')).toBe(false);
    expect(res.body.counts).toEqual({ active: 2, pending: 1, cancelled: 1, duplicate: 0, test: 1 });
  });

  it('sorts, searches, filters and paginates', async () => {
    const byName = await list('?sort=name&direction=asc');
    expect(byName.body.delegates.map((d: { name: string }) => d.name)).toEqual([
      'Adam Able',
      'Cal Cancel',
      'Mia Mid',
      'Tess Test',
      'Zara Zed',
    ]);
    const desc = await list('?sort=name&direction=desc&pageSize=10');
    expect(desc.body.delegates[0].name).toBe('Zara Zed');
    const search = await list('?q=acme');
    expect(search.body.delegates.map((d: { name: string }) => d.name).sort()).toEqual([
      'Mia Mid',
      'Zara Zed',
    ]);
    expect(search.body.counts.active).toBe(2); // counts stay event-wide
    const byId = await list('?q=A1');
    expect(byId.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Adam Able']);
    const pending = await list('?status=pending');
    expect(pending.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Mia Mid']);
    const virtual = await list('?attendanceFormat=virtual&status=active');
    expect(virtual.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Adam Able']);
    const page2 = await list('?sort=name&pageSize=10&page=2');
    expect(page2.body.delegates).toEqual([]);
    expect(page2.body.total).toBe(5);
    expect((await list('?pageSize=5000')).status).toBe(422);
    expect((await list('?status=ghost')).status).toBe(422);
  });
});
