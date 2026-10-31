import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { seedReferenceQuestions } from '../assessments/ittec-references.js';
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
import { sendDueTransferPlanReminders } from '../reminders/transfer-plans.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('individual transfer plans', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-05T10:00:00.000Z');
  let deeId = '';
  let questionKey = '';

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      now: () => now,
    });
  const call = (
    method: 'post' | 'patch' | 'put' | 'delete' | 'get',
    path: string,
    body?: object,
    cookie = cookies.admin,
  ) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);

  /** Moves the test clock and keeps every session inside the idle window. */
  async function tick(iso: string) {
    now = new Date(iso);
    for (const cookie of Object.values(cookies)) await call('get', '/auth/me', undefined, cookie);
  }

  async function signedIn(key: string, role: 'admin' | 'delegate', email: string) {
    const account = await prisma.userAccount.create({ data: { email, role } });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    cookies[key] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    await signedIn('admin', 'admin', `admin-tp-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-tp-${tag}@example.com`);
    const ada = await signedIn('ada', 'delegate', `ada-tp-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `TP ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12', '2026-11-13'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const a = await createRegisteredIdentity(prisma, eventId, `dee-tp-${tag}@example.com`, {
      name: 'Dee Legate',
      userAccountId: dee.id,
    });
    const b = await createRegisteredIdentity(prisma, eventId, `ada-tp-${tag}@example.com`, {
      name: 'Ada Other',
      userAccountId: ada.id,
    });
    identityIds.push(a.identity.id, b.identity.id);
    deeId = a.delegate.id;
    // A pre-conference question Dee answered, to come back as a reference.
    const stage = await prisma.assessmentStageConfig.findUniqueOrThrow({
      where: { eventId_stage: { eventId, stage: 'pre_conference' } },
    });
    const question = await prisma.assessmentQuestion.create({
      data: {
        stageConfigId: stage.id,
        eventId,
        order: 1,
        prompt: 'What would you like to learn or gain from the conference?',
        type: 'long_text',
      },
    });
    questionKey = question.questionKey;
    await prisma.assessmentResponse.create({
      data: {
        stageConfigId: stage.id,
        delegateId: deeId,
        submittedAt: now,
        answers: { create: { questionId: question.id, value: 'How to measure transfer' } },
      },
    });
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('creates one draft per delegate on first access, visible only to that delegate', async () => {
    const mine = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.plan).toMatchObject({ status: 'draft', version: 1, actions: [] });
    expect(mine.body.sessions).toEqual([]);
    expect(mine.body.canSubmit).toBe(true); // no planning session scheduled yet
    expect(mine.body.references).toEqual([]);
    const again = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    expect(again.body.plan.id).toBe(mine.body.plan.id);
    expect((await call('get', `/me/events/${eventId}/transfer-plan`)).status).toBe(403);
    expect(
      (await call('get', `/me/events/${randomUUID()}/transfer-plan`, undefined, cookies.dee))
        .status,
    ).toBe(404);
    expect(
      (await call('get', `/events/${eventId}/transfer-plans`, undefined, cookies.dee)).status,
    ).toBe(403);
  });

  it('shows the pre-event answers the admin picked as references', async () => {
    const before = await call('get', `/events/${eventId}/reference-questions`);
    expect(before.status, before.text).toBe(200);
    expect(before.body.references).toEqual([]);
    expect(before.body.questions.map((q: { questionKey: string }) => q.questionKey)).toContain(
      questionKey,
    );
    const bad = await call('put', `/events/${eventId}/reference-questions`, {
      questionKeys: [randomUUID()],
    });
    expect(bad.status).toBe(422);
    // The ITTEC seed matches the prompt wording once and never overrides an admin's choice.
    expect(await prisma.$transaction((tx) => seedReferenceQuestions(tx, eventId))).toBe(1);
    expect(await prisma.$transaction((tx) => seedReferenceQuestions(tx, eventId))).toBe(0);
    expect((await call('get', `/events/${eventId}/reference-questions`)).body.references).toEqual([
      questionKey,
    ]);
    const mine = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    expect(mine.body.references).toEqual([
      {
        questionKey,
        prompt: 'What would you like to learn or gain from the conference?',
        answer: 'How to measure transfer',
      },
    ]);
    // The admin's list replaces the seed's; duplicates collapse; an empty list clears it.
    const twice = await call('put', `/events/${eventId}/reference-questions`, {
      questionKeys: [questionKey, questionKey],
    });
    expect(twice.status, twice.text).toBe(200);
    expect(twice.body.references).toEqual([questionKey]);
    const ada = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.ada);
    expect(ada.body.references[0].answer).toBeNull();
  });

  it('saves the draft with one first priority, refuses stale saves and keeps the plan continuous', async () => {
    const first = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      {
        version: 1,
        actions: [
          { action: 'Define measures before training', isPriority: true, startOn: '2026-11-20' },
          { action: 'Brief stakeholders', isPriority: true },
          { priorityLearning: 'only a learning, no action yet' },
        ],
        reminder: { frequency: 'fortnightly', startOn: '2026-11-20' },
      },
      cookies.dee,
    );
    expect(first.status, first.text).toBe(200);
    expect(first.body.plan.version).toBe(2);
    expect(first.body.plan.actions.map((a: { isPriority: boolean }) => a.isPriority)).toEqual([
      true,
      false,
      false,
    ]);
    expect(first.body.plan.actions[0].startOn).toBe('2026-11-20');
    expect(first.body.plan.reminder).toMatchObject({
      frequency: 'fortnightly',
      startOn: '2026-11-20',
      nextReminderAt: '2026-11-20T08:00:00.000Z',
    });
    // The same old version again: refused, nothing overwritten.
    const stale = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      { version: 1, actions: [], reminder: { frequency: 'none' } },
      cookies.dee,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_plan');
    // Editing later keeps ids and removes what is left out.
    const ids = first.body.plan.actions.map((a: { id: string }) => a.id) as string[];
    const second = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      {
        version: 2,
        actions: [
          { id: ids[1], action: 'Brief stakeholders', isPriority: true, targetOn: '2026-12-15' },
          { id: ids[0], action: 'Define measures before training' },
        ],
        reminder: { frequency: 'none' },
      },
      cookies.dee,
    );
    expect(second.status, second.text).toBe(200);
    expect(second.body.plan.actions.map((a: { id: string }) => a.id)).toEqual([ids[1], ids[0]]);
    expect(second.body.plan.actions[0]).toMatchObject({ isPriority: true, order: 1 });
    expect(second.body.plan.reminder.nextReminderAt).toBeNull();
    const foreign = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      { version: 1, actions: [{ id: ids[0], action: 'steal' }] },
      cookies.ada,
    );
    expect(foreign.status).toBe(422);
  });

  it('opens submission with the designated final planning session, snapshots it and stays editable', async () => {
    const s1 = await call('post', `/events/${eventId}/sessions`, {
      title: 'Transfer Planning 1',
      date: '2026-11-12',
      startTime: '16:00',
      endTime: '17:00',
      sessionType: 'transfer_planning',
      transferPlanningFinal: true, // a mistake, corrected below
    });
    expect(s1.status, s1.text).toBe(201);
    const s2 = await call('post', `/events/${eventId}/sessions`, {
      title: 'Transfer Planning 2',
      date: '2026-11-13',
      startTime: '14:00',
      endTime: '15:30',
      sessionType: 'transfer_planning',
    });
    expect(s2.status, s2.text).toBe(201);
    const firstId = s1.body.event.sessions.find(
      (s: { title: string }) => s.title === 'Transfer Planning 1',
    ).id;
    const secondId = s2.body.event.sessions.find(
      (s: { title: string }) => s.title === 'Transfer Planning 2',
    ).id;
    await call('patch', `/events/${eventId}/sessions/${firstId}`, { transferPlanningFinal: false });
    await call('patch', `/events/${eventId}/sessions/${secondId}`, { transferPlanningFinal: true });

    await tick('2026-11-10T10:00:00.000Z');
    const early = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    expect(early.body.sessions.map((s: { isFinal: boolean }) => s.isFinal)).toEqual([false, true]);
    expect(early.body.canSubmit).toBe(false);
    const refused = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/submit`,
      { version: early.body.plan.version },
      cookies.dee,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('not_yet');

    await tick('2026-11-13T13:30:00.000Z'); // 14:30 in Lagos, the final session has begun
    const open = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    expect(open.body.canSubmit).toBe(true);
    const empty = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/submit`,
      { version: 1 },
      cookies.ada,
    );
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('plan_empty');
    const submitted = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/submit`,
      { version: open.body.plan.version },
      cookies.dee,
    );
    expect(submitted.status, submitted.text).toBe(200);
    expect(submitted.body.plan).toMatchObject({
      status: 'submitted',
      submittedAt: '2026-11-13T13:30:00.000Z',
    });
    expect(submitted.body.canSubmit).toBe(false);
    const twice = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/submit`,
      { version: submitted.body.plan.version },
      cookies.dee,
    );
    expect(twice.body.error.code).toBe('already_submitted');

    // After the event the plan stays open for changes; the snapshot does not move.
    await tick('2026-11-18T09:00:00.000Z');
    const edited = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      {
        version: submitted.body.plan.version,
        actions: submitted.body.plan.actions.map((a: { id: string; action: string }) => ({
          id: a.id,
          action: `${a.action} (revised)`,
          isPriority: a.id === submitted.body.plan.actions[0].id,
        })),
        reminder: { frequency: 'weekly' },
      },
      cookies.dee,
    );
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.plan.status).toBe('submitted');
    expect(edited.body.plan.actions[0].action).toMatch(/\(revised\)$/);
    const detail = await call('get', `/events/${eventId}/transfer-plans/${deeId}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.plan.snapshot.actions[0].action).toBe('Brief stakeholders');
    expect(detail.body.plan.plan.actions[0].action).toBe('Brief stakeholders (revised)');
    expect(detail.body.plan.references[0].answer).toBe('How to measure transfer');
    expect(detail.body.plan.history.map((h: { action: string }) => h.action)).toContain(
      'transfer_plan.submitted',
    );
  });

  it('records progress per action and counts it for the organisers', async () => {
    await tick('2026-11-24T09:00:00.000Z');
    const mine = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    const actionId = mine.body.plan.actions[0].id as string;
    const progress = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/actions/${actionId}/progress`,
      { status: 'applied', note: 'Used the measures in the Q1 plan', newTargetOn: '2027-01-15' },
      cookies.dee,
    );
    expect(progress.status, progress.text).toBe(201);
    const action = progress.body.plan.actions[0];
    expect(action.progressStatus).toBe('applied');
    expect(action.targetOn).toBe('2027-01-15');
    expect(action.progress).toHaveLength(1);
    expect(action.progress[0]).toMatchObject({ status: 'applied', newTargetOn: '2027-01-15' });
    const other = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/actions/${actionId}/progress`,
      { status: 'completed', note: 'done' },
      cookies.ada,
    );
    expect(other.status).toBe(404);

    const list = await call('get', `/events/${eventId}/transfer-plans`);
    expect(list.status, list.text).toBe(200);
    const dee = list.body.plans.find((p: { delegate: { id: string } }) => p.delegate.id === deeId);
    expect(dee).toMatchObject({
      status: 'submitted',
      actions: 2,
      priorityAction: 'Brief stakeholders (revised)',
      reminderFrequency: 'weekly',
    });
    expect(dee.progress).toMatchObject({ applied: 1, not_started: 1 });
    expect(list.body.sessions).toHaveLength(2);
  });

  it('sends the reminders delegates asked for, once per interval, and logs each attempt', async () => {
    const mailer = new MemoryMailer();
    const deps = {
      prisma: () => prisma,
      mailer,
      mailConfig: mailConfigFromEnv({
        NODE_ENV: 'test',
        MAIL_TRANSPORT: 'memory',
        MAIL_FROM: 'Events <events@example.com>',
        APP_URL: ORIGIN,
      }),
      appUrl: ORIGIN,
      logger: silent,
      now: () => now,
    };
    const plan = await prisma.transferPlan.findUniqueOrThrow({
      where: { eventId_delegateId: { eventId, delegateId: deeId } },
    });
    expect(plan.nextReminderAt).toEqual(new Date('2026-11-25T09:00:00.000Z')); // weekly from the 18th
    now = new Date('2026-11-24T12:00:00.000Z');
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 0, sent: 0 });
    await tick('2026-11-25T09:05:00.000Z');
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toMatch(/plan going/);
    expect(mailer.sent[0]!.text).toContain('Brief stakeholders (revised)');
    expect(mailer.sent[0]!.text).toContain(`${ORIGIN}/account/events/${eventId}#transfer-plan`);
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 0 });
    const after = await prisma.transferPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.nextReminderAt).toEqual(new Date('2026-12-02T09:05:00.000Z'));
    const mine = await call('get', `/me/events/${eventId}/transfer-plan`, undefined, cookies.dee);
    expect(mine.body.reminders).toHaveLength(1);
    expect(mine.body.reminders[0]).toMatchObject({ status: 'sent' });
  });
});
