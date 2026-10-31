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
  deleteIdentity,
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('GET /events/:eventId/dashboard', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const now = new Date('2026-11-05T10:00:00.000Z');

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      now: () => now,
    });
  const get = (path: string, cookie = cookies.admin) =>
    request(app())
      .get(`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '');
  const call = (method: 'post' | 'put', path: string, body: object, cookie = cookies.admin) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);

  async function signedIn(role: 'admin' | 'delegate', email: string) {
    const account = await prisma.userAccount.create({ data: { email, role } });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    cookies[role] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    const tag = randomUUID().slice(0, 8);
    await signedIn('admin', `admin-dash-${tag}@example.com`);
    const delegateAccount = await signedIn('delegate', `del-dash-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Dash ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12', '2026-11-13'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    // Three registrations: one signed up (physical), one not (virtual), one cancelled.
    const a = await createRegisteredIdentity(prisma, eventId, `del-dash-${tag}@example.com`, {
      name: 'Dee Legate',
      attendanceFormat: 'physical',
      userAccountId: delegateAccount.id,
    });
    const b = await createRegisteredIdentity(prisma, eventId, `other-dash-${tag}@example.com`, {
      name: 'Ada Other',
      attendanceFormat: 'virtual',
    });
    const c = await createRegisteredIdentity(prisma, eventId, `gone-dash-${tag}@example.com`, {
      name: 'Gone Away',
      registrationStatus: 'cancelled',
    });
    identityIds.push(a.identity.id, b.identity.id, c.identity.id);
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('summarises the event for admins only: delegates, stages with counts, messages', async () => {
    expect((await get(`/events/${eventId}/dashboard`, '')).status).toBe(401);
    expect((await get(`/events/${eventId}/dashboard`, cookies.delegate)).status).toBe(403);
    expect((await get(`/events/${randomUUID()}/dashboard`)).status).toBe(404);
    expect((await get(`/events/not-an-id/dashboard`)).status).toBe(404);

    // Nothing configured yet: four stages, all disabled, no summaries.
    const empty = await get(`/events/${eventId}/dashboard`);
    expect(empty.status, empty.text).toBe(200);
    expect(empty.body.dashboard).toMatchObject({
      event: { id: eventId, status: 'draft', days: 2, sessions: 0, timezone: 'Africa/Lagos' },
      delegates: {
        registered: 2,
        signedUp: 1,
        invited: 0,
        physical: 1,
        virtual: 1,
        byStatus: { active: 2, cancelled: 1, pending: 0, duplicate: 0, test: 0 },
      },
      messages: { sent: 0, recipients: 0, delivered: 0, failed: 0, last: null },
      generatedAt: now.toISOString(),
    });
    expect(empty.body.dashboard.stages.map((s: { stage: string }) => s.stage)).toEqual([
      'pre_conference',
      'during_conference',
      'end_of_conference',
      'follow_up',
    ]);
    expect(empty.body.dashboard.stages[0]).toMatchObject({
      enabled: false,
      window: 'hidden',
      questions: 0,
      summary: null,
      nonCompleters: 0,
    });

    // One open stage with a question and one submitted response.
    const stageUrl = `/events/${eventId}/assessments/pre_conference`;
    const q = await call('post', `${stageUrl}/questions`, { prompt: 'Ready?', type: 'yes_no' });
    expect(q.status, q.text).toBe(201);
    const opened = await call('put', stageUrl, {
      enabled: true,
      status: 'open',
      opensAt: '2026-11-01T09:00:00+01:00',
      closesAt: '2026-11-11T23:59:00+01:00',
    });
    expect(opened.status, opened.text).toBe(200);
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const answered = await call(
      'put',
      `/me/events/${eventId}/assessments/pre_conference`,
      { answers: { [q.body.question.id]: true }, submit: true },
      cookies.delegate,
    );
    expect(answered.status, answered.text).toBe(200);

    const live = await get(`/events/${eventId}/dashboard`);
    expect(live.status, live.text).toBe(200);
    expect(live.body.dashboard.event.status).toBe('active');
    expect(live.body.dashboard.stages[0]).toMatchObject({
      enabled: true,
      status: 'open',
      window: 'open',
      questions: 1,
      summary: { invited: 2, started: 1, submitted: 1, responseRate: 50, knowledge: null },
      nonCompleters: 1,
    });
    expect(live.body.dashboard.stages[0].summary).not.toHaveProperty('statements');
  });
});
