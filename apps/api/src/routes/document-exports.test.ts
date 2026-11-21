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
import { mailConfigFromEnv } from '../mail/config.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

/**
 * The remaining tabs as documents (2026-11-21): the daily reflections, the support requests,
 * the attendance register and the delegate list each download as PDF and Word, admins only,
 * every download audited.
 */
describe.skipIf(!hasDatabase)('tab documents', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let activityId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-23T15:00:00.000Z');

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      mailConfig: mailConfigFromEnv({
        NODE_ENV: 'test',
        MAIL_TRANSPORT: 'memory',
        MAIL_FROM: 'Events <events@example.com>',
        APP_URL: ORIGIN,
      }),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      now: () => now,
    });
  /** A download read as bytes, so the PDF or Word file can be checked. */
  const download = (path: string, cookie = cookies.admin) =>
    request(app())
      .get(`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });

  async function signedIn(key: string, role: 'admin' | 'delegate', email: string) {
    const account = await prisma.userAccount.create({ data: { email, role } });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date('2027-06-01T00:00:00Z'),
        lastSeenAt: now,
      },
    });
    cookies[key] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    const admin = await signedIn('admin', 'admin', `admin-td-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-td-${tag}@example.com`);
    const created = await request(app())
      .post('/api/v1/events')
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin!)
      .send({
        name: `Documents ${tag}`,
        description: 'd',
        eventType: 'training',
        organiser: 'M.Bryan',
        format: 'physical',
        timezone: 'Africa/Lagos',
        location: 'Lagos',
        dates: ['2026-11-23'],
      });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    const dateId = created.body.event.dates[0].id as string;
    const a = await createRegisteredIdentity(prisma, eventId, `dee-td-${tag}@example.com`, {
      name: 'Dee Manager',
      userAccountId: dee.id,
    });
    identityIds.push(a.identity.id);
    await prisma.attendanceRecord.create({
      data: {
        eventId,
        delegateId: a.delegate.id,
        eventDateId: dateId,
        status: 'attended',
        mode: 'physical',
        method: 'qr',
        recordedByUserId: admin.id,
      },
    });
    const activity = await prisma.reflectionActivity.create({
      data: { eventId, eventDateId: dateId, title: 'Day 1 reflection', status: 'published' },
    });
    activityId = activity.id;
    const question = await prisma.reflectionQuestion.create({
      data: { activityId, eventId, order: 1, prompt: 'What stood out today?' },
    });
    await prisma.reflectionResponse.create({
      data: {
        activityId,
        eventId,
        delegateId: a.delegate.id,
        submittedAt: now,
        answers: { create: { questionId: question.id, value: 'The transfer plan.' } },
      },
    });
    await prisma.supportRequest.create({
      data: { eventId, delegateId: a.delegate.id, request: 'Time with my manager' },
    });
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  const paths = () => [
    `/events/${eventId}/reflections/submissions`,
    `/events/${eventId}/support-requests/submissions`,
    `/events/${eventId}/attendance/register`,
    `/events/${eventId}/delegates/register`,
  ];

  it('downloads each tab as a real PDF and a real Word file', async () => {
    for (const path of paths()) {
      const pdf = await download(`${path}.pdf`);
      expect(pdf.status, `${path}.pdf`).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      const word = await download(`${path}.docx`);
      expect(word.status, `${path}.docx`).toBe(200);
      expect(word.headers['content-type']).toContain('wordprocessingml.document');
      expect((word.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    }
    // One day of reflections on its own.
    expect((await download(`${paths()[0]}.pdf?day=${activityId}`)).status).toBe(200);
    expect((await download(`${paths()[0]}.pdf?day=nope`)).status).toBe(404);
    // Each download is audited.
    for (const action of [
      'reflection.exported',
      'support_request.exported',
      'attendance.exported',
      'delegate.list_exported',
    ]) {
      expect(await prisma.auditLog.count({ where: { eventId, action } }), action).toBeGreaterThan(
        0,
      );
    }
  });

  it('refuses a delegate and an unknown format', async () => {
    for (const path of paths()) {
      expect((await download(`${path}.pdf`, cookies.dee)).status, path).toBe(403);
      expect((await download(`${path}.rtf`)).status, path).toBe(404);
    }
  });
});
