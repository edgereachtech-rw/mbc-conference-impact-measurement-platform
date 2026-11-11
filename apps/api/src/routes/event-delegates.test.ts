import { randomUUID } from 'node:crypto';

import { delegateCreateResultSchema, delegateListResponseSchema } from '@mbc/shared';
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
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('GET /events/:eventId/delegates (admin listing)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  let otherEventId: string;
  const accountIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
    });
  async function signedIn(role: 'delegate' | 'admin' | 'speaker' | 'support') {
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
  const list = (query: string, cookie = cookies.admin, target = eventId) =>
    request(app())
      .get(`/api/v1/events/${target}/delegates${query}`)
      .set('Cookie', cookie ?? '');

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
    otherEventId = (await createTestEvent(prisma)).id;
    for (const role of ['admin', 'delegate', 'speaker', 'support'] as const) await signedIn(role);
    const people = [
      // [name, email local part, organisation, format, status, registration id, nominating org]
      ['Zara Zed', 'zara', 'Acme', 'physical', 'active', 'Z1', null],
      ['Adam Able', 'adam', 'Beta', 'virtual', 'active', 'A1', 'Acme'],
      ['Mia Mid', 'mia', 'Acme', 'virtual', 'pending', 'M1', null],
      ['Cal Cancel', 'cal', null, 'physical', 'cancelled', null, 'Delta Nominees'],
      ['Tess Test', 'tess', 'Gamma', 'physical', 'test', null, null],
    ] as const;
    for (const [
      name,
      local,
      organisation,
      attendanceFormat,
      registrationStatus,
      externalRegistrationId,
      nominatingOrganisation,
    ] of people) {
      await prisma.delegate.create({
        data: {
          eventId,
          name,
          email: `${local}-${tag}@example.com`,
          organisation,
          nominatingOrganisation,
          attendanceFormat,
          registrationStatus,
          externalRegistrationId,
          registrationSource: externalRegistrationId ? 'eventbrite' : null,
        },
      });
    }
    await prisma.delegate.create({
      data: {
        eventId: otherEventId,
        name: 'Other Event',
        email: `other-${tag}@example.com`,
        attendanceFormat: 'virtual',
      },
    });
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is admin-only and scoped to the event', async () => {
    expect((await list('', '')).status).toBe(401);
    expect((await list('', cookies.delegate)).status).toBe(403);
    // Retired roles (speaker, support) hold no session at all (D8 item 7).
    expect((await list('', cookies.speaker)).status).toBe(401);
    expect((await list('', cookies.support)).status).toBe(401);
    expect((await list('', cookies.admin, randomUUID())).status).toBe(404);
    const res = await list('');
    expect(res.status).toBe(200);
    expect(delegateListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.total).toBe(5);
    expect(res.body.delegates.some((d: { name: string }) => d.name === 'Other Event')).toBe(false);
    expect(res.body.counts).toEqual({ active: 2, pending: 1, cancelled: 1, duplicate: 0, test: 1 });
  });

  it('sorts, searches, filters and paginates', async () => {
    const byName = await list('?sort=name&direction=asc');
    expect(byName.body.delegates.map((d: { name: string }) => d.name)).toEqual([
      'Adam Able',
      'Cal Cancel',
      'Mia Mid',
      'Tess Test',
      'Zara Zed',
    ]);
    const desc = await list('?sort=name&direction=desc&pageSize=10');
    expect(desc.body.delegates[0].name).toBe('Zara Zed');
    const search = await list('?q=acme');
    expect(search.body.delegates.map((d: { name: string }) => d.name).sort()).toEqual([
      'Mia Mid',
      'Zara Zed',
    ]);
    expect(search.body.counts.active).toBe(2); // counts stay event-wide
    // A delegate without an organisation is listed and found under the nominating organisation;
    // one with an organisation of their own (Adam, nominated by Acme) is not found through it.
    const nominated = await list('?q=delta');
    expect(nominated.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Cal Cancel']);
    expect(nominated.body.delegates[0].organisation).toBe('Delta Nominees');
    expect(nominated.body.delegates[0]).not.toHaveProperty('nominatingOrganisation');
    const own = await list('?q=beta');
    expect(own.body.delegates[0]).toMatchObject({ name: 'Adam Able', organisation: 'Beta' });
    const byId = await list('?q=A1');
    expect(byId.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Adam Able']);
    const pending = await list('?status=pending');
    expect(pending.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Mia Mid']);
    const virtual = await list('?attendanceFormat=virtual&status=active');
    expect(virtual.body.delegates.map((d: { name: string }) => d.name)).toEqual(['Adam Able']);
    const page2 = await list('?sort=name&pageSize=10&page=2');
    expect(page2.body.delegates).toEqual([]);
    expect(page2.body.total).toBe(5);
    expect((await list('?pageSize=5000')).status).toBe(422);
    expect((await list('?status=ghost')).status).toBe(422);
  });

  it('adds a delegate by hand: a new person gets an identity, a known person is linked, the rest is refused', async () => {
    const post = (body: unknown, cookie = cookies.admin, target = eventId) =>
      request(app())
        .post(`/api/v1/events/${target}/delegates`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookie ?? '')
        .send(body);
    const nia = {
      name: 'Nia New',
      email: `Nia-${tag}@Example.com`,
      nominatingOrganisation: 'Delta Nominees',
      attendanceFormat: 'physical',
    };
    expect((await post(nia, cookies.delegate)).status).toBe(403);
    expect((await post({})).status).toBe(422);
    expect((await post({ ...nia, registrationStatus: 'test' })).status).toBe(422);
    expect((await post(nia, cookies.admin, randomUUID())).status).toBe(404);

    // A new address: identity and current address created, registration by hand, all audited.
    const created = await post(nia);
    expect(created.status, created.text).toBe(201);
    expect(delegateCreateResultSchema.safeParse(created.body).success).toBe(true);
    expect(created.body.identity).toBe('created');
    expect(created.body.delegate).toMatchObject({
      name: 'Nia New',
      email: `nia-${tag}@example.com`,
      organisation: 'Delta Nominees',
      registrationSource: 'manual',
      externalRegistrationId: null,
      registrationStatus: 'active',
      capacity: 'individual',
    });
    const niaId = created.body.delegate.id as string;
    const identityId = created.body.delegate.identityId as string;
    expect(identityId).toBeTruthy();
    const address = await prisma.identityEmail.findUnique({
      where: { emailNormalised: `nia-${tag}@example.com` },
    });
    expect(address).toMatchObject({ identityId, kind: 'current', evidence: 'admin_decision' });
    expect(address?.auditLogId).toBeTruthy();
    const actions = await prisma.auditLog.findMany({
      where: { entityId: { in: [niaId, identityId] } },
      select: { action: true, newValue: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual(['delegate.created', 'identity.created']);
    expect(JSON.stringify(actions)).not.toContain('example.com');
    expect((await list('?q=nia')).body.delegates[0]).toMatchObject({
      id: niaId,
      organisation: 'Delta Nominees',
    });

    // The same person again: refused, nothing written.
    const again = await post({ ...nia, name: 'Nia New' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('registration_exists');

    // A person known from another event: linked to their identity, whatever the letter case.
    const known = await createRegisteredIdentity(prisma, otherEventId, `known-${tag}@example.com`, {
      name: 'Kofi Known',
    });
    const linked = await post({
      name: 'kofi known',
      email: `known-${tag}@example.com`,
      attendanceFormat: 'virtual',
      capacity: 'nominee',
      registrationStatus: 'pending',
    });
    expect(linked.status, linked.text).toBe(201);
    expect(linked.body.identity).toBe('linked');
    expect(linked.body.delegate.identityId).toBe(known.identity.id);
    expect(linked.body.delegate.registrationStatus).toBe('pending');
    expect(
      await prisma.auditLog.count({
        where: { action: 'identity.linked', entityId: known.identity.id, eventId },
      }),
    ).toBe(1);

    // Another name on a known address is another person: refused.
    const mismatch = await post({
      name: 'Someone Else',
      email: `known-${tag}@example.com`,
      attendanceFormat: 'physical',
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('name_mismatch');

    // A previous address of a person is never used for a new registration.
    await prisma.delegateIdentity.create({
      data: {
        displayName: 'Old Addr',
        emails: {
          create: {
            emailNormalised: `old-${tag}@example.com`,
            kind: 'historical',
            evidence: 'admin_decision',
          },
        },
      },
    });
    const old = await post({
      name: 'Old Addr',
      email: `old-${tag}@example.com`,
      attendanceFormat: 'physical',
    });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('email_not_current');

    // A deactivated account: refused until reactivated.
    const inactive = await prisma.userAccount.create({
      data: { email: `ina-${tag}@example.com`, role: 'delegate', status: 'inactive' },
    });
    accountIds.push(inactive.id);
    await createRegisteredIdentity(prisma, otherEventId, `ina-${tag}@example.com`, {
      name: 'Ina Inactive',
      userAccountId: inactive.id,
    });
    const deactivated = await post({
      name: 'Ina Inactive',
      email: `ina-${tag}@example.com`,
      attendanceFormat: 'physical',
    });
    expect(deactivated.status).toBe(409);
    expect(deactivated.body.error.code).toBe('account_inactive');

    // An archived event takes no new delegates.
    const archived = await createTestEvent(prisma);
    await prisma.event.update({ where: { id: archived.id }, data: { status: 'archived' } });
    const late = await post(
      { name: 'Late Lu', email: `late-${tag}@example.com`, attendanceFormat: 'physical' },
      cookies.admin,
      archived.id,
    );
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('event_archived');
    await prisma.event.delete({ where: { id: archived.id } });

    // The correction route now carries the nominating organisation too, audited like the rest.
    const corrected = await request(app())
      .patch(`/api/v1/delegates/${niaId}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin)
      .send({ organisation: 'Nia Ltd', nominatingOrganisation: null, country: 'Ghana' });
    expect(corrected.status, corrected.text).toBe(200);
    expect(corrected.body.delegate).toMatchObject({
      organisation: 'Nia Ltd',
      nominatingOrganisation: null,
      country: 'Ghana',
    });
    const change = await prisma.auditLog.findFirst({
      where: { action: 'delegate.updated', entityId: niaId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(change?.oldValue).toEqual({
      organisation: null,
      nominatingOrganisation: 'Delta Nominees',
      country: null,
    });
    expect(change?.newValue).toEqual({
      organisation: 'Nia Ltd',
      nominatingOrganisation: null,
      country: 'Ghana',
    });
    expect((await list('?q=nia')).body.delegates[0].organisation).toBe('Nia Ltd');
  });
});
