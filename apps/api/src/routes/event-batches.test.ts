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
 * Batches (decision 2026-11-19): one event, several days, each batch of delegates on one day.
 * A delegate in a batch has that day alone for the check-in code, the attendance list, the
 * welcome pack and their own view; a delegate in no batch keeps every day.
 */
describe.skipIf(!hasDatabase)('event batches', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const dateIds: string[] = [];
  const mailer = new MemoryMailer();
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-05T09:00:00.000Z');
  const mailConfig = {
    transport: 'memory' as const,
    from: 'Test <noreply@example.com>',
    contactEmail: 'conference@mbryanconsultinggroup.com',
    appUrl: ORIGIN,
    smtp: { host: 'x', port: 25, secure: false },
  };
  let batch1 = '';
  let batch2 = '';
  let dee = '';
  let bo = '';
  let cy = '';

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      mailConfig,
      allowedOrigins: [ORIGIN],
      now: () => now,
    });

  const call = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    cookie?: string,
  ) =>
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

  beforeAll(async () => {
    prisma = testPrisma();
    const event = await createTestEvent(prisma);
    eventId = event.id;
    await prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'active',
        eventType: 'training',
        startsOn: new Date('2026-11-23T00:00:00.000Z'),
        endsOn: new Date('2026-11-25T00:00:00.000Z'),
        timezone: 'Africa/Lagos',
      },
    });
    for (const day of ['2026-11-23', '2026-11-24', '2026-11-25']) {
      const row = await prisma.eventDate.create({
        data: { eventId, date: new Date(`${day}T00:00:00.000Z`) },
        select: { id: true },
      });
      dateIds.push(row.id);
    }
    cookies.admin = (await sessionFor('admin', `admin-b-${tag}@example.com`)).cookie;
    const deeSession = await sessionFor('delegate', `dee-b-${tag}@example.com`);
    cookies.dee = deeSession.cookie;
    const deeReg = await createRegisteredIdentity(prisma, eventId, `dee-b-${tag}@example.com`, {
      name: 'Dee Batch',
      userAccountId: deeSession.account.id,
    });
    identityIds.push(deeReg.identity.id);
    dee = deeReg.delegate.id;
    const boReg = await createRegisteredIdentity(prisma, eventId, `bo-b-${tag}@example.com`, {
      name: 'Bo Batch',
    });
    identityIds.push(boReg.identity.id);
    bo = boReg.delegate.id;
    const cyReg = await createRegisteredIdentity(prisma, eventId, `cy-b-${tag}@example.com`, {
      name: 'Cy Everyday',
    });
    identityIds.push(cyReg.identity.id);
    cy = cyReg.delegate.id;
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('creates, renames, moves and lists batches on the event’s own days, admin-only', async () => {
    expect((await call('get', `/events/${eventId}/batches`, undefined, cookies.dee)).status).toBe(
      403,
    );
    expect(
      (
        await call('post', `/events/${eventId}/batches`, {
          name: 'Batch 1',
          eventDateId: randomUUID(),
        })
      ).status,
    ).toBe(422);
    const first = await call('post', `/events/${eventId}/batches`, {
      name: 'Batch 1',
      eventDateId: dateIds[0],
    });
    expect(first.status, first.text).toBe(201);
    batch1 = first.body.batch.id;
    expect(first.body.event.batches).toEqual([
      expect.objectContaining({ name: 'Batch 1', date: '2026-11-23', delegates: 0 }),
    ]);
    expect(
      (
        await call('post', `/events/${eventId}/batches`, {
          name: 'batch 1',
          eventDateId: dateIds[1],
        })
      ).body.error.code,
    ).toBe('batch_exists');
    const second = await call('post', `/events/${eventId}/batches`, {
      name: 'Batch 2',
      eventDateId: dateIds[2],
    });
    expect(second.status, second.text).toBe(201);
    batch2 = second.body.batch.id;
    // Moved to the 24th and renamed; the list keeps day order.
    const moved = await call('patch', `/events/${eventId}/batches/${batch2}`, {
      eventDateId: dateIds[1],
      name: 'Batch 2 (Tuesday)',
    });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.batches.map((b: { name: string; date: string }) => [b.name, b.date])).toEqual(
      [
        ['Batch 1', '2026-11-23'],
        ['Batch 2 (Tuesday)', '2026-11-24'],
      ],
    );
    expect(
      await prisma.auditLog.count({
        where: { eventId, action: { in: ['event.batch_created', 'event.batch_updated'] } },
      }),
    ).toBe(3);
  });

  it('puts delegates in a batch by hand and lists them by batch', async () => {
    const put = await call('patch', `/delegates/${dee}`, { batchId: batch1 });
    expect(put.status, put.text).toBe(200);
    expect(put.body.delegate.batchId).toBe(batch1);
    expect(
      (await call('patch', `/delegates/${bo}`, { batchId: randomUUID() })).body.error.code,
    ).toBe('batch_not_in_event');
    await call('patch', `/delegates/${bo}`, { batchId: batch2 });
    // Added by hand straight into a batch.
    const added = await call('post', `/events/${eventId}/delegates`, {
      name: 'Ada Added',
      email: `ada-b-${tag}@example.com`,
      attendanceFormat: 'physical',
      batchId: batch2,
    });
    expect(added.status, added.text).toBe(201);
    expect(added.body.delegate.batch).toEqual({ id: batch2, name: 'Batch 2 (Tuesday)' });
    identityIds.push(
      (await prisma.delegate.findUniqueOrThrow({ where: { id: added.body.delegate.id } }))
        .identityId!,
    );
    const inBatch2 = await call('get', `/events/${eventId}/delegates?batch=${batch2}`);
    expect(inBatch2.body.delegates.map((d: { name: string }) => d.name).sort()).toEqual([
      'Ada Added',
      'Bo Batch',
    ]);
    const detail = await call('get', `/events/${eventId}`);
    expect(detail.body.event.batches.map((b: { delegates: number }) => b.delegates)).toEqual([
      1, 2,
    ]);
  });

  it('gives each day its own delegates: attendance lists, codes, the pack and the delegate’s view', async () => {
    // The 23rd lists Dee and Cy (every day); the 24th lists Bo, Ada and Cy.
    const day1 = await call('get', `/events/${eventId}/attendance/dates/${dateIds[0]}`);
    expect(day1.status, day1.text).toBe(200);
    expect(
      day1.body.rows.map((r: { delegate: { name: string } }) => r.delegate.name).sort(),
    ).toEqual(['Cy Everyday', 'Dee Batch']);
    expect(day1.body.counts.registered).toBe(2);
    const day2 = await call('get', `/events/${eventId}/attendance/dates/${dateIds[1]}`);
    expect(
      day2.body.rows.map((r: { delegate: { name: string } }) => r.delegate.name).sort(),
    ).toEqual(['Ada Added', 'Bo Batch', 'Cy Everyday']);
    const overview = await call('get', `/events/${eventId}/attendance`);
    expect(
      overview.body.overview.dates.map(
        (d: { counts: { registered: number } }) => d.counts.registered,
      ),
    ).toEqual([2, 3, 1]);

    // Dee sees one day, with one code; her event card says which day is hers.
    const mine = await call('get', `/me/events/${eventId}/attendance`, undefined, cookies.dee);
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.attendance.dates.map((d: { date: string }) => d.date)).toEqual(['2026-11-23']);
    const events = await call('get', '/me/events', undefined, cookies.dee);
    const card = events.body.events.find((e: { id: string }) => e.id === eventId);
    expect(card.registration.batch).toEqual({ id: batch1, name: 'Batch 1', date: '2026-11-23' });

    // The welcome pack carries one code for Dee, three for Cy.
    mailer.sent.length = 0;
    const sent = await call('post', `/events/${eventId}/onboarding/send`, {
      scope: 'not_signed_in',
    });
    expect(sent.status, sent.text).toBe(201);
    const toDee = mailer.sent.find((m) => m.to.startsWith('dee-b-'))!;
    const toCy = mailer.sent.find((m) => m.to.startsWith('cy-b-'))!;
    expect(toDee.attachments).toHaveLength(1);
    expect(toDee.text).toContain('YOUR CHECK-IN CODE\n');
    expect(toCy.attachments).toHaveLength(3);

    // Closing the 23rd marks absent only those who were due that day and did not come.
    const closed = await call('post', `/events/${eventId}/attendance/dates/${dateIds[0]}/close`, {
      markAbsent: true,
    });
    expect(closed.status, closed.text).toBe(200);
    const absent = await prisma.attendanceRecord.findMany({
      where: { eventId, eventDateId: dateIds[0], status: 'absent' },
      select: { delegateId: true },
    });
    expect(absent.map((a) => a.delegateId).sort()).toEqual([cy, dee].sort());

    // A report for one batch counts its delegates alone.
    const report = await call('get', `/events/${eventId}/reports/dashboard?batch=${batch2}`);
    expect(report.status, report.text).toBe(200);
    expect(report.body.report.population.registered).toBe(2);
    expect(report.body.report.population.description).toContain('in batch Batch 2 (Tuesday)');
  });

  it('refuses to remove a day with batches, and deleting a batch leaves its delegates on every day', async () => {
    const removal = await call('put', `/events/${eventId}/dates`, {
      dates: ['2026-11-23', '2026-11-25'],
    });
    expect(removal.status).toBe(409);
    expect(removal.body.error.code).toBe('dates_have_batches');
    const deleted = await call('delete', `/events/${eventId}/batches/${batch2}`);
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body.batches.map((b: { name: string }) => b.name)).toEqual(['Batch 1']);
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: bo } })).batchId).toBeNull();
    const day3 = await call('get', `/events/${eventId}/attendance/dates/${dateIds[2]}`);
    expect(
      day3.body.rows.map((r: { delegate: { name: string } }) => r.delegate.name).sort(),
    ).toEqual(['Ada Added', 'Bo Batch', 'Cy Everyday']);
  });
});
