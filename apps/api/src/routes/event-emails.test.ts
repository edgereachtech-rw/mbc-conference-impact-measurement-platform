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
 * The organisers' own email wording per event (decision 2026-11-19): every kind is listed with
 * the platform's wording and a preview, a kind is saved on its own with its placeholders filled
 * per recipient, and the welcome pack tells a returning delegate their account carries over.
 */
describe.skipIf(!hasDatabase)('event email wording', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let earlierEventId = '';
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

  const call = (method: 'get' | 'post' | 'put', path: string, body?: object, cookie?: string) =>
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
        startsOn: new Date('2026-11-12T00:00:00.000Z'),
        endsOn: new Date('2026-11-13T00:00:00.000Z'),
        timezone: 'Africa/Lagos',
        location: 'Lagos Oriental Hotel',
      },
    });
    await prisma.eventDate.create({
      data: { eventId, date: new Date('2026-11-12T00:00:00.000Z') },
    });
    cookies.admin = (await sessionFor('admin', `admin-ew-${tag}@example.com`)).cookie;
    cookies.delegate = (await sessionFor('delegate', `dee-ew-${tag}@example.com`)).cookie;

    const dee = await createRegisteredIdentity(prisma, eventId, `dee-ew-${tag}@example.com`, {
      name: 'Dee Legate',
    });
    identityIds.push(dee.identity.id);
    const bo = await createRegisteredIdentity(prisma, eventId, `bo-ew-${tag}@example.com`, {
      name: 'Bo Newcomer',
    });
    identityIds.push(bo.identity.id);

    // Dee took part in an earlier event: the same person, registered there too.
    const earlier = await createTestEvent(prisma);
    earlierEventId = earlier.id;
    await prisma.event.update({
      where: { id: earlierEventId },
      data: {
        name: 'ITTEC 2025',
        status: 'archived',
        startsOn: new Date('2025-11-12T00:00:00.000Z'),
        endsOn: new Date('2025-11-13T00:00:00.000Z'),
      },
    });
    const deeBefore = await createRegisteredIdentity(
      prisma,
      earlierEventId,
      `dee-before-${tag}@example.com`,
      { name: 'Dee Legate' },
    );
    identityIds.push(deeBefore.identity.id);
    await prisma.delegate.update({
      where: { id: deeBefore.delegate.id },
      data: { identityId: dee.identity.id },
    });
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.event.delete({ where: { id: earlierEventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('lists every kind with the platform wording, a preview, and the placeholders it takes', async () => {
    expect(
      (await call('get', `/events/${eventId}/emails`, undefined, cookies.delegate)).status,
    ).toBe(403);
    const res = await call('get', `/events/${eventId}/emails`);
    expect(res.status, res.text).toBe(200);
    const kinds = res.body.emails.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('onboarding');
    expect(kinds).toContain('follow_up_reminder');
    expect(kinds).toContain('impact_check_sustaining');
    const pack = res.body.emails.find((e: { kind: string }) => e.kind === 'onboarding');
    expect(pack.custom).toBeNull();
    expect(pack.defaults.buttonLabel).toBe('Open my dashboard');
    // The event is a training: the platform's wording says so.
    expect(pack.defaults.intro).toContain('get out of the training');
    expect(pack.preview.html).toContain('At the training');
    expect(pack.placeholders).toEqual([
      'firstName',
      'name',
      'eventName',
      'link',
      'eventDates',
      'venue',
    ]);
  });

  it('saves one kind, fills its placeholders per delegate, and refuses one it does not know', async () => {
    const unknown = await call('put', `/events/${eventId}/emails/onboarding`, {
      intro: 'Dear {{firstName}}, your {{waveLabel}} awaits.',
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('unknown_placeholder');
    expect((await call('put', `/events/${eventId}/emails/nope`, { intro: 'x' })).status).toBe(404);

    const saved = await call('put', `/events/${eventId}/emails/onboarding`, {
      subject: 'Welcome aboard, {{firstName}}',
      intro:
        'Dear {{firstName}}, {{eventName}} runs {{eventDates}}.\n\nThis is where you keep track of what you take back to work.',
      buttonLabel: 'Go to my space',
    });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.email.custom).toMatchObject({
      subject: 'Welcome aboard, {{firstName}}',
      buttonLabel: 'Go to my space',
      title: null,
    });
    expect(saved.body.email.preview.subject).toBe('Welcome aboard, Ada');
    expect(saved.body.email.preview.html).toContain('Go to my space');

    // A preview of unsaved wording renders without storing it.
    const preview = await call('post', `/events/${eventId}/emails/onboarding/preview`, {
      title: 'Try this title',
    });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.html).toContain('Try this title');
    const listed = await call('get', `/events/${eventId}/emails`);
    expect(
      listed.body.emails.find((e: { kind: string }) => e.kind === 'onboarding').custom.title,
    ).toBeNull();

    // The pack goes out with the organisers' words, and tells Dee about her earlier event.
    mailer.sent.length = 0;
    const sent = await call('post', `/events/${eventId}/onboarding/send`, { scope: 'all' });
    expect(sent.status, sent.text).toBe(201);
    const toDee = mailer.sent.find((m) => m.to.startsWith('dee-ew-'))!;
    const toBo = mailer.sent.find((m) => m.to.startsWith('bo-ew-'))!;
    expect(toDee.subject).toBe('Welcome aboard, Dee');
    expect(toDee.text).toContain('Dear Dee, Test event');
    expect(toDee.text).toContain('Go to my space');
    expect(toDee.text).toContain('You already have an account here from ITTEC 2025');
    // A one-day event: one code, said so, and nobody is sent to an entrance.
    expect(toDee.subject).toBe('Welcome aboard, Dee');
    expect(toDee.text).toContain('YOUR CHECK-IN CODE\n');
    expect(toDee.text).not.toContain('YOUR CHECK-IN CODES');
    expect(toDee.text).toContain('Attached to this email as an image:');
    expect(toDee.html).toContain('check you in on the day');
    expect(toDee.html).not.toContain('entrance');
    expect(toDee.html).toContain('Check in with the code below');
    expect(toDee.text).toContain('this training starts fresh');
    expect(toBo.text).not.toContain('already have an account');

    // The whole content and the look (2026-11-19): the frame stays, the rest is theirs, and
    // the welcome pack still carries the codes after their content.
    const whole = await call('put', `/events/${eventId}/emails/onboarding`, {
      title: 'A note from the organisers',
      body: '## Welcome, {{firstName}}\n\nWe are glad you are joining **{{eventName}}**.\n\n- Bring your code\n- Open [your space]({{link}}) before the day',
      buttonLabel: 'Open my space',
      style: { accentColor: '#1a7f5a', align: 'center', fontSize: 'large' },
    });
    expect(whole.status, whole.text).toBe(200);
    expect(whole.body.email.custom.style).toEqual({
      accentColor: '#1A7F5A',
      textColor: null,
      headingColor: null,
      align: 'center',
      fontSize: 'large',
    });
    const html = whole.body.email.preview.html as string;
    expect(html).toContain('Welcome, Ada');
    expect(html).toContain('<strong>Test event');
    expect(html).toContain('bgcolor="#1A7F5A"');
    expect(html).toContain('text-align:center');
    expect(html).not.toContain('What happens when');
    expect(html).toContain('Open my space');
    mailer.sent.length = 0;
    const sentWhole = await call('post', `/events/${eventId}/onboarding/send`, { scope: 'all' });
    expect(sentWhole.status, sentWhole.text).toBe(201);
    const wholeToDee = mailer.sent.find((m) => m.to.startsWith('dee-ew-'))!;
    expect(wholeToDee.text).toContain('Welcome, Dee');
    expect(wholeToDee.text).toContain('YOUR CHECK-IN CODE');
    expect(wholeToDee.text).not.toContain('WHAT HAPPENS WHEN');
    expect(wholeToDee.html).toContain('cid:attendance-1@mbc');
    expect(
      (
        await call('put', `/events/${eventId}/emails/onboarding`, {
          style: { accentColor: 'red' },
        })
      ).status,
    ).toBe(422);

    // Clearing every field returns to the platform's wording and is audited.
    const cleared = await call('put', `/events/${eventId}/emails/onboarding`, {
      subject: '',
      intro: '',
      buttonLabel: '',
      body: '',
      style: null,
    });
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body.email.custom).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'event.email_wording_changed' } }),
    ).toBe(3);
  });
});
