import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

describe.skipIf(!hasDatabase)('messages to delegates (E2-14)', () => {
  let prisma: PrismaClient;
  let mailer: MemoryMailer;
  let eventId: string;
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const cookies: Record<string, string> = {};
  const mailConfig = {
    transport: 'memory' as const,
    from: 'Test <noreply@example.com>',
    contactEmail: 'conference@mbryanconsultinggroup.com',
    appUrl: ORIGIN,
    smtp: { host: 'x', port: 25, secure: false },
  };
  const app = (mailerOverride?: () => MemoryMailer) =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: mailerOverride ?? (() => mailer),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      mailConfig,
      allowedOrigins: [ORIGIN],
      trustProxy: 'loopback, uniquelocal',
    });
  async function sessionFor(role: 'admin' | 'speaker') {
    const account = await prisma.userAccount.create({
      data: { email: `${role}-msg-${tag}@example.com`, role },
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
  const send = (
    server: ReturnType<typeof app>,
    body: object,
    cookie = cookies.admin,
    target = eventId,
  ) =>
    request(server)
      .post(`/api/v1/events/${target}/messages`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);
  const base = {
    subject: 'Hello {{firstName}}',
    body: '# Dear {{name}}\n\nSee **you** at {{eventName}}.\n\n- bring your badge\n- [agenda](https://example.com/agenda)',
  };
  let active: Awaited<ReturnType<typeof createRegisteredIdentity>>;
  let pending: Awaited<ReturnType<typeof createRegisteredIdentity>>;
  let cancelled: Awaited<ReturnType<typeof createRegisteredIdentity>>;
  let duplicate: Awaited<ReturnType<typeof createRegisteredIdentity>>;
  let virtual: Awaited<ReturnType<typeof createRegisteredIdentity>>;
  let otherEventDelegateId: string;
  let otherEventId: string;

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    otherEventId = (await createTestEvent(prisma)).id;
    await sessionFor('admin');
    await sessionFor('speaker');
    active = await createRegisteredIdentity(prisma, eventId, `msg-active-${tag}@example.com`, {
      name: 'Ada Active',
    });
    pending = await createRegisteredIdentity(prisma, eventId, `msg-pending-${tag}@example.com`, {
      name: 'Pat Pending',
      registrationStatus: 'pending',
    });
    cancelled = await createRegisteredIdentity(
      prisma,
      eventId,
      `msg-cancelled-${tag}@example.com`,
      { name: 'Cal Cancelled', registrationStatus: 'cancelled' },
    );
    duplicate = await createRegisteredIdentity(
      prisma,
      eventId,
      `msg-duplicate-${tag}@example.com`,
      { name: 'Dup Licate', registrationStatus: 'duplicate' },
    );
    virtual = await createRegisteredIdentity(prisma, eventId, `msg-virtual-${tag}@example.com`, {
      name: 'Vic Virtual',
      attendanceFormat: 'virtual',
    });
    const other = await createRegisteredIdentity(
      prisma,
      otherEventId,
      `msg-other-${tag}@example.com`,
    );
    otherEventDelegateId = other.delegate.id;
    for (const r of [active, pending, cancelled, duplicate, virtual, other])
      identityIds.push(r.identity.id);
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });
  beforeEach(() => {
    mailer = new MemoryMailer();
  });

  it('is admin-only and validates the request', async () => {
    const server = app();
    const ids = { recipients: { delegateIds: [active.delegate.id] } };
    expect((await send(server, { ...base, ...ids }, '')).status).toBe(401);
    expect((await send(server, { ...base, ...ids }, cookies.speaker)).status).toBe(403);
    expect(
      (
        await request(server)
          .get(`/api/v1/events/${eventId}/messages`)
          .set('Cookie', cookies.speaker ?? '')
      ).status,
    ).toBe(403);
    expect((await send(server, { ...base, ...ids }, cookies.admin, randomUUID())).status).toBe(404);
    expect((await send(server, { subject: '', body: 'x', ...ids })).status).toBe(422);
    expect((await send(server, { subject: 's', body: 'x', recipients: {} })).status).toBe(422);
    expect(
      (await send(server, { subject: 's', body: 'x', recipients: { delegateIds: [] } })).status,
    ).toBe(422);
    const unknown = await send(server, { subject: 'Hi {{nickname}}', body: 'x {{Name}}', ...ids });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('unknown_placeholder');
    expect(unknown.body.error.message).toContain('{{nickname}}');
    expect(unknown.body.error.message).toContain('{{Name}}');
    // A registration of another event, or a merged duplicate, cannot be addressed.
    expect(
      (
        await send(server, {
          ...base,
          recipients: { delegateIds: [active.delegate.id, otherEventDelegateId] },
        })
      ).status,
    ).toBe(404);
    expect(
      (await send(server, { ...base, recipients: { delegateIds: [duplicate.delegate.id] } }))
        .status,
    ).toBe(404);
    const dupFilter = await send(server, {
      ...base,
      recipients: { filter: { status: 'duplicate' } },
    });
    expect(dupFilter.status).toBe(422);
    expect(dupFilter.body.error.code).toBe('duplicates_not_messaged');
    const none = await send(server, {
      ...base,
      recipients: { filter: { q: 'nobody-matches-this' } },
    });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('no_recipients');
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.delegateMessage.count({ where: { eventId } })).toBe(0);
  });

  it('sends a personalised branded email to the ticked registrations and records it', async () => {
    const server = app();
    const res = await send(server, {
      ...base,
      // The same id twice counts once.
      recipients: { delegateIds: [active.delegate.id, pending.delegate.id, active.delegate.id] },
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ total: 2, sent: 2, failed: 0, skipped: 0 });
    expect(mailer.sent).toHaveLength(2);
    const toAda = mailer.sent.find((m) => m.to === active.delegate.email);
    expect(toAda?.subject).toBe('Hello Ada');
    expect(toAda?.html).toContain('Dear Ada Active</h1>');
    expect(toAda?.html).toContain('<strong>you</strong>');
    expect(toAda?.html).toContain('href="https://example.com/agenda"');
    expect(toAda?.html).toContain('logo-white.png'); // event layout around the body
    expect(toAda?.text).toContain('Dear Ada Active');
    expect(toAda?.text).toContain('- bring your badge');
    expect(toAda?.text).toContain('agenda (https://example.com/agenda)');
    expect(mailer.sent.find((m) => m.to === pending.delegate.email)?.subject).toBe('Hello Pat');

    const stored = await prisma.delegateMessage.findUniqueOrThrow({
      where: { id: res.body.messageId },
      include: { recipients: true },
    });
    expect(stored.status).toBe('sent');
    expect(stored.recipientCount).toBe(2);
    expect(stored.sentCount).toBe(2);
    expect(stored.recipientSelection).toEqual({ kind: 'ids', count: 2 });
    expect(stored.recipients.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(stored.recipients.every((r) => r.providerMessageId && r.sentAt)).toBe(true);
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'message.sent', entityId: stored.id },
    });
    expect(auditRow.newValue).toMatchObject({ status: 'sent', sent: 2, failed: 0, skipped: 0 });
    expect(JSON.stringify(auditRow.newValue)).not.toContain('@example.com');

    // History and detail, admin-only.
    const list = await request(server)
      .get(`/api/v1/events/${eventId}/messages`)
      .set('Cookie', cookies.admin ?? '');
    expect(list.status).toBe(200);
    expect(list.body.messages[0]).toMatchObject({
      id: stored.id,
      subject: 'Hello {{firstName}}',
      status: 'sent',
      recipientCount: 2,
      sentBy: `admin-msg-${tag}@example.com`,
    });
    const detail = await request(server)
      .get(`/api/v1/events/${eventId}/messages/${stored.id}`)
      .set('Cookie', cookies.admin ?? '');
    expect(detail.status).toBe(200);
    expect(detail.body.message.body).toBe(base.body);
    expect(detail.body.message.recipients).toHaveLength(2);
    expect(detail.body.message.recipients[0]).toMatchObject({
      delegateId: active.delegate.id,
      name: 'Ada Active',
      status: 'sent',
    });
    expect(
      (
        await request(server)
          .get(`/api/v1/events/${otherEventId}/messages/${stored.id}`)
          .set('Cookie', cookies.admin ?? '')
      ).status,
    ).toBe(404);
  });

  it('sends to everyone matching a listing filter, excluding merged duplicates', async () => {
    const server = app();
    const all = await send(server, { ...base, recipients: { filter: {} } });
    expect(all.status, all.text).toBe(201);
    // active, pending, cancelled, virtual; the merged duplicate is excluded
    expect(all.body).toMatchObject({ total: 4, sent: 4, failed: 0, skipped: 0 });
    expect(mailer.sent.map((m) => m.to)).not.toContain(duplicate.delegate.email);

    mailer.sent.length = 0;
    const onlyVirtual = await send(server, {
      ...base,
      recipients: { filter: { status: 'active', attendanceFormat: 'virtual' } },
    });
    expect(onlyVirtual.body).toMatchObject({ total: 1, sent: 1 });
    expect(mailer.sent[0]?.to).toBe(virtual.delegate.email);

    mailer.sent.length = 0;
    const searched = await send(server, {
      ...base,
      recipients: { filter: { q: `msg-cancelled-${tag}` } },
    });
    expect(searched.body).toMatchObject({ total: 1, sent: 1 });
    expect(mailer.sent[0]?.to).toBe(cancelled.delegate.email);
    const stored = await prisma.delegateMessage.findUniqueOrThrow({
      where: { id: searched.body.messageId },
    });
    expect(stored.recipientSelection).toEqual({
      kind: 'filter',
      filter: { q: `msg-cancelled-${tag}` },
    });
  });

  it('records failed deliveries per recipient and keeps the message', async () => {
    let calls = 0;
    const flaky = new MemoryMailer();
    const original = flaky.send.bind(flaky);
    flaky.send = async (message) => {
      calls += 1;
      if (calls === 1) throw new Error('smtp down');
      return original(message);
    };
    const server = app(() => flaky);
    const res = await send(server, {
      ...base,
      recipients: { delegateIds: [active.delegate.id, pending.delegate.id] },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ total: 2, sent: 1, failed: 1 });
    const stored = await prisma.delegateMessage.findUniqueOrThrow({
      where: { id: res.body.messageId },
      include: { recipients: { orderBy: { status: 'asc' } } },
    });
    expect(stored.status).toBe('partially_failed');
    expect(stored.failedCount).toBe(1);
    const failedRow = stored.recipients.find((r) => r.status === 'failed');
    expect(failedRow?.failureReason).toBe('delivery_failed');
    expect(failedRow?.sentAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'message.send_failed', entityId: stored.id },
      }),
    ).toBe(1);
  });

  it('refuses archived events', async () => {
    const server = app();
    await prisma.event.update({ where: { id: eventId }, data: { status: 'archived' } });
    try {
      const res = await send(server, { ...base, recipients: { filter: {} } });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('event_archived');
      expect(mailer.sent).toHaveLength(0);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { status: 'active' } });
    }
  });
});
