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
import { mailConfigFromEnv } from '../mail/config.js';
import { MemoryMailer } from '../mail/mailer.js';
import { sendDueFollowUpInvitations } from '../reminders/follow-ups.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

/**
 * The follow-up programme (backlog E12-1, E12-13, E12-14): the schedule an admin creates, and the
 * worker that invites and chases. The rule the tests lean hardest on is that a send happens once:
 * the invitation row is the lock, so a second pass over the same wave emails nobody again.
 */
describe.skipIf(!hasDatabase)('follow-up waves and invitations (E12)', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const delegateIds: string[] = [];
  const cookies: Record<string, string> = {};
  let boAccountId = '';
  let adminAccountId = '';
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-20T09:00:00.000Z');

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
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
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        lastSeenAt: now,
      },
    });
    return { account, cookie: `mbc_session=${token}` };
  }

  /** A session cookie for an existing account, minted at the clock's current value. */
  async function cookieFor(userAccountId: string) {
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + 86_400_000),
        lastSeenAt: now,
      },
    });
    return `mbc_session=${token}`;
  }

  /** Runs the worker with its own mailer so the test can count what went out. */
  async function runWorker() {
    const mailer = new MemoryMailer();
    const result = await sendDueFollowUpInvitations({
      prisma: () => prisma,
      mailer,
      mailConfig: mailConfigFromEnv({
        MAIL_FROM: 'ITTEC <conference@example.com>',
        MAIL_TRANSPORT: 'memory',
        APP_URL: ORIGIN,
        MAIL_CONTACT_EMAIL: 'conference@example.com',
      }),
      appUrl: ORIGIN,
      logger: silent,
      now: () => now,
      allowTestRegistrations: true,
    });
    return { ...result, sent: mailer.sent };
  }

  beforeAll(async () => {
    prisma = testPrisma();
    const event = await createTestEvent(prisma);
    eventId = event.id;
    // The schedule is worked out from the event's last day, so pin it.
    await prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'active',
        startsOn: new Date('2026-11-12T00:00:00.000Z'),
        endsOn: new Date('2026-11-13T00:00:00.000Z'),
        timezone: 'Africa/Lagos',
      },
    });
    const admin = await sessionFor('admin', `admin-fu-${tag}@example.com`);
    cookies.admin = admin.cookie;
    adminAccountId = admin.account.id;

    for (const name of ['Ada', 'Bo']) {
      const email = `${name.toLowerCase()}-fu-${tag}@example.com`;
      const account = await sessionFor('delegate', email);
      cookies[name.toLowerCase()] = account.cookie;
      const registered = await createRegisteredIdentity(prisma, eventId, email, {
        name: `${name} Delegate`,
        userAccountId: account.account.id,
      });
      identityIds.push(registered.identity.id);
      delegateIds.push(registered.delegate.id);
      if (name === 'Bo') boAccountId = account.account.id;
    }
    // A cancelled registration is never invited.
    const cancelled = await createRegisteredIdentity(
      prisma,
      eventId,
      `gone-fu-${tag}@example.com`,
      { name: 'Gone Away', registrationStatus: 'cancelled' },
    );
    identityIds.push(cancelled.identity.id);
  });

  afterAll(async () => {
    await prisma.assessmentResponse.deleteMany({ where: { stage: { eventId } } });
    await prisma.event.delete({ where: { id: eventId } });
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('creates the three waves as drafts, dated from the last day of the event', async () => {
    const created = await call('post', `/events/${eventId}/assessments/follow-ups`, {
      waves: [1, 2, 3],
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.created).toEqual([1, 2, 3]);
    const waves = created.body.waves as Array<Record<string, unknown>>;
    expect(waves.map((w) => w.label)).toEqual([
      '30-day follow-up',
      '60-day follow-up',
      '90-day follow-up',
    ]);
    // 30 days after 13 November, 09:00 in Lagos (UTC+1).
    expect(waves[0]!.opensAt).toBe('2026-12-13T08:00:00.000Z');
    expect(waves[1]!.opensAt).toBe('2027-01-12T08:00:00.000Z');
    // Drafts: creating a schedule never starts emailing anyone.
    expect(waves.every((w) => w.status === 'draft' && w.enabled === false)).toBe(true);
    // And empty: the questions are the event's own content.
    expect(waves.every((w) => w.questions === 0)).toBe(true);
    expect(created.body.eligible).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: { eventId, action: 'event.follow_ups_scheduled' },
    });
    expect(audit?.newValue).toMatchObject({ waves: [1, 2, 3] });
  });

  it('adds nothing on a second request and leaves the existing waves alone', async () => {
    const again = await call('post', `/events/${eventId}/assessments/follow-ups`, {
      waves: [1, 2, 3],
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toEqual([]);
    expect(again.body.waves).toHaveLength(3);

    // The longer-term wave is created only when asked for, and comes with no questions (E12-7).
    const longer = await call('post', `/events/${eventId}/assessments/follow-ups`, { waves: [4] });
    expect(longer.status).toBe(201);
    expect(longer.body.created).toEqual([4]);
    const wave4 = (longer.body.waves as Array<Record<string, unknown>>).find((w) => w.wave === 4);
    expect(wave4).toMatchObject({
      label: 'Longer-term follow-up',
      questions: 0,
      dueAfterDays: 180,
    });
  });

  it('is admin-only', async () => {
    expect(
      (await call('get', `/events/${eventId}/assessments/follow-ups`, undefined, '')).status,
    ).toBe(401);
    expect(
      (await call('get', `/events/${eventId}/assessments/follow-ups`, undefined, cookies.ada))
        .status,
    ).toBe(403);
  });

  it('refuses to open a wave that has no questions', async () => {
    const refused = await call('put', `/events/${eventId}/assessments/follow_up?wave=1`, {
      enabled: true,
      status: 'open',
      target: 'all_delegates',
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('stage_without_questions');
  });

  it('invites every eligible delegate once a wave is open, and never twice', async () => {
    // Give wave 1 a question and open it, as an admin would after reading the wording.
    const wave1 = await prisma.assessmentStageConfig.findFirstOrThrow({
      where: { eventId, stage: 'follow_up', wave: 1 },
    });
    await prisma.assessmentQuestion.create({
      data: {
        eventId,
        stageConfigId: wave1.id,
        order: 1,
        prompt: 'Have you started the action in your Transfer Plan?',
        type: 'yes_no',
        required: true,
      },
    });
    await call('put', `/events/${eventId}/assessments/follow_up?wave=1`, {
      enabled: true,
      status: 'scheduled',
      target: 'all_delegates',
      opensAt: '2026-12-13T08:00:00.000Z',
      closesAt: '2027-01-03T08:00:00.000Z',
    });

    // Before the opening time nothing goes out.
    expect(await runWorker()).toMatchObject({ invited: 0, reminded: 0 });

    now = new Date('2026-12-13T09:00:00.000Z');
    const first = await runWorker();
    expect(first.invited).toBe(2);
    expect(first.sent).toHaveLength(2);
    expect(first.sent[0]!.subject).toContain('30-day follow-up');
    // The cancelled registration is not among them.
    expect(first.sent.map((m) => m.to).join(' ')).not.toContain('gone-fu-');

    // A second pass sends nothing: the invitation row is the lock (E12-14 idempotent).
    const second = await runWorker();
    expect(second).toMatchObject({ invited: 0, reminded: 0, failed: 0 });
    expect(second.sent).toHaveLength(0);
    expect(await prisma.assessmentInvitation.count({ where: { stageConfigId: wave1.id } })).toBe(2);
  });

  it('chases only the delegate who has not submitted, up to the limit', async () => {
    const wave1 = await prisma.assessmentStageConfig.findFirstOrThrow({
      where: { eventId, stage: 'follow_up', wave: 1 },
      include: { questions: true },
    });
    // Ada answers; Bo does not.
    await prisma.assessmentResponse.create({
      data: {
        stageConfigId: wave1.id,
        delegateId: delegateIds[0]!,
        submittedAt: now,
        answers: { create: { questionId: wave1.questions[0]!.id, value: true } },
      },
    });

    // Too early for a chaser: the interval is seven days.
    now = new Date('2026-12-18T09:00:00.000Z');
    expect(await runWorker()).toMatchObject({ reminded: 0 });

    now = new Date('2026-12-20T09:00:00.000Z');
    const chase = await runWorker();
    expect(chase.reminded).toBe(1);
    expect(chase.sent).toHaveLength(1);
    expect(chase.sent[0]!.to).toContain('bo-fu-');
    expect(chase.sent[0]!.subject).toMatch(/Still open/);

    // The same pass again changes nothing.
    expect(await runWorker()).toMatchObject({ reminded: 0 });

    // The second chaser a week later, then the limit of two stops it.
    now = new Date('2026-12-27T09:00:00.000Z');
    expect(await runWorker()).toMatchObject({ reminded: 1 });
    now = new Date('2027-01-05T09:00:00.000Z');
    expect(await runWorker()).toMatchObject({ reminded: 0 });
    expect(
      await prisma.assessmentInvitation.count({
        where: { stageConfigId: wave1.id, kind: 'reminder' },
      }),
    ).toBe(2);
  });

  it('reports the response rate per wave', async () => {
    // The clock has moved months by now, past the admin session's own window.
    const schedule = await call(
      'get',
      `/events/${eventId}/assessments/follow-ups`,
      undefined,
      await cookieFor(adminAccountId),
    );
    const wave1 = (schedule.body.waves as Array<Record<string, unknown>>).find((w) => w.wave === 1);
    // Two invited, one submitted, of two eligible (E12-13).
    expect(wave1).toMatchObject({ invited: 2, submitted: 1 });
    expect(schedule.body.eligible).toBe(2);
  });

  it('sends nothing for a wave that is closed, disabled or still a draft', async () => {
    const wave1 = await prisma.assessmentStageConfig.findFirstOrThrow({
      where: { eventId, stage: 'follow_up', wave: 1 },
    });
    await prisma.assessmentStageConfig.update({
      where: { id: wave1.id },
      data: { status: 'closed' },
    });
    now = new Date('2026-12-14T09:00:00.000Z');
    expect(await runWorker()).toMatchObject({ invited: 0, reminded: 0 });

    await prisma.assessmentStageConfig.update({
      where: { id: wave1.id },
      data: { status: 'open', enabled: false },
    });
    expect(await runWorker()).toMatchObject({ invited: 0, reminded: 0 });
  });

  it('reports every wave on the journey, not just the first', async () => {
    // This test sets the state it needs rather than inheriting what an earlier one left.
    await prisma.assessmentStageConfig.updateMany({
      where: { eventId, stage: 'follow_up', wave: 1 },
      data: { enabled: true, status: 'scheduled' },
    });
    // Waves 2 and 3 need a question each to count as configured, as every stage does.
    for (const wave of [2, 3]) {
      const row = await prisma.assessmentStageConfig.findFirstOrThrow({
        where: { eventId, stage: 'follow_up', wave },
      });
      await prisma.assessmentQuestion.create({
        data: {
          eventId,
          stageConfigId: row.id,
          order: 1,
          prompt: `Wave ${wave} question`,
          type: 'long_text',
          required: true,
        },
      });
      await prisma.assessmentStageConfig.update({
        where: { id: row.id },
        data: { enabled: true, status: 'scheduled' },
      });
    }

    const journey = await call(
      'get',
      `/me/events/${eventId}/journey`,
      undefined,
      await cookieFor(boAccountId),
    );
    expect(journey.status, journey.text).toBe(200);
    const rows = journey.body.journey.assessments as Array<{
      stage: string;
      wave: number;
      waveLabel: string;
      state: string;
    }>;
    const followUps = rows.filter((r) => r.stage === 'follow_up');
    // Three rows, named: mapping the four stage names reported only the 30-day one and dropped
    // the 60- and 90-day waves entirely.
    expect(followUps.map((r) => r.waveLabel)).toEqual([
      '30-day follow-up',
      '60-day follow-up',
      '90-day follow-up',
    ]);
    expect(followUps.map((r) => r.wave)).toEqual([1, 2, 3]);
    // Wave 1 is open and Bo has not answered it; the later waves have not opened.
    expect(followUps[0]!.state).toBe('open');
    expect(followUps.slice(1).every((r) => r.state === 'not_yet_open')).toBe(true);
    // A stage the event does not run still gets exactly one row.
    expect(rows.filter((r) => r.stage === 'during_conference')).toHaveLength(1);
  });

  it('shows the delegate the wave with its own name, plan and expectation', async () => {
    await prisma.assessmentStageConfig.updateMany({
      where: { eventId, stage: 'follow_up', wave: 1 },
      data: { status: 'open', enabled: true },
    });
    const fresh = await cookieFor(boAccountId);
    const mine = await call('get', `/me/events/${eventId}/assessments`, undefined, fresh);
    expect(mine.status, mine.text).toBe(200);
    const wave = (mine.body.assessments as Array<Record<string, unknown>>).find(
      (a) => a.stage === 'follow_up',
    );
    expect(wave).toMatchObject({ wave: 1, waveLabel: '30-day follow-up' });
    // The plan is shown back rather than asked for again (E12-2); Bo has none yet, so null.
    expect(wave!.context).toHaveProperty('plan');
  });
});
