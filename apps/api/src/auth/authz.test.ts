import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, testPrisma } from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';
import { authConfigFromEnv } from './config.js';
import { generateToken, hashToken } from './tokens.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('role-based authorization (E3-6, E3-9)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  const ids: string[] = [];
  const cookies: Record<string, string> = {};
  let delegateA: { id: string };
  let delegateB: { id: string };

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
    });

  /** Creates an account plus a live session cookie directly (sign-in flow is covered elsewhere). */
  async function signedIn(role: 'delegate' | 'admin' | 'analyst' | 'support' | 'speaker') {
    const email = `${role}-${randomUUID().slice(0, 8)}@example.com`;
    const account = await prisma.userAccount.create({ data: { email, role } });
    ids.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    cookies[role] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    const a = await signedIn('delegate');
    const b = await signedIn('admin');
    delegateA = await prisma.delegate.create({
      data: {
        eventId,
        name: 'Delegate A',
        email: a.email,
        attendanceFormat: 'physical',
        userAccountId: a.id,
      },
    });
    delegateB = await prisma.delegate.create({
      data: {
        eventId,
        name: 'Delegate B',
        email: `b-${randomUUID().slice(0, 8)}@example.com`,
        attendanceFormat: 'virtual',
      },
    });
    await signedIn('analyst');
    await signedIn('support');
    await signedIn('speaker');
    expect(b.role).toBe('admin');
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.userAccount.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('denies unauthenticated and garbage sessions', async () => {
    const server = app();
    expect((await request(server).get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await request(server).get('/api/v1/me/delegate').set('Cookie', 'mbc_session=nope')).status,
    ).toBe(401);
    expect((await request(server).get(`/api/v1/delegates/${delegateB.id}`)).status).toBe(401);
  });

  it('a delegate reads their own record but cannot reach another delegate by id', async () => {
    const server = app();
    const own = await request(server)
      .get('/api/v1/me/delegate')
      .set('Cookie', cookies.delegate ?? '');
    expect(own.status).toBe(200);
    expect(own.body.delegate.id).toBe(delegateA.id);
    const other = await request(server)
      .get(`/api/v1/delegates/${delegateB.id}`)
      .set('Cookie', cookies.delegate ?? '');
    expect(other.status).toBe(403);
    const patch = await request(server)
      .patch(`/api/v1/delegates/${delegateB.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.delegate ?? '')
      .send({ name: 'Hacked' });
    expect(patch.status).toBe(403);
  });

  it('staff with a read role can read any delegate; speakers cannot', async () => {
    const server = app();
    for (const role of ['admin', 'analyst', 'support'] as const) {
      const res = await request(server)
        .get(`/api/v1/delegates/${delegateB.id}`)
        .set('Cookie', cookies[role] ?? '');
      expect(res.status, role).toBe(200);
    }
    const speaker = await request(server)
      .get(`/api/v1/delegates/${delegateB.id}`)
      .set('Cookie', cookies.speaker ?? '');
    expect(speaker.status).toBe(403);
    const unknown = await request(server)
      .get(`/api/v1/delegates/${randomUUID()}`)
      .set('Cookie', cookies.admin ?? '');
    expect(unknown.status).toBe(404);
  });

  it('analysts cannot write; support and admin corrections are audited with old and new values', async () => {
    const server = app();
    const denied = await request(server)
      .patch(`/api/v1/delegates/${delegateB.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.analyst ?? '')
      .send({ organisation: 'Changed by analyst' });
    expect(denied.status).toBe(403);

    const ok = await request(server)
      .patch(`/api/v1/delegates/${delegateB.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.support ?? '')
      .send({ organisation: 'Example Ministry' });
    expect(ok.status).toBe(200);
    expect(ok.body.delegate.organisation).toBe('Example Ministry');
    const row = await prisma.auditLog.findFirst({
      where: { action: 'delegate.updated', entityId: delegateB.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row?.oldValue).toEqual({ organisation: null });
    expect(row?.newValue).toEqual({ organisation: 'Example Ministry' });
    expect(row?.actorUserId).toBeTruthy();

    const invalid = await request(server)
      .patch(`/api/v1/delegates/${delegateB.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ attendanceFormat: 'hologram' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('validation_failed');
  });

  it('only admins manage staff; deactivation revokes the sessions of that user', async () => {
    const server = app();
    const email = `new-analyst-${randomUUID().slice(0, 8)}@example.com`;
    for (const role of ['analyst', 'support', 'speaker', 'delegate'] as const) {
      const res = await request(server)
        .post('/api/v1/staff')
        .set('Origin', ORIGIN)
        .set('Cookie', cookies[role] ?? '')
        .send({ email, role: 'analyst' });
      expect(res.status, role).toBe(403);
    }
    const created = await request(server)
      .post('/api/v1/staff')
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ email: email.toUpperCase(), role: 'analyst' });
    expect(created.status).toBe(201);
    expect(created.body.account.email).toBe(email);
    ids.push(created.body.account.id);
    expect(
      (
        await request(server)
          .post('/api/v1/staff')
          .set('Origin', ORIGIN)
          .set('Cookie', cookies.admin ?? '')
          .send({ email, role: 'analyst' })
      ).status,
    ).toBe(409);

    // Deactivate the support user: their live session must stop working immediately.
    const support = await prisma.userAccount.findFirstOrThrow({
      where: { id: { in: ids }, role: 'support' },
    });
    const deactivated = await request(server)
      .patch(`/api/v1/staff/${support.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ status: 'inactive' });
    expect(deactivated.status).toBe(200);
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Cookie', cookies.support ?? '')
      ).status,
    ).toBe(401);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.updated', entityId: support.id },
    });
    expect(audit?.newValue).toMatchObject({ status: 'inactive' });

    const list = await request(server)
      .get('/api/v1/staff')
      .set('Cookie', cookies.admin ?? '');
    expect(list.status).toBe(200);
    expect(list.body.staff.every((s: { role: string }) => s.role !== 'delegate')).toBe(true);
    expect(
      (
        await request(server)
          .get('/api/v1/staff')
          .set('Cookie', cookies.analyst ?? '')
      ).status,
    ).toBe(403);
  });

  it('an admin cannot deactivate their own account', async () => {
    const admin = await prisma.userAccount.findFirstOrThrow({
      where: { id: { in: ids }, role: 'admin' },
    });
    const res = await request(app())
      .patch(`/api/v1/staff/${admin.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ status: 'inactive' });
    expect(res.status).toBe(409);
  });
});
