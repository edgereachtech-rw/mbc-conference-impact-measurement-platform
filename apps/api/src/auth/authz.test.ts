import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { PrismaClient } from '../db.js';
import {
  createRegisteredIdentity,
  createTestEvent,
  deleteIdentity,
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
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
  const identityIds: string[] = [];
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
    // Delegate A: an identity linked to the signed-in account (as the first verification does).
    const registeredA = await createRegisteredIdentity(prisma, eventId, a.email, {
      name: 'Delegate A',
      userAccountId: a.id,
    });
    delegateA = registeredA.delegate;
    identityIds.push(registeredA.identity.id);
    const registeredB = await createRegisteredIdentity(
      prisma,
      eventId,
      `b-${randomUUID().slice(0, 8)}@example.com`,
      { name: 'Delegate B', attendanceFormat: 'virtual' },
    );
    delegateB = registeredB.delegate;
    identityIds.push(registeredB.identity.id);
    await signedIn('analyst');
    await signedIn('support');
    await signedIn('speaker');
    expect(b.role).toBe('admin');
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
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

  it('admins read any delegate; speakers cannot; retired-role sessions are rejected outright', async () => {
    const server = app();
    const admin = await request(server)
      .get(`/api/v1/delegates/${delegateB.id}`)
      .set('Cookie', cookies.admin ?? '');
    expect(admin.status).toBe(200);
    for (const role of ['analyst', 'support'] as const) {
      const res = await request(server)
        .get(`/api/v1/delegates/${delegateB.id}`)
        .set('Cookie', cookies[role] ?? '');
      expect(res.status, role).toBe(401); // D8 item 7: a retired-role session resolves to nothing
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Cookie', cookies[role] ?? '');
      expect(me.status, role).toBe(401);
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

  it('retired roles and speakers cannot write; admin corrections are audited with old and new values', async () => {
    const server = app();
    for (const role of ['analyst', 'support', 'speaker'] as const) {
      const denied = await request(server)
        .patch(`/api/v1/delegates/${delegateB.id}`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookies[role] ?? '')
        .send({ organisation: `Changed by ${role}` });
      expect(denied.status, role).toBe(role === 'speaker' ? 403 : 401);
    }

    const ok = await request(server)
      .patch(`/api/v1/delegates/${delegateB.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
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
    const email = `new-speaker-${randomUUID().slice(0, 8)}@example.com`;
    for (const role of ['analyst', 'support', 'speaker', 'delegate'] as const) {
      const res = await request(server)
        .post('/api/v1/staff')
        .set('Origin', ORIGIN)
        .set('Cookie', cookies[role] ?? '')
        .send({ email, role: 'speaker' });
      expect(res.status, role).toBe(role === 'analyst' || role === 'support' ? 401 : 403);
    }
    // Retired roles cannot be assigned any more (E3-9).
    for (const retired of ['analyst', 'support']) {
      const res = await request(server)
        .post('/api/v1/staff')
        .set('Origin', ORIGIN)
        .set('Cookie', cookies.admin ?? '')
        .send({ email, role: retired });
      expect(res.status, retired).toBe(422);
    }
    const created = await request(server)
      .post('/api/v1/staff')
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ email: email.toUpperCase(), role: 'speaker' });
    expect(created.status).toBe(201);
    expect(created.body.account.email).toBe(email);
    ids.push(created.body.account.id);
    expect(
      (
        await request(server)
          .post('/api/v1/staff')
          .set('Origin', ORIGIN)
          .set('Cookie', cookies.admin ?? '')
          .send({ email, role: 'speaker' })
      ).status,
    ).toBe(409);

    // Deactivate the speaker: their live session must stop working immediately.
    const speaker = await prisma.userAccount.findFirstOrThrow({
      where: { id: { in: ids }, role: 'speaker' },
    });
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Cookie', cookies.speaker ?? '')
      ).status,
    ).toBe(200);
    const deactivated = await request(server)
      .patch(`/api/v1/staff/${speaker.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ status: 'inactive' });
    expect(deactivated.status).toBe(200);
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Cookie', cookies.speaker ?? '')
      ).status,
    ).toBe(401);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.updated', entityId: speaker.id },
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
    ).toBe(401);
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
