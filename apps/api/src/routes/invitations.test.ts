import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
import { invitationTtlDays } from './invitations.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe('invitation validity setting', () => {
  it('has no default: unset or invalid means invitations cannot be sent', () => {
    expect(invitationTtlDays({})).toBeNull();
    expect(invitationTtlDays({ INVITATION_TTL_DAYS: '' })).toBeNull();
    expect(invitationTtlDays({ INVITATION_TTL_DAYS: '0' })).toBeNull();
    expect(invitationTtlDays({ INVITATION_TTL_DAYS: 'soon' })).toBeNull();
    expect(invitationTtlDays({ INVITATION_TTL_DAYS: '30' })).toBe(30);
  });
});

describe.skipIf(!hasDatabase)('invitations (E3-1)', () => {
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
  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      authConfig: authConfigFromEnv({
        NODE_ENV: 'test',
        APP_URL: ORIGIN,
        AUTH_RATE_LIMIT_PER_IP: '1000',
        AUTH_VERIFY_LIMIT_PER_IP: '1000',
      }),
      mailConfig,
      allowedOrigins: [ORIGIN],
      trustProxy: 'loopback, uniquelocal',
    });
  async function sessionFor(role: 'admin' | 'speaker') {
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
  const send = (
    server: ReturnType<typeof app>,
    body: object = {},
    cookie = cookies.admin,
    target = eventId,
  ) =>
    request(server)
      .post(`/api/v1/events/${target}/invitations`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);
  const inviteTokenFrom = (text: string) =>
    decodeURIComponent(/signin\?invite=([A-Za-z0-9_%-]+)/.exec(text)?.[1] ?? '');
  const magicTokenFrom = (text: string) =>
    decodeURIComponent(/signin\/verify\?token=([A-Za-z0-9_%-]+)/.exec(text)?.[1] ?? '');
  let previousTtl: string | undefined;

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    await sessionFor('admin');
    await sessionFor('speaker');
    previousTtl = process.env.INVITATION_TTL_DAYS;
    process.env.INVITATION_TTL_DAYS = '30';
  });
  afterAll(async () => {
    if (previousTtl === undefined) delete process.env.INVITATION_TTL_DAYS;
    else process.env.INVITATION_TTL_DAYS = previousTtl;
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });
  beforeEach(() => {
    mailer = new MemoryMailer();
  });
  afterEach(() => {
    process.env.INVITATION_TTL_DAYS = '30';
  });

  it('is admin-only and refuses to send without the validity setting', async () => {
    const server = app();
    expect((await send(server, {}, '')).status).toBe(401);
    expect((await send(server, {}, cookies.speaker)).status).toBe(403);
    delete process.env.INVITATION_TTL_DAYS;
    const unconfigured = await send(server);
    expect(unconfigured.status).toBe(409);
    expect(unconfigured.body.error.code).toBe('invitations_not_configured');
    expect(mailer.sent).toHaveLength(0);
    process.env.INVITATION_TTL_DAYS = '30';
    expect((await send(server, { delegateIds: ['nope'] })).status).toBe(422);
    expect((await send(server, {}, cookies.admin, randomUUID())).status).toBe(404);
  });

  it('sends single-use links to eligible registrations, pre-fills the sign-in page, resends by revoking, and accepts at first sign-in', async () => {
    const server = app();
    const email = `invitee-${tag}@example.com`;
    const invitee = await createRegisteredIdentity(prisma, eventId, email, { name: 'Ivy Invitee' });
    identityIds.push(invitee.identity.id);
    const cancelled = await createRegisteredIdentity(
      prisma,
      eventId,
      `cancelled-${tag}@example.com`,
      { registrationStatus: 'cancelled' },
    );
    identityIds.push(cancelled.identity.id);

    const res = await send(server);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sent: 1, failed: 0, total: 1 }); // the cancelled registration is not invited
    expect(mailer.sent[0]?.to).toBe(email);
    expect(mailer.sent[0]?.subject).toMatch(/invitation/i);
    const token = inviteTokenFrom(mailer.sent[0]?.text ?? '');
    expect(token.length).toBeGreaterThan(20);
    const stored = await prisma.invitation.findFirstOrThrow({
      where: { delegateId: invitee.delegate.id },
    });
    expect(stored.status).toBe('sent');
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.expiresAt).toBeInstanceOf(Date);
    expect(
      await prisma.auditLog.count({ where: { action: 'invitation.sent', entityId: stored.id } }),
    ).toBe(1);
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'invitation.sent', entityId: stored.id },
    });
    expect(JSON.stringify(auditRow.newValue)).not.toContain('@example.com');

    // The sign-in page resolves the link to the email; opening it does not consume it.
    const lookup = await request(server).get(
      `/api/v1/auth/invitations/${encodeURIComponent(token)}`,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.body.email).toBe(email);
    expect(
      (await request(server).get(`/api/v1/auth/invitations/${encodeURIComponent(token)}`)).status,
    ).toBe(200);
    expect((await request(server).get(`/api/v1/auth/invitations/${'x'.repeat(43)}`)).status).toBe(
      404,
    );

    // Resend: the earlier link is revoked and no longer resolves.
    const resend = await send(server, { delegateIds: [invitee.delegate.id] });
    expect(resend.body).toEqual({ sent: 1, failed: 0, total: 1 });
    expect(
      (await request(server).get(`/api/v1/auth/invitations/${encodeURIComponent(token)}`)).status,
    ).toBe(404);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: stored.id } })).status).toBe(
      'revoked',
    );
    const second = inviteTokenFrom(mailer.sent[1]?.text ?? '');
    expect(
      (await request(server).get(`/api/v1/auth/invitations/${encodeURIComponent(second)}`)).status,
    ).toBe(200);
    expect((await send(server, { delegateIds: [cancelled.delegate.id] })).status).toBe(404);

    // First sign-in marks the open invitation accepted.
    await request(server).post('/api/v1/auth/magic-link').set('Origin', ORIGIN).send({ email });
    const verified = await request(server)
      .post('/api/v1/auth/verify')
      .set('Origin', ORIGIN)
      .send({ token: magicTokenFrom(mailer.sent[2]?.text ?? '') });
    expect(verified.status, verified.text).toBe(200);
    accountIds.push(verified.body.user.id);
    const accepted = await prisma.invitation.findFirstOrThrow({
      where: { delegateId: invitee.delegate.id, status: 'accepted' },
    });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(
      (await request(server).get(`/api/v1/auth/invitations/${encodeURIComponent(second)}`)).status,
    ).toBe(404);
  });

  it('records a failed delivery without losing the invitation', async () => {
    const failing = {
      sent: [] as never[],
      async send() {
        throw new Error('smtp down');
      },
    };
    const server = createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => failing as never,
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      mailConfig,
      allowedOrigins: [ORIGIN],
    });
    const person = await createRegisteredIdentity(prisma, eventId, `bounce-${tag}@example.com`);
    identityIds.push(person.identity.id);
    const res = await send(server, { delegateIds: [person.delegate.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 0, failed: 1, total: 1 });
    const row = await prisma.invitation.findFirstOrThrow({
      where: { delegateId: person.delegate.id },
    });
    expect(row.status).toBe('pending');
    expect(
      await prisma.auditLog.count({
        where: { action: 'invitation.send_failed', entityId: row.id },
      }),
    ).toBe(1);
  });
});
