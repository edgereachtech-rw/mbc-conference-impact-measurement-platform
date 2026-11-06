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
 * Emailing the session feedback form (task of 2026-11-03). The rule that matters most is who is
 * written to: only delegates recorded as attending the session, because the form refuses anyone
 * else's submission.
 */
describe.skipIf(!hasDatabase)('emailing the session feedback form', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let sessionId = '';
  let dateId = '';
  const mailer = new MemoryMailer();
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const delegates: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-12T16:00:00.000Z');
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

  const base = () => `/events/${eventId}/feedback/sessions/${sessionId}/invitations`;
  const call = (method: 'get' | 'post', path: string, body?: object, cookie?: string) =>
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
        startsOn: new Date('2026-11-12T00:00:00.000Z'),
        endsOn: new Date('2026-11-13T00:00:00.000Z'),
        timezone: 'Africa/Lagos',
      },
    });
    const admin = await sessionFor('admin', `admin-fbi-${tag}@example.com`);
    cookies.admin = admin.cookie;
    const date = await prisma.eventDate.create({
      data: { eventId, date: new Date('2026-11-12T00:00:00.000Z') },
    });
    dateId = date.id;
    const session = await prisma.eventSession.create({
      data: {
        eventId,
        eventDateId: dateId,
        title: 'Measuring transfer',
        sessionType: 'workshop',
        startTime: '14:00',
        endTime: '15:30',
        speaker: 'Dr A. Speaker',
        feedbackEnabled: true,
        feedbackCode: `fb-${tag}`,
      },
    });
    sessionId = session.id;

    // Three delegates: two were in the room, one was not.
    for (const name of ['Ada', 'Bo', 'Cal']) {
      const email = `${name.toLowerCase()}-fbi-${tag}@example.com`;
      const registered = await createRegisteredIdentity(prisma, eventId, email, { name });
      identityIds.push(registered.identity.id);
      delegates[name] = registered.delegate.id;
    }
    for (const name of ['Ada', 'Bo']) {
      await prisma.sessionAttendance.create({
        data: {
          eventId,
          sessionId,
          delegateId: delegates[name]!,
          recordedByUserId: admin.account.id,
        },
      });
    }
  });

  afterAll(async () => {
    // An answer holds its question with onDelete: Restrict, so the responses go before the event
    // or the delete fails and the fixtures are left behind for every later run.
    await prisma.sessionFeedbackResponse.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('counts only the delegates who were in the room', async () => {
    const state = await call('get', base());
    expect(state.status, state.text).toBe(200);
    // Three registered, two attended: only those two can submit, so only those two count.
    expect(state.body).toMatchObject({
      sendable: true,
      attended: 2,
      invited: 0,
      submitted: 0,
      notSent: 2,
      notSubmitted: 2,
    });
    expect(state.body.reason).toBeNull();
  });

  it('is admin-only', async () => {
    expect((await call('get', base(), undefined, '')).status).toBe(401);
  });

  it('emails the attendees, with the session and the link, and nobody else', async () => {
    mailer.sent.length = 0;
    const sent = await call('post', `${base()}/send`, { scope: 'not_sent' });
    expect(sent.status, sent.text).toBe(201);
    expect(sent.body).toMatchObject({ justSent: 2, justFailed: 0, invited: 2, notSent: 0 });

    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      `ada-fbi-${tag}@example.com`,
      `bo-fbi-${tag}@example.com`,
    ]);
    // Cal was not in the room and is never written to.
    expect(mailer.sent.map((m) => m.to).join(' ')).not.toContain('cal-fbi-');

    const toAda = mailer.sent.find((m) => m.to.startsWith('ada-'))!;
    expect(toAda.subject).toBe('How was Measuring transfer?');
    expect(toAda.html).toContain(`${ORIGIN}/feedback/fb-${tag}`);
    expect(toAda.html).toContain('Dr A. Speaker');
    expect(toAda.html).toMatch(/Thursday,? 12 November, 14:00-15:30/);
    // It says why they were asked, which is what makes it not spam.
    expect(toAda.html).toMatch(/your attendance at this session was recorded/);
  });

  it('sends nobody a second copy under the default scope', async () => {
    mailer.sent.length = 0;
    const again = await call('post', `${base()}/send`, { scope: 'not_sent' });
    expect(again.body).toMatchObject({ justSent: 0, justFailed: 0 });
    expect(mailer.sent).toHaveLength(0);
  });

  it('chases only the attendees who have not answered', async () => {
    // Ada answers; Bo does not.
    const question = await prisma.sessionFeedbackQuestion.create({
      data: { eventId, order: 1, prompt: 'How was it?', type: 'rating' },
    });
    await prisma.sessionFeedbackResponse.create({
      data: {
        eventId,
        sessionId,
        delegateId: delegates.Ada!,
        submittedAt: now,
        updatedAt: now,
        answers: { create: { questionId: question.id, value: 'good' } },
      },
    });

    mailer.sent.length = 0;
    const chase = await call('post', `${base()}/send`, { scope: 'not_submitted' });
    expect(chase.body).toMatchObject({ justSent: 1, submitted: 1, notSubmitted: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toContain('bo-fbi-');
  });

  it('refuses to send when the form is not open', async () => {
    await prisma.eventSession.update({
      where: { id: sessionId },
      data: { feedbackClosesAt: new Date('2026-11-12T10:00:00.000Z') },
    });
    const state = await call('get', base());
    expect(state.body).toMatchObject({ sendable: false });
    expect(state.body.reason).toMatch(/closed/);
    const refused = await call('post', `${base()}/send`, { scope: 'not_sent' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('not_sendable');

    // And when feedback is off there is no link to send at all.
    await prisma.eventSession.update({
      where: { id: sessionId },
      data: { feedbackClosesAt: null, feedbackEnabled: false },
    });
    const off = await call('get', base());
    expect(off.body.reason).toMatch(/Turn session feedback on/);
    expect((await call('post', `${base()}/send`, { scope: 'all' })).status).toBe(409);
  });

  it('audits every send with counts and no addresses', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { eventId, action: 'feedback.invitations_sent' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits.map((a) => a.newValue))).not.toContain('@example.com');
    expect(audits[0]!.newValue).toMatchObject({ scope: 'not_sent', sent: 2 });
  });
});
