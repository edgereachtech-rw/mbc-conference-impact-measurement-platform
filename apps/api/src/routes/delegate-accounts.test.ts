import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, type AppOptions } from '../app.js';
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

describe.skipIf(!hasDatabase)('delegate account status (E2-13)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const cookies: Record<string, string> = {};

  const app = (options: Partial<AppOptions> = {}) =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      ...options,
    });

  async function sessionFor(role: 'delegate' | 'admin' | 'speaker' | 'analyst', email: string) {
    const account = await prisma.userAccount.create({ data: { email, role } });
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
    return { account, token };
  }
  const patch = (
    server: ReturnType<typeof app>,
    id: string,
    body: object,
    cookie = cookies.admin,
  ) =>
    request(server)
      .patch(`/api/v1/delegate-accounts/${id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);
  const auditCount = (action: string, entityId: string) =>
    prisma.auditLog.count({ where: { action, entityId } });

  let delegate: { id: string; token: string };

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    await sessionFor('admin', `admin-${tag}@example.com`);
    await sessionFor('speaker', `speaker-${tag}@example.com`);
    await sessionFor('analyst', `analyst-${tag}@example.com`);
    const d = await sessionFor('delegate', `del-${tag}@example.com`);
    const registered = await createRegisteredIdentity(prisma, eventId, `del-${tag}@example.com`, {
      userAccountId: d.account.id,
    });
    identityIds.push(registered.identity.id);
    delegate = { id: d.account.id, token: d.token };
  });
  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is admin-only, validates the body, and refuses staff accounts, unknown accounts and no-change requests with an audited refusal', async () => {
    const server = app();
    expect(
      (await patch(server, delegate.id, { status: 'inactive', reason: 'left' }, '')).status,
    ).toBe(401);
    expect(
      (await patch(server, delegate.id, { status: 'inactive', reason: 'left' }, cookies.speaker))
        .status,
    ).toBe(403);
    expect(
      (await patch(server, delegate.id, { status: 'inactive', reason: 'left' }, cookies.delegate))
        .status,
    ).toBe(403);
    expect(
      (await patch(server, delegate.id, { status: 'inactive', reason: 'left' }, cookies.analyst))
        .status,
    ).toBe(401);
    expect((await patch(server, delegate.id, { status: 'inactive' })).status).toBe(422);
    expect((await patch(server, delegate.id, { status: 'deleted', reason: 'x' })).status).toBe(422);

    const unknown = randomUUID();
    expect((await patch(server, unknown, { status: 'inactive', reason: 'x' })).status).toBe(404);
    expect(await auditCount('identity.account_status_refused', unknown)).toBe(1);
    const speaker = await prisma.userAccount.findFirstOrThrow({
      where: { email: `speaker-${tag}@example.com` },
    });
    expect((await patch(server, speaker.id, { status: 'inactive', reason: 'x' })).status).toBe(409);
    expect(await auditCount('identity.account_status_refused', speaker.id)).toBe(1);
    expect((await prisma.userAccount.findUniqueOrThrow({ where: { id: speaker.id } })).status).toBe(
      'active',
    );
    expect((await patch(server, delegate.id, { status: 'active', reason: 'already' })).status).toBe(
      409,
    );
    expect(await auditCount('identity.account_status_refused', delegate.id)).toBe(1);
    expect(await auditCount('identity.account_status_changed', delegate.id)).toBe(0);
  });

  it('deactivation revokes every session and is audited; reactivation restores nothing but the status', async () => {
    const server = app();
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Cookie', cookies.delegate ?? '')
      ).status,
    ).toBe(200);
    const off = await patch(server, delegate.id, {
      status: 'inactive',
      reason: 'requested_by_delegate',
    });
    expect(off.status, off.text).toBe(200);
    expect(off.body.sessionsRevoked).toBe(1);
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Cookie', cookies.delegate ?? '')
      ).status,
    ).toBe(401);
    const changed = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'identity.account_status_changed', entityId: delegate.id },
    });
    expect(changed.oldValue).toEqual({ status: 'active' });
    expect(changed.newValue).toMatchObject({
      status: 'inactive',
      reasonCategory: 'requested_by_delegate',
      sessionsRevoked: 1,
    });
    expect(changed.actorUserId).toBeTruthy();
    expect(JSON.stringify(changed.newValue)).not.toContain('@example.com');

    const on = await patch(server, delegate.id, { status: 'active', reason: 'cleared' });
    expect(on.status).toBe(200);
    expect(on.body.sessionsRevoked).toBe(0);
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Cookie', cookies.delegate ?? '')
      ).status,
    ).toBe(401); // no session restored
    expect(
      await prisma.authSession.count({ where: { userAccountId: delegate.id, revokedAt: null } }),
    ).toBe(0);
    expect(await auditCount('identity.account_status_changed', delegate.id)).toBe(2);
  });

  it('a failure after acceptance leaves the status unchanged and writes only identity.account_status_failed', async () => {
    const server = app({
      accountStatusHooks: {
        beforeAccountStatusWrite: async () => {
          throw new Error('injected');
        },
      },
    });
    const failed = await patch(server, delegate.id, { status: 'inactive', reason: 'x' });
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('account_status_failed');
    expect(
      (await prisma.userAccount.findUniqueOrThrow({ where: { id: delegate.id } })).status,
    ).toBe('active');
    expect(await auditCount('identity.account_status_failed', delegate.id)).toBe(1);
    expect(await auditCount('identity.account_status_changed', delegate.id)).toBe(2);
  });
});
