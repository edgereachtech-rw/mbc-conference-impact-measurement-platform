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
  inviteToFollowUp,
  testPrisma,
} from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';
import { sendScheduledFollowUpInvitations } from '../reminders/follow-ups.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

/**
 * The follow-up programme (backlog E12-1, E12-13, E12-14; decision 2026-11-09): the schedule an
 * admin creates, and the invitations and reminders they send by hand. The rule the tests lean
 * hardest on is that an invitation goes once: the invitation row is the lock, so a second click
 * on the same wave emails nobody again, and a delegate sees a follow-up only once invited.
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
  // One mailer for the whole suite, so the emails the organisers send can be read back.
  const mailer = new MemoryMailer();
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
  /** The organisers send a wave's invitation or reminder; what went out is read back. */
  async function sendWave(wave: number, mode: 'invitations' | 'reminders') {
    const before = mailer.sent.length;
    const r = await call('post', `/events/${eventId}/assessments/follow-ups/${wave}/${mode}`, {});
    return {
      status: r.status,
      text: r.text,
      body: r.body as { sent: number; failed: number; skipped: number },
      mail: mailer.sent.slice(before),
    };
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

  it('creates the three waves as drafts, with windows of days 1-30, 31-60 and 61-90 after the event', async () => {
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
    // Day 1 after 13 November starts at midnight in Lagos (UTC+1); day 30 ends where day 31
    // starts (decision 2026-11-09).
    expect(waves[0]!.opensAt).toBe('2026-11-13T23:00:00.000Z');
    expect(waves[0]!.closesAt).toBe('2026-12-13T23:00:00.000Z');
    expect(waves[1]!.opensAt).toBe('2026-12-13T23:00:00.000Z');
    expect(waves[2]!.closesAt).toBe('2027-02-11T23:00:00.000Z');
    // No chaser by default: the delegate's own plan reminders point at the open follow-up.
    expect(waves.every((w) => w.reminderAfterDays === null && w.reminderLimit === 0)).toBe(true);
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
      // From day 91, with no end until an admin sets one.
      opensAt: '2027-02-11T23:00:00.000Z',
      closesAt: null,
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

  it("sends the invitation to every eligible delegate once, on the organisers' request, and only then shows the follow-up", async () => {
    // Give wave 1 a question and schedule it, as an admin would after reading the wording.
    const wave1 = await prisma.assessmentStageConfig.findFirstOrThrow({
      where: { eventId, stage: 'follow_up', wave: 1 },
    });
    await prisma.assessmentQuestion.create({
      data: {
        eventId,
        stageConfigId: wave1.id,
        order: 1,
        prompt: 'What have you done so far?',
        type: 'long_text',
        required: true,
      },
    });
    await call('put', `/events/${eventId}/assessments/follow_up?wave=1`, {
      enabled: true,
      status: 'scheduled',
      target: 'all_delegates',
      opensAt: '2026-11-13T23:00:00.000Z',
      closesAt: '2026-12-13T23:00:00.000Z',
    });
    // A draft wave cannot be sent.
    expect((await sendWave(2, 'invitations')).status).toBe(409);

    // Until the organisers send it, the follow-up does not exist for Bo.
    now = new Date('2026-11-20T09:00:00.000Z');
    const unseen = await call(
      'get',
      `/me/events/${eventId}/assessments`,
      undefined,
      await cookieFor(boAccountId),
    );
    expect(
      (unseen.body.assessments as Array<{ stage: string }>).some((a) => a.stage === 'follow_up'),
    ).toBe(false);

    const first = await sendWave(1, 'invitations');
    expect(first.status, first.text).toBe(200);
    expect(first.body.sent).toBe(2);
    expect(first.mail).toHaveLength(2);
    expect(first.mail[0]!.subject).toContain('30-day follow-up');
    // The cancelled registration is not among them.
    expect(first.mail.map((m) => m.to).join(' ')).not.toContain('gone-fu-');
    // Now Bo sees it and may answer.
    const seen = await call(
      'get',
      `/me/events/${eventId}/assessments`,
      undefined,
      await cookieFor(boAccountId),
    );
    expect(
      (seen.body.assessments as Array<{ stage: string; wave: number }>).find(
        (a) => a.stage === 'follow_up',
      ),
    ).toMatchObject({ wave: 1 });

    // A second click sends nothing: the invitation row is the lock (E12-14 idempotent).
    const second = await sendWave(1, 'invitations');
    expect(second.body).toMatchObject({ sent: 0, failed: 0 });
    expect(second.mail).toHaveLength(0);
    expect(await prisma.assessmentInvitation.count({ where: { stageConfigId: wave1.id } })).toBe(2);
    // Delegates cannot send.
    expect(
      (
        await request(app())
          .post(`/api/v1/events/${eventId}/assessments/follow-ups/1/invitations`)
          .set('Origin', ORIGIN)
          .set('Cookie', await cookieFor(boAccountId))
          .send({})
      ).status,
    ).toBe(403);
  });

  it('reminds only the delegates who have not submitted, each time the organisers ask', async () => {
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
        answers: { create: { questionId: wave1.questions[0]!.id, value: 'Started' } },
      },
    });
    const chase = await sendWave(1, 'reminders');
    expect(chase.status, chase.text).toBe(200);
    expect(chase.body.sent).toBe(1);
    expect(chase.mail).toHaveLength(1);
    expect(chase.mail[0]!.to).toContain('bo-fu-');
    expect(chase.mail[0]!.subject).toMatch(/Still open/);
    // Asking again sends another reminder to the same delegate: how often is the organisers'
    // call, and each one is its own row.
    expect((await sendWave(1, 'reminders')).body.sent).toBe(1);
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

  it('sends a scheduled invitation by itself once the time has passed, once', async () => {
    // Wave 2 gets a question and is scheduled; its invitation is set to go out on 14 December.
    const wave2 = await prisma.assessmentStageConfig.findFirstOrThrow({
      where: { eventId, stage: 'follow_up', wave: 2 },
    });
    await prisma.assessmentQuestion.create({
      data: {
        eventId,
        stageConfigId: wave2.id,
        order: 1,
        prompt: 'What have you applied?',
        type: 'long_text',
        required: true,
      },
    });
    await prisma.assessmentStageConfig.update({
      where: { id: wave2.id },
      data: { enabled: true, status: 'scheduled' },
    });
    const planned = await call('put', `/events/${eventId}/assessments/follow-ups/2/schedule`, {
      inviteAt: '2026-12-14T08:00:00.000Z',
    });
    expect(planned.status, planned.text).toBe(200);
    expect(
      (planned.body.waves as Array<{ wave: number; inviteAt: string | null }>).find(
        (w) => w.wave === 2,
      )?.inviteAt,
    ).toBe('2026-12-14T08:00:00.000Z');

    const job = (at: string) =>
      sendScheduledFollowUpInvitations({
        prisma: () => prisma,
        mailer,
        mailConfig,
        appUrl: ORIGIN,
        logger: silent,
        now: () => new Date(at),
        allowTestRegistrations: true,
      });
    // Not before the time.
    const before = mailer.sent.length;
    expect(await job('2026-12-14T07:00:00.000Z')).toMatchObject({ waves: 0, sent: 0 });
    expect(mailer.sent.length).toBe(before);
    // At the time: both eligible delegates, and the wave is stamped.
    expect(await job('2026-12-14T08:05:00.000Z')).toMatchObject({ waves: 1, sent: 2 });
    expect(
      mailer.sent
        .slice(before)
        .map((m) => m.subject)
        .join(' '),
    ).toContain('60-day follow-up');
    // Never twice.
    expect(await job('2026-12-14T08:10:00.000Z')).toMatchObject({ waves: 0, sent: 0 });
    const stamped = await prisma.assessmentStageConfig.findUniqueOrThrow({
      where: { id: wave2.id },
    });
    expect(stamped.invitesSentAt).toEqual(new Date('2026-12-14T08:05:00.000Z'));
    // Clearing the time is allowed; it changes nothing already sent.
    expect(
      (
        await call('put', `/events/${eventId}/assessments/follow-ups/2/schedule`, {
          inviteAt: null,
        })
      ).status,
    ).toBe(200);
  });

  it('refuses to send a wave that is closed, disabled or still a draft', async () => {
    const wave1 = await prisma.assessmentStageConfig.findFirstOrThrow({
      where: { eventId, stage: 'follow_up', wave: 1 },
    });
    await prisma.assessmentStageConfig.update({
      where: { id: wave1.id },
      data: { status: 'closed' },
    });
    expect((await sendWave(1, 'invitations')).status).toBe(409);
    await prisma.assessmentStageConfig.update({
      where: { id: wave1.id },
      data: { status: 'open', enabled: false },
    });
    expect((await sendWave(1, 'reminders')).status).toBe(409);
    expect((await sendWave(9, 'invitations')).status).toBe(404);
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
      // Scheduled for later: their default windows would already be open by this test's clock.
      await prisma.assessmentStageConfig.update({
        where: { id: row.id },
        data: {
          enabled: true,
          status: 'scheduled',
          opensAt: new Date('2028-01-01T00:00:00.000Z'),
          closesAt: null,
        },
      });
      // A follow-up is on the journey only once sent to the delegate (2026-11-09).
      await inviteToFollowUp(prisma, row.id, delegateIds[1]!);
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
