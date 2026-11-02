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
 * The privacy notice and its acceptance (backlog E3-7, brief section 6.4). The notice is public
 * so a delegate can read it before handing anything over; acceptance is per version, covers every
 * eligible registration of the identity, and is audited without the notice text.
 */
describe.skipIf(!hasDatabase)('privacy notice and consent (E3-7)', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let otherEventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const noticeIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-05T09:00:00.000Z');

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      now: () => now,
    });

  const call = (method: 'get' | 'post', path: string, body?: object, cookie?: string) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
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
    eventId = (await createTestEvent(prisma)).id;
    otherEventId = (await createTestEvent(prisma)).id;

    const notice = await prisma.consentNotice.create({
      data: {
        document: 'privacy',
        version: `t1-${tag}`,
        title: 'Privacy Information for Delegates',
        headline: 'Your Privacy Matters to Us',
        body: 'First paragraph about what is collected.\n\nSecond paragraph about how it is used.',
        effectiveFrom: new Date('2026-11-04T00:00:00.000Z'),
      },
    });
    noticeIds.push(notice.id);

    const email = `consent-${tag}@example.com`;
    const delegate = await sessionFor('delegate', email);
    cookies.delegate = delegate.cookie;
    // One identity, one account, a registration in each of two events: accepting covers both.
    const registered = await createRegisteredIdentity(prisma, eventId, email, {
      name: 'Dee Legate',
      userAccountId: delegate.account.id,
    });
    identityIds.push(registered.identity.id);
    await prisma.delegate.create({
      data: {
        eventId: otherEventId,
        identityId: registered.identity.id,
        name: 'Dee Legate',
        email,
        attendanceFormat: 'physical',
        registrationStatus: 'active',
        userAccountId: delegate.account.id,
      },
    });
    cookies.admin = (await sessionFor('admin', `admin-consent-${tag}@example.com`)).cookie;
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.consentNotice.deleteMany({ where: { id: { in: noticeIds } } });
    await prisma.$disconnect();
  });

  it('serves the notice to anyone, split into paragraphs', async () => {
    const res = await call('get', '/consent/privacy');
    expect(res.status, res.text).toBe(200);
    expect(res.body.notice.headline).toBe('Your Privacy Matters to Us');
    expect(res.body.notice.paragraphs).toHaveLength(2);
    expect(res.body.notice.paragraphs[0]).toMatch(/what is collected/);
    expect(res.body.notice.version).toBe(`t1-${tag}`);
  });

  it('tells a delegate the notice is outstanding, then records their acceptance for every event', async () => {
    const before = await call('get', '/me/consent', undefined, cookies.delegate);
    expect(before.status).toBe(200);
    expect(before.body.outstanding).toBe(true);
    expect(before.body.acceptedAt).toBeNull();

    const accepted = await call(
      'post',
      '/me/consent',
      { document: 'privacy', version: `t1-${tag}` },
      cookies.delegate,
    );
    expect(accepted.status, accepted.text).toBe(201);
    expect(accepted.body.outstanding).toBe(false);
    expect(accepted.body.acceptedVersion).toBe(`t1-${tag}`);

    // One row per registration, so each event's record carries the consent that covers it.
    const rows = await prisma.consentRecord.findMany({
      where: { version: `t1-${tag}` },
      select: { delegateId: true, acceptedAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.acceptedAt.toISOString()).toBe(now.toISOString());

    const after = await call('get', '/me/consent', undefined, cookies.delegate);
    expect(after.body.outstanding).toBe(false);
    expect(after.body.acceptedAt).toBe(now.toISOString());

    // Accepting twice is not an error and does not duplicate the record.
    const again = await call(
      'post',
      '/me/consent',
      { document: 'privacy', version: `t1-${tag}` },
      cookies.delegate,
    );
    expect(again.status).toBe(201);
    expect(await prisma.consentRecord.count({ where: { version: `t1-${tag}` } })).toBe(2);

    // Scoped to this run: the suite shares a database with every other run of itself.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'consent.accepted', entityType: 'consent_record' },
    });
    const mine = audits.filter((row) => JSON.stringify(row.newValue).includes(tag));
    // Two: the acceptance and the repeat below it. Each action is audited; the record is not
    // duplicated, but pressing accept again is still something that happened.
    expect(mine).toHaveLength(2);
    expect(mine[0]!.newValue).toMatchObject({
      document: 'privacy',
      version: `t1-${tag}`,
      records: 2,
    });
    // The audit records the version and the count, never the wording or anything personal.
    expect(JSON.stringify(mine[0]!.newValue)).not.toMatch(/paragraph|Dee Legate/);
  });

  it('asks again when a newer notice comes into force, and refuses acceptance of an old version', async () => {
    const newer = await prisma.consentNotice.create({
      data: {
        document: 'privacy',
        version: `t2-${tag}`,
        title: 'Privacy Information for Delegates',
        headline: 'Your Privacy Matters to Us',
        body: 'Revised wording.',
        effectiveFrom: new Date('2026-11-05T00:00:00.000Z'),
      },
    });
    noticeIds.push(newer.id);

    const state = await call('get', '/me/consent', undefined, cookies.delegate);
    expect(state.body.notice.version).toBe(`t2-${tag}`);
    expect(state.body.outstanding).toBe(true);
    expect(state.body.acceptedVersion).toBe(`t1-${tag}`);

    const stale = await call(
      'post',
      '/me/consent',
      { document: 'privacy', version: `t1-${tag}` },
      cookies.delegate,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('notice_changed');

    const ok = await call(
      'post',
      '/me/consent',
      { document: 'privacy', version: `t2-${tag}` },
      cookies.delegate,
    );
    expect(ok.status).toBe(201);
    expect((await call('get', '/me/consent', undefined, cookies.delegate)).body.outstanding).toBe(
      false,
    );
  });

  it('ignores a notice that is not yet in force', async () => {
    const future = await prisma.consentNotice.create({
      data: {
        document: 'privacy',
        version: `t3-${tag}`,
        title: 'Privacy Information for Delegates',
        headline: 'Later',
        body: 'Not in force yet.',
        effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      },
    });
    noticeIds.push(future.id);
    const res = await call('get', '/consent/privacy');
    expect(res.body.notice.version).toBe(`t2-${tag}`);
  });

  it('never asks staff and never lets them accept', async () => {
    const state = await call('get', '/me/consent', undefined, cookies.admin);
    expect(state.status).toBe(200);
    expect(state.body.outstanding).toBe(false);
    const refused = await call(
      'post',
      '/me/consent',
      { document: 'privacy', version: `t2-${tag}` },
      cookies.admin,
    );
    expect(refused.status).toBe(403);
  });

  it('needs a session to read or record your own consent', async () => {
    expect((await call('get', '/me/consent')).status).toBe(401);
    expect((await call('post', '/me/consent', { version: `t2-${tag}` })).status).toBe(401);
    // The notice itself stays public: it is what a delegate reads before deciding.
    expect((await call('get', '/consent/privacy')).status).toBe(200);
  });
});
