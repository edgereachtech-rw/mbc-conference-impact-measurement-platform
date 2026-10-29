import { randomUUID } from 'node:crypto';

import { myEventsResponseSchema } from '@mbc/shared';
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

describe.skipIf(!hasDatabase)('My Events (E3-10, D7, Increment 1c)', () => {
  let prisma: PrismaClient;
  const eventIds: string[] = [];
  const identityIds: string[] = [];
  const accountIds: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-10-30T12:00:00.000Z');

  const app = (env: Record<string, string> = {}) =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN, ...env }),
      allowedOrigins: [ORIGIN],
      now: () => now,
    });

  async function event(
    slug: string,
    startsOn: string,
    endsOn: string,
    status: 'draft' | 'active' | 'archived' = 'active',
  ) {
    const created = await prisma.event.create({
      data: {
        slug: `test-${slug}-${tag}`,
        name: `Event ${slug}`,
        startsOn: new Date(startsOn),
        endsOn: new Date(endsOn),
        status,
        location: slug === 'lagos' ? 'Lagos Oriental Hotel' : null,
      },
    });
    eventIds.push(created.id);
    return created.id;
  }
  async function sessionFor(role: 'delegate' | 'admin' | 'speaker', email: string) {
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

  let lagos: string;
  let online: string;
  let past: string;
  let archived: string;
  let alice: { cookie: string; identityId: string; delegateIds: string[] };
  let bob: { cookie: string; identityId: string; delegateId: string };

  beforeAll(async () => {
    prisma = testPrisma();
    lagos = await event('lagos', '2026-11-12', '2026-11-13');
    online = await event('online', '2027-02-01', '2027-02-02');
    past = await event('past', '2025-09-10', '2025-09-11');
    archived = await event('archived', '2026-12-01', '2026-12-02', 'archived');

    // Alice: one identity, registrations in four events (one archived), a cancelled one, and a second
    // identity (Bob) with one registration. Both have signed in, so their accounts own their identities.
    const a = await sessionFor('delegate', `alice-${tag}@example.com`);
    const aliceLagos = await createRegisteredIdentity(prisma, lagos, `alice-${tag}@example.com`, {
      name: 'Alice A',
      userAccountId: a.account.id,
      attendanceFormat: 'physical',
    });
    identityIds.push(aliceLagos.identity.id);
    const aliceOnline = await prisma.delegate.create({
      data: {
        eventId: online,
        identityId: aliceLagos.identity.id,
        name: 'Alice A',
        email: `alice-${tag}@example.com`,
        attendanceFormat: 'virtual',
        organisation: 'Acme',
      },
    });
    const alicePast = await prisma.delegate.create({
      data: {
        eventId: past,
        identityId: aliceLagos.identity.id,
        name: 'Alice A',
        email: `alice-${tag}@example.com`,
        attendanceFormat: 'virtual',
      },
    });
    await prisma.delegate.create({
      data: {
        eventId: archived,
        identityId: aliceLagos.identity.id,
        name: 'Alice A',
        email: `alice-${tag}@example.com`,
        attendanceFormat: 'virtual',
      },
    });
    alice = {
      cookie: a.cookie,
      identityId: aliceLagos.identity.id,
      delegateIds: [aliceLagos.delegate.id, aliceOnline.id, alicePast.id],
    };

    const b = await sessionFor('delegate', `bob-${tag}@example.com`);
    const bobLagos = await createRegisteredIdentity(prisma, lagos, `bob-${tag}@example.com`, {
      name: 'Bob B',
      userAccountId: b.account.id,
    });
    identityIds.push(bobLagos.identity.id);
    bob = { cookie: b.cookie, identityId: bobLagos.identity.id, delegateId: bobLagos.delegate.id };
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('lists only the caller’s own non-archived registrations, upcoming first then past, with attendance not recorded', async () => {
    const res = await request(app()).get('/api/v1/me/events').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(myEventsResponseSchema.safeParse(res.body).success).toBe(true);
    const events = res.body.events as Array<{
      id: string;
      period: string;
      registration: { id: string; attendanceFormat: string; organisation: string | null };
      attendance: { status: string };
    }>;
    expect(events.map((e) => e.id)).toEqual([lagos, online, past]); // soonest upcoming first, then most recent past
    expect(events.map((e) => e.period)).toEqual(['upcoming', 'upcoming', 'past']);
    expect(events.every((e) => e.attendance.status === 'not_recorded')).toBe(true);
    expect(events[1]?.registration).toMatchObject({
      attendanceFormat: 'virtual',
      organisation: 'Acme',
    });
    expect(events.some((e) => e.id === archived)).toBe(false);
    // Only the caller's own registration ids are returned, never another identity's.
    expect(events.map((e) => e.registration.id).sort()).toEqual([...alice.delegateIds].sort());
    expect(JSON.stringify(res.body)).not.toContain(bob.delegateId);
    expect(JSON.stringify(res.body)).not.toContain('bob-');
  });

  it('returns one event by id for the owner and 404 for another identity’s event or an unknown id', async () => {
    const server = app();
    const own = (await server)
      ? await request(server).get(`/api/v1/me/events/${online}`).set('Cookie', alice.cookie)
      : null;
    expect(own?.status).toBe(200);
    expect(own?.body.event.id).toBe(online);
    const bobsView = await request(server)
      .get(`/api/v1/me/events/${online}`)
      .set('Cookie', bob.cookie);
    expect(bobsView.status).toBe(404); // Bob has no registration in the online event
    expect(
      (await request(server).get(`/api/v1/me/events/${archived}`).set('Cookie', alice.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request(server).get(`/api/v1/me/events/${randomUUID()}`).set('Cookie', alice.cookie))
        .status,
    ).toBe(404);
    // Bob sees exactly his one event.
    const bobs = await request(server).get('/api/v1/me/events').set('Cookie', bob.cookie);
    expect(bobs.body.events.map((e: { id: string }) => e.id)).toEqual([lagos]);
  });

  it('hides pending registrations and lists them again once an admin sets them active (E2-5)', async () => {
    const server = app();
    const admin = await sessionFor('admin', `admin2-${tag}@example.com`);
    const toPending = await request(server)
      .patch(`/api/v1/delegates/${alice.delegateIds[1]}`)
      .set('Origin', ORIGIN)
      .set('Cookie', admin.cookie)
      .send({ registrationStatus: 'pending' });
    expect(toPending.status, toPending.text).toBe(200);
    let res = await request(server).get('/api/v1/me/events').set('Cookie', alice.cookie);
    expect(res.body.events.map((e: { id: string }) => e.id)).not.toContain(online);
    const back = await request(server)
      .patch(`/api/v1/delegates/${alice.delegateIds[1]}`)
      .set('Origin', ORIGIN)
      .set('Cookie', admin.cookie)
      .send({ registrationStatus: 'active' });
    expect(back.status).toBe(200);
    res = await request(server).get('/api/v1/me/events').set('Cookie', alice.cookie);
    expect(res.body.events.map((e: { id: string }) => e.id)).toContain(online);
  });

  it('hides cancelled registrations (pending OQ-25) and reflects an admin cancellation immediately', async () => {
    const server = app();
    const admin = await sessionFor('admin', `admin-${tag}@example.com`);
    const cancel = await request(server)
      .patch(`/api/v1/delegates/${alice.delegateIds[2]}`)
      .set('Origin', ORIGIN)
      .set('Cookie', admin.cookie)
      .send({ registrationStatus: 'cancelled' });
    expect(cancel.status, cancel.text).toBe(200);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'delegate.updated', entityId: alice.delegateIds[2] },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.oldValue).toEqual({ registrationStatus: 'active' });
    expect(audit?.newValue).toEqual({ registrationStatus: 'cancelled' });
    const res = await request(server).get('/api/v1/me/events').set('Cookie', alice.cookie);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual([lagos, online]);
    // An admin cannot set duplicate or test through the correction route.
    expect(
      (
        await request(server)
          .patch(`/api/v1/delegates/${alice.delegateIds[0]}`)
          .set('Origin', ORIGIN)
          .set('Cookie', admin.cookie)
          .send({ registrationStatus: 'test' })
      ).status,
    ).toBe(422);
  });

  it('anonymous, staff, unlinked and inactive callers get nothing of value', async () => {
    const server = app();
    expect((await request(server).get('/api/v1/me/events')).status).toBe(401);
    const speaker = await sessionFor('speaker', `speaker-${tag}@example.com`);
    expect(
      (await request(server).get('/api/v1/me/events').set('Cookie', speaker.cookie)).status,
    ).toBe(403);
    // A delegate account whose identity link is missing: an empty list, not an error or someone else's data.
    const unlinked = await sessionFor('delegate', `unlinked-${tag}@example.com`);
    const empty = await request(server).get('/api/v1/me/events').set('Cookie', unlinked.cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.events).toEqual([]);
    expect(
      (await request(server).get(`/api/v1/me/events/${lagos}`).set('Cookie', unlinked.cookie))
        .status,
    ).toBe(404);
    // Deactivated account: the session resolves to nothing.
    const bobAccount = await prisma.userAccount.findFirstOrThrow({
      where: { email: `bob-${tag}@example.com` },
    });
    await prisma.userAccount.update({ where: { id: bobAccount.id }, data: { status: 'inactive' } });
    expect((await request(server).get('/api/v1/me/events').set('Cookie', bob.cookie)).status).toBe(
      401,
    );
    await prisma.userAccount.update({ where: { id: bobAccount.id }, data: { status: 'active' } });
  });

  it('shows test registrations only where the non-production allowance is set', async () => {
    const testEvent = await event('rehearsal', '2026-12-10', '2026-12-11');
    await prisma.delegate.create({
      data: {
        eventId: testEvent,
        identityId: bob.identityId,
        name: 'Bob B',
        email: `bob-${tag}@example.com`,
        attendanceFormat: 'virtual',
        registrationStatus: 'test',
      },
    });
    const strict = await request(app()).get('/api/v1/me/events').set('Cookie', bob.cookie);
    expect(strict.body.events.map((e: { id: string }) => e.id)).toEqual([lagos]);
    const allowed = await request(app({ AUTH_ALLOW_TEST_REGISTRATIONS: 'true' }))
      .get('/api/v1/me/events')
      .set('Cookie', bob.cookie);
    expect(allowed.body.events.map((e: { id: string }) => e.id)).toEqual([lagos, testEvent]);
    expect(allowed.body.events[1].registration.status).toBe('test');
  });
});
