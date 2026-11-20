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
  deleteIdentity,
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
import { mailConfigFromEnv } from '../mail/config.js';
import { MemoryMailer } from '../mail/mailer.js';
import { batchInviteAt, sendScheduledFollowUpInvitations } from '../reminders/follow-ups.js';
import { sendDueTransferPlanReminders } from '../reminders/transfer-plans.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

/**
 * The checklist-and-commitment plan mode (2026-11-20): a training programme in batches whose
 * line managers name a training, tick the actions they plan to take, commit to one of them and
 * hear about it once; the organisers export it all by name and each batch's follow-up goes out
 * counted from its own day.
 */
describe.skipIf(!hasDatabase)('checklist and commitment', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-23T10:00:00.000Z');
  let deeId = '';
  let adaId = '';
  let planId = '';
  const mailer = new MemoryMailer();
  const mailConfig = mailConfigFromEnv({
    NODE_ENV: 'test',
    MAIL_TRANSPORT: 'memory',
    MAIL_FROM: 'Events <events@example.com>',
    APP_URL: ORIGIN,
  });

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      mailConfig,
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      now: () => now,
    });
  const call = (
    method: 'post' | 'patch' | 'put' | 'get',
    path: string,
    body?: object,
    cookie = cookies.admin,
  ) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);

  async function signedIn(key: string, role: 'admin' | 'delegate', email: string) {
    const account = await prisma.userAccount.create({ data: { email, role } });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date('2027-06-01T00:00:00Z'),
        lastSeenAt: new Date('2027-05-01T00:00:00Z'),
      },
    });
    cookies[key] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    await signedIn('admin', 'admin', `admin-cm-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-cm-${tag}@example.com`);
    const ada = await signedIn('ada', 'delegate', `ada-cm-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Line managers ${tag}`,
      description: 'd',
      eventType: 'training',
      organiser: 'M.Bryan',
      format: 'physical',
      timezone: 'Africa/Lagos',
      location: 'Lagos',
      dates: ['2026-11-23', '2026-11-24'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    // Two batches, one per day; Dee comes on the first, Ada on the second.
    const dates = created.body.event.dates as Array<{ id: string; date: string }>;
    const batches: string[] = [];
    for (const [i, d] of dates.entries()) {
      const b = await call('post', `/events/${eventId}/batches`, {
        eventDateId: d.id,
        name: `Batch ${i + 1}`,
      });
      expect(b.status, b.text).toBe(201);
      const list = b.body.batches as Array<{ id: string; name: string }>;
      batches.push(list.find((x) => x.name === `Batch ${i + 1}`)!.id);
    }
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const a = await createRegisteredIdentity(prisma, eventId, `dee-cm-${tag}@example.com`, {
      name: 'Dee Manager',
      userAccountId: dee.id,
    });
    const b = await createRegisteredIdentity(prisma, eventId, `ada-cm-${tag}@example.com`, {
      name: 'Ada Lead',
      userAccountId: ada.id,
    });
    identityIds.push(a.identity.id, b.identity.id);
    deeId = a.delegate.id;
    adaId = b.delegate.id;
    await prisma.delegate.update({
      where: { id: deeId },
      data: { batchId: batches[0], department: 'Claims' },
    });
    await prisma.delegate.update({ where: { id: adaId }, data: { batchId: batches[1] } });
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is chosen per event with its own wording, and placed before the closing assessments', async () => {
    const res = await call('patch', `/events/${eventId}`, {
      transferPlanMode: 'commitment',
      transferPlanPosition: 'before_closing',
      transferPlanTemplate: null,
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.event).toMatchObject({
      transferPlanMode: 'commitment',
      transferPlanPosition: 'before_closing',
      transferPlanTemplate: null,
    });
    // The delegate's event and journey carry it, and the form's default name.
    const mine = await call('get', `/me/events/${eventId}`, undefined, cookies.dee);
    expect(mine.status).toBe(200);
    expect(mine.body.event.transferPlan).toMatchObject({
      visible: true,
      mode: 'commitment',
      position: 'before_closing',
      title: 'My Training Checklist and Commitment',
    });
    const journey = await call('get', `/me/events/${eventId}/journey`, undefined, cookies.dee);
    expect(journey.status).toBe(200);
    expect(journey.body.journey).toMatchObject({
      transferPlanMode: 'commitment',
      transferPlanPosition: 'before_closing',
    });
    // A bad template is refused; a changed one is kept.
    expect(
      (await call('patch', `/events/${eventId}`, { transferPlanTemplate: { title: 'x' } })).status,
    ).toBe(422);
  });

  it('serves the form with its template, refuses a commitment outside the ticks, then saves and submits it with one reminder', async () => {
    const list = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    expect(list.status, list.text).toBe(200);
    planId = list.body.plans[0].id;
    const page = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    expect(page.body.mode).toBe('commitment');
    expect(page.body.template.groups).toHaveLength(4);
    const path = `/me/events/${eventId}/transfer-plans/${planId}/commitment`;
    const valid = {
      version: page.body.plan.version as number,
      trainingName: 'Coaching skills',
      ticked: ['explain_why', 'protect_time'],
      commitmentKey: 'protect_time',
      what: 'Block both afternoons',
      byOn: '2026-12-15',
      evidence: 'The calendar entries',
      reminderOn: '2026-12-10',
    };
    expect(
      (await call('put', path, { ...valid, commitmentKey: 'meet_agree' }, cookies.dee)).status,
    ).toBe(422);
    expect(
      (
        await call(
          'put',
          path,
          { ...valid, ticked: ['not_a_key'], commitmentKey: 'not_a_key' },
          cookies.dee,
        )
      ).status,
    ).toBe(422);
    expect((await call('put', path, { ...valid, ticked: [] }, cookies.dee)).status).toBe(422);
    // Ada cannot touch Dee's plan.
    expect((await call('put', path, valid, cookies.ada)).status).toBe(404);

    const saved = await call('put', path, valid, cookies.dee);
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.plan).toMatchObject({
      status: 'submitted',
      trainingName: 'Coaching skills',
      checklist: { ticked: ['explain_why', 'protect_time'], commitmentKey: 'protect_time' },
    });
    expect(saved.body.plan.submittedAt).toBe(now.toISOString());
    expect(saved.body.plan.actions).toHaveLength(1);
    expect(saved.body.plan.actions[0]).toMatchObject({
      title: 'Protect the trainee’s time to participate.',
      action: 'Block both afternoons',
      targetOn: '2026-12-15',
      evidence: 'The calendar entries',
      isPriority: true,
      reminder: {
        frequency: 'once',
        startOn: '2026-12-10',
        nextReminderAt: '2026-12-10T08:00:00.000Z',
      },
    });
    // Saving again changes it, against the version seen.
    const stale = await call('put', path, valid, cookies.dee);
    expect(stale.status).toBe(409);
    const again = await call(
      'put',
      path,
      { ...valid, version: saved.body.plan.version, reminderOn: null, what: 'Block Fridays' },
      cookies.dee,
    );
    expect(again.status, again.text).toBe(200);
    expect(again.body.plan.actions[0]).toMatchObject({
      action: 'Block Fridays',
      reminder: { frequency: 'none', nextReminderAt: null },
    });
    // Back to the reminder for the next test.
    const back = await call(
      'put',
      path,
      { ...valid, version: again.body.plan.version },
      cookies.dee,
    );
    expect(back.status).toBe(200);
  });

  it('reminds once on the chosen day with the commitment, then never again', async () => {
    const job = (at: string) =>
      sendDueTransferPlanReminders({
        prisma: () => prisma,
        mailer,
        mailConfig,
        appUrl: ORIGIN,
        logger: silent,
        now: () => new Date(at),
      });
    const before = mailer.sent.length;
    await job('2026-12-10T07:55:00.000Z');
    expect(mailer.sent.length).toBe(before);
    await job('2026-12-10T08:05:00.000Z');
    expect(mailer.sent.length).toBe(before + 1);
    const mail = mailer.sent.at(-1)!;
    expect(mail.subject).toContain('Protect the trainee');
    expect(mail.text).toContain('Block both afternoons');
    expect(mail.text).toContain('15 December 2026');
    expect(mail.text).toContain(`/account/events/${eventId}#transfer-plan`);
    await job('2026-12-11T08:05:00.000Z');
    expect(mailer.sent.length).toBe(before + 1);
  });

  it('exports the checklists and commitments by name, with the batch and department', async () => {
    const res = await call('get', `/events/${eventId}/transfer-plans/commitments.csv`);
    expect(res.status, res.text).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    const header = lines[0]!;
    expect(header).toContain(
      'Name,Email,Organisation,Department,Batch,What is the name of the training?',
    );
    expect(header).toContain('During training · Protect the trainee’s time to participate.');
    const dee = lines.find((l) => l.startsWith('Dee Manager'))!;
    expect(dee).toContain('Claims,Batch 1,Coaching skills');
    expect(dee).toContain('Block both afternoons,2026-12-15,The calendar entries,2026-12-10');
    // Ticked actions say Yes, the others stay blank: two Yes cells for two ticks.
    expect(dee.split(',').filter((c) => c === 'Yes')).toHaveLength(2);
    // Delegates only see their own.
    expect(
      (
        await call(
          'get',
          `/events/${eventId}/transfer-plans/commitments.csv`,
          undefined,
          cookies.dee,
        )
      ).status,
    ).toBe(403);
    // The organisers' list shows the training and the ticks.
    const list = await call('get', `/events/${eventId}/transfer-plans`);
    const row = (list.body.plans as Array<Record<string, unknown>>).find(
      (p) => p.planId === planId,
    );
    expect(row).toMatchObject({
      trainingName: 'Coaching skills',
      ticked: ['explain_why', 'protect_time'],
    });
  });

  it('sends a scheduled follow-up to each batch counted from its own day', async () => {
    expect(
      batchInviteAt(
        new Date('2026-12-24T08:00:00.000Z'),
        new Date('2026-11-24'),
        new Date('2026-11-23'),
      ),
    ).toEqual(new Date('2026-12-23T08:00:00.000Z'));
    const wave = await prisma.assessmentStageConfig.upsert({
      where: { eventId_stage_wave: { eventId, stage: 'follow_up', wave: 1 } },
      update: {
        dueAfterDays: 30,
        enabled: true,
        status: 'scheduled',
        inviteAt: new Date('2026-12-24T08:00:00.000Z'),
      },
      create: {
        eventId,
        stage: 'follow_up',
        wave: 1,
        dueAfterDays: 30,
        enabled: true,
        status: 'scheduled',
        inviteAt: new Date('2026-12-24T08:00:00.000Z'),
      },
    });
    await prisma.assessmentQuestion.create({
      data: { eventId, stageConfigId: wave.id, order: 1, prompt: 'Update?', type: 'long_text' },
    });
    const job = (at: string) =>
      sendScheduledFollowUpInvitations({
        prisma: () => prisma,
        mailer,
        mailConfig,
        appUrl: ORIGIN,
        logger: silent,
        now: () => new Date(at),
      });
    const before = mailer.sent.length;
    expect(await job('2026-12-23T07:55:00.000Z')).toMatchObject({ waves: 0, sent: 0 });
    // The first batch's day was 23 November: its invitation goes a day before the scheduled time.
    expect(await job('2026-12-23T08:05:00.000Z')).toMatchObject({ waves: 1, sent: 1 });
    expect(mailer.sent.at(-1)!.to).toContain(`dee-cm-${tag}@example.com`);
    const open = await prisma.assessmentStageConfig.findUniqueOrThrow({ where: { id: wave.id } });
    expect(open.status).toBe('open');
    expect(open.invitesSentAt).toBeNull();
    // Dee sees it now; Ada not yet.
    now = new Date('2026-12-23T09:00:00.000Z');
    const deeList = await call('get', `/me/events/${eventId}/assessments`, undefined, cookies.dee);
    expect(
      (deeList.body.assessments as Array<{ stage: string }>).some((a) => a.stage === 'follow_up'),
    ).toBe(true);
    const adaList = await call('get', `/me/events/${eventId}/assessments`, undefined, cookies.ada);
    expect(
      (adaList.body.assessments as Array<{ stage: string }>).some((a) => a.stage === 'follow_up'),
    ).toBe(false);
    // The second batch at the scheduled time, and the wave is stamped sent.
    expect(await job('2026-12-24T08:05:00.000Z')).toMatchObject({ waves: 1, sent: 1 });
    expect(mailer.sent.at(-1)!.to).toContain(`ada-cm-${tag}@example.com`);
    expect(await job('2026-12-24T08:10:00.000Z')).toMatchObject({ waves: 0, sent: 0 });
    expect(mailer.sent.length).toBe(before + 2);
    expect(
      (await prisma.assessmentStageConfig.findUniqueOrThrow({ where: { id: wave.id } }))
        .invitesSentAt,
    ).toEqual(new Date('2026-12-24T08:05:00.000Z'));
  });
});
