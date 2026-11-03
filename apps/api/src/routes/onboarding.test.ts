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
 * The onboarding pack (task of 2026-11-03): an admin sends it, it carries the delegate's own
 * check-in codes as inline images, and a second press does not email anyone twice.
 */
describe.skipIf(!hasDatabase)('onboarding pack', () => {
  let prisma: PrismaClient;
  let eventId = '';
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

  const call = (method: 'get' | 'post', path: string, body?: object, cookie?: string) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? cookies.admin ?? '')
      .send(body);

  /** Reads an SVG response as text: supertest has no parser for image/svg+xml. */
  const svgFrom = async (path: string, cookie?: string) => {
    const res = await request(app())
      .get(path)
      .set('Cookie', cookie ?? '')
      .buffer(true)
      .parse((r, callback) => {
        let text = '';
        r.on('data', (c: Buffer) => (text += c.toString('utf8')));
        r.on('end', () => callback(null, text));
      });
    return { status: res.status, headers: res.headers, body: String(res.body) };
  };

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
        startsOn: new Date('2026-11-12T00:00:00.000Z'),
        endsOn: new Date('2026-11-13T00:00:00.000Z'),
        timezone: 'Africa/Lagos',
        location: 'Lagos Oriental Hotel',
      },
    });
    for (const date of ['2026-11-12', '2026-11-13']) {
      await prisma.eventDate.create({
        data: { eventId, date: new Date(`${date}T00:00:00.000Z`) },
      });
    }
    cookies.admin = (await sessionFor('admin', `admin-ob-${tag}@example.com`)).cookie;

    const delegate = await sessionFor('delegate', `dee-ob-${tag}@example.com`);
    cookies.dee = delegate.cookie;
    const registered = await createRegisteredIdentity(
      prisma,
      eventId,
      `dee-ob-${tag}@example.com`,
      { name: 'Dee Legate', userAccountId: delegate.account.id },
    );
    identityIds.push(registered.identity.id);
    // A second delegate, nominated by an organisation, so the card carries a sponsor.
    const second = await createRegisteredIdentity(prisma, eventId, `bo-ob-${tag}@example.com`, {
      name: 'Bo Delegate',
    });
    identityIds.push(second.identity.id);
    await prisma.delegate.update({
      where: { id: second.delegate.id },
      data: { nominatingOrganisation: 'IHS Towers' },
    });
    // Cancelled: never in a send.
    const gone = await createRegisteredIdentity(prisma, eventId, `gone-ob-${tag}@example.com`, {
      name: 'Gone Away',
      registrationStatus: 'cancelled',
    });
    identityIds.push(gone.identity.id);
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('reports who is waiting before anything is sent', async () => {
    const state = await call('get', `/events/${eventId}/onboarding`);
    expect(state.status, state.text).toBe(200);
    expect(state.body).toMatchObject({ eligible: 2, sent: 0, pending: 2, failed: 0 });
    expect(state.body.lastSentAt).toBeNull();
  });

  it('is admin-only', async () => {
    expect((await call('get', `/events/${eventId}/onboarding`, undefined, '')).status).toBe(401);
    expect(
      (await call('post', `/events/${eventId}/onboarding/send`, { scope: 'all' }, cookies.dee))
        .status,
    ).toBe(403);
  });

  it('sends one pack per delegate, with a check-in code for each day', async () => {
    mailer.sent.length = 0;
    const result = await call('post', `/events/${eventId}/onboarding/send`, {
      scope: 'not_yet_sent',
    });
    expect(result.status, result.text).toBe(201);
    expect(result.body).toMatchObject({ justSent: 2, justFailed: 0, sent: 2, pending: 0 });
    expect(result.body.lastSentAt).toBe(now.toISOString());

    expect(mailer.sent).toHaveLength(2);
    const toDee = mailer.sent.find((m) => m.to.startsWith('dee-ob-'))!;
    expect(toDee.subject).toContain('Welcome to');
    // One inline image per event date, referenced by the HTML.
    expect(toDee.attachments).toHaveLength(2);
    expect(toDee.attachments!.every((a) => a.contentType === 'image/png')).toBe(true);
    expect(toDee.attachments!.every((a) => (a.content?.byteLength ?? 0) > 100)).toBe(true);
    for (const attachment of toDee.attachments!) {
      expect(toDee.html).toContain(`cid:${attachment.cid}`);
    }
    // The dates it names are the event's own, in the event's zone.
    expect(toDee.html).toMatch(/Thursday,? 12 November 2026/);
    expect(toDee.html).toMatch(/Friday,? 13 November 2026/);
    expect(toDee.html).toContain('Lagos Oriental Hotel');
    // What the pack is for, and the honest line about what a code is not.
    expect(toDee.html).toMatch(/30, 60 and 90 days/);
    expect(toDee.html).toMatch(/holding the code is not attendance/);
    expect(toDee.text).toContain('WHAT HAPPENS WHEN');
    // The cancelled registration is not among the recipients.
    expect(mailer.sent.map((m) => m.to).join(' ')).not.toContain('gone-ob-');
  });

  it('sends nobody a second pack when the default scope is used again', async () => {
    mailer.sent.length = 0;
    const again = await call('post', `/events/${eventId}/onboarding/send`, {
      scope: 'not_yet_sent',
    });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ justSent: 0, justFailed: 0, sent: 2, pending: 0 });
    expect(mailer.sent).toHaveLength(0);
  });

  it('sends again to everyone when an admin asks for it, and records every attempt', async () => {
    mailer.sent.length = 0;
    const resend = await call('post', `/events/${eventId}/onboarding/send`, { scope: 'all' });
    expect(resend.body.justSent).toBe(2);
    expect(mailer.sent).toHaveLength(2);
    // Two attempts each, kept as history rather than overwritten.
    const rows = await prisma.onboardingSend.count({
      where: { delegate: { eventId }, status: 'sent' },
    });
    expect(rows).toBe(4);

    const audits = await prisma.auditLog.findMany({
      where: { eventId, action: 'onboarding.sent' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    // Counts, never an address.
    expect(JSON.stringify(audits.map((a) => a.newValue))).not.toContain('@example.com');
    expect(audits.at(-1)?.newValue).toMatchObject({ scope: 'all', sent: 2, failed: 0 });
  });

  it('gives a delegate their own card, and nobody else one', async () => {
    const card = await svgFrom(`/api/v1/me/events/${eventId}/badge.svg`, cookies.dee);
    expect(card.status, String(card.body)).toBe(200);
    expect(card.headers['content-type']).toContain('image/svg+xml');
    expect(card.body).toContain('Dee Legate');
    expect(card.body).toContain('I WILL BE ATTENDING');
    expect(card.body).toContain('NOVEMBER 12-13 2026');
    expect(card.body).toContain('Lagos Oriental Hotel');
    // Dee was not nominated by anyone, so no sponsor line is invented.
    expect(card.body).not.toContain('SPONSORED BY');

    // Staff have no card, and an event the delegate is not registered for has none either.
    expect(
      (
        await request(app())
          .get(`/api/v1/me/events/${eventId}/badge.svg`)
          .set('Cookie', cookies.admin ?? '')
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .get(`/api/v1/me/events/${randomUUID()}/badge.svg`)
          .set('Cookie', cookies.dee ?? '')
      ).status,
    ).toBe(404);
  });
});
