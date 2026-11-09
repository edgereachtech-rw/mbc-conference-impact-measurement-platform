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
  let planId = '';
  let adaPlanId = '';
  const mailer = new MemoryMailer();
  let questionKey = '';

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => mailer,
      mailConfig: mailConfigFromEnv({
        NODE_ENV: 'test',
        MAIL_TRANSPORT: 'memory',
        MAIL_FROM: 'Events <events@example.com>',
        APP_URL: ORIGIN,
      }),
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
    // Sessions end after seven idle days: a long jump is taken in steps that keep them alive.
    const target = new Date(iso);
    while (target.getTime() - now.getTime() > 6 * 86_400_000) {
      now = new Date(now.getTime() + 6 * 86_400_000);
      for (const cookie of Object.values(cookies)) await call('get', '/auth/me', undefined, cookie);
    }
    now = target;
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
      where: { eventId_stage_wave: { eventId, stage: 'pre_conference', wave: 1 } },
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
    const list = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    expect(list.status, list.text).toBe(200);
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0]).toMatchObject({
      sequence: 1,
      title: '',
      status: 'draft',
      actions: 0,
    });
    planId = list.body.plans[0].id;
    const mine = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.plan).toMatchObject({ status: 'draft', version: 1, actions: [], sequence: 1 });
    expect(mine.body.sessions).toEqual([]);
    expect(mine.body.canSubmit).toBe(true); // no planning session scheduled yet
    expect(mine.body.references).toEqual([]);
    const again = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    expect(again.body.plans[0].id).toBe(planId);
    expect((await call('get', `/me/events/${eventId}/transfer-plans`)).status).toBe(403);
    expect(
      (await call('get', `/me/events/${randomUUID()}/transfer-plans`, undefined, cookies.dee))
        .status,
    ).toBe(404);
    // Another delegate's plan id is simply not found.
    const adaList = await call(
      'get',
      `/me/events/${eventId}/transfer-plans`,
      undefined,
      cookies.ada,
    );
    adaPlanId = adaList.body.plans[0].id;
    expect(
      (await call('get', `/me/events/${eventId}/transfer-plans/${planId}`, undefined, cookies.ada))
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
    const mine = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
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
    const ada = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${adaPlanId}`,
      undefined,
      cookies.ada,
    );
    expect(ada.body.references[0].answer).toBeNull();
  });

  it('saves the draft with one first priority, refuses stale saves and keeps the plan continuous', async () => {
    const first = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      {
        version: 1,
        actions: [
          {
            title: 'Measures first',
            priorityLearning: 'Measurement before training',
            action: 'Define measures before training',
            isPriority: true,
            startOn: '2026-11-20',
          },
          {
            title: 'Stakeholder briefing',
            priorityLearning: 'Stakeholder engagement',
            action: 'Brief stakeholders',
            isPriority: true,
          },
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
      endOn: null,
      time: '09:00',
      days: [],
    });
    // The same old version again: refused, nothing overwritten.
    const stale = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      { version: 1, actions: [], reminder: { frequency: 'none' } },
      cookies.dee,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_plan');
    // Editing later keeps ids and removes what is left out.
    const ids = first.body.plan.actions.map((a: { id: string }) => a.id) as string[];
    const second = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      {
        version: 2,
        actions: [
          {
            id: ids[1],
            title: 'Stakeholder briefing',
            priorityLearning: 'Stakeholder engagement',
            action: 'Brief stakeholders',
            isPriority: true,
            targetOn: '2026-12-15',
          },
          {
            id: ids[0],
            title: 'Measures first',
            priorityLearning: 'Measurement before training',
            action: 'Define measures before training',
            measureStatus: 'not_yet_known',
          },
        ],
        reminder: { frequency: 'none' },
      },
      cookies.dee,
    );
    expect(second.status, second.text).toBe(200);
    expect(second.body.plan.actions.map((a: { id: string }) => a.id)).toEqual([ids[1], ids[0]]);
    expect(second.body.plan.actions[0]).toMatchObject({ isPriority: true, order: 1 });
    // The business-measure question is answered with the action (2026-11-08); null until then.
    expect(
      second.body.plan.actions.map((a: { measureStatus: string | null }) => a.measureStatus),
    ).toEqual([null, 'not_yet_known']);
    expect(second.body.plan.reminder.nextReminderAt).toBeNull();
    const foreign = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${adaPlanId}`,
      { version: 1, actions: [{ id: ids[0], action: 'steal' }] },
      cookies.ada,
    );
    expect(foreign.status).toBe(422);
  });

  it('lists the planning sessions, accepts submission at any time, snapshots it and stays editable', async () => {
    const s1 = await call('post', `/events/${eventId}/sessions`, {
      title: 'Transfer Planning 1',
      date: '2026-11-12',
      startTime: '16:00',
      endTime: '17:00',
      sessionType: 'transfer_planning',
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
    // No setting chooses the closing session: the later one in the schedule is it.
    expect(firstId).not.toBe(secondId);

    // Submission is open at any time (decision 2026-11-08), before the sessions as well; the
    // final session is still named for the delegate.
    await tick('2026-11-10T10:00:00.000Z');
    const early = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    expect(early.body.sessions.map((s: { isFinal: boolean }) => s.isFinal)).toEqual([false, true]);
    expect(early.body.canSubmit).toBe(true);

    await tick('2026-11-13T13:30:00.000Z'); // 14:30 in Lagos, during the final session
    const open = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    expect(open.body.canSubmit).toBe(true);
    const empty = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${adaPlanId}/submit`,
      { version: 1 },
      cookies.ada,
    );
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('plan_empty');
    // A third action with only a learning blocks submission until it is complete or removed.
    type Saved = {
      id: string;
      title: string;
      priorityLearning: string;
      action: string;
      isPriority: boolean;
      startOn: string | null;
      targetOn: string | null;
    };
    const pick = (a: Saved) => ({
      id: a.id,
      title: a.title,
      priorityLearning: a.priorityLearning,
      action: a.action,
      isPriority: a.isPriority,
      startOn: a.startOn,
      targetOn: a.targetOn,
    });
    const withGap = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      {
        version: open.body.plan.version,
        actions: [
          ...open.body.plan.actions.map(pick),
          { priorityLearning: 'only a learning, no action yet' },
        ],
        reminder: open.body.plan.reminder,
      },
      cookies.dee,
    );
    expect(withGap.status, withGap.text).toBe(200);
    const incomplete = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/submit`,
      { version: withGap.body.plan.version },
      cookies.dee,
    );
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe('plan_incomplete');
    expect(incomplete.body.gaps).toEqual([
      { index: 2, id: expect.any(String), missing: ['title', 'action'] },
    ]);
    const trimmed = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      {
        version: withGap.body.plan.version,
        actions: withGap.body.plan.actions.slice(0, 2).map(pick),
        reminder: withGap.body.plan.reminder,
      },
      cookies.dee,
    );
    expect(trimmed.status, trimmed.text).toBe(200);
    const submitted = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/submit`,
      { version: trimmed.body.plan.version },
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
      `/me/events/${eventId}/transfer-plans/${planId}/submit`,
      { version: submitted.body.plan.version },
      cookies.dee,
    );
    expect(twice.body.error.code).toBe('already_submitted');

    // After the event the plan stays open for changes; the snapshot does not move.
    await tick('2026-11-18T09:00:00.000Z');
    const edited = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
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

  it('records where each action stands through a follow-up wave, and counts it for the organisers', async () => {
    await tick('2026-12-15T09:00:00.000Z');
    // The 30-day wave opens. The plan page itself records no progress (2026-11-08).
    await prisma.assessmentStageConfig.upsert({
      where: { eventId_stage_wave: { eventId, stage: 'follow_up', wave: 1 } },
      update: { dueAfterDays: 30, enabled: true, status: 'open', opensAt: null, closesAt: null },
      create: {
        eventId,
        stage: 'follow_up',
        wave: 1,
        dueAfterDays: 30,
        enabled: true,
        status: 'open',
        opensAt: null,
        closesAt: null,
      },
    });
    const planUrl = `/me/events/${eventId}/transfer-plans/${planId}`;
    const mine = await call('get', planUrl, undefined, cookies.dee);
    const [first, second] = mine.body.plan.actions as Array<{ id: string }>;
    const path = `/me/events/${eventId}/assessments/follow_up/plan-progress?wave=1`;
    expect(
      (
        await call(
          'post',
          `${planUrl}/actions/${first!.id}/progress`,
          { status: 'applied', note: 'x' },
          cookies.dee,
        )
      ).status,
    ).toBe(404);

    // Every action needs a status; "applied" needs an example and a date; "changed" a reason.
    const partial = await call(
      'put',
      path,
      {
        actions: [
          { actionId: first!.id, status: 'applied', note: 'Used it', occurredOn: '2026-12-10' },
        ],
      },
      cookies.dee,
    );
    expect(partial.status).toBe(422);
    const noExample = await call(
      'put',
      path,
      {
        actions: [
          { actionId: first!.id, status: 'applied' },
          { actionId: second!.id, status: 'started' },
        ],
      },
      cookies.dee,
    );
    expect(noExample.status).toBe(422);
    const noReason = await call(
      'put',
      path,
      {
        actions: [
          { actionId: first!.id, status: 'started' },
          { actionId: second!.id, status: 'changed' },
        ],
      },
      cookies.dee,
    );
    expect(noReason.status).toBe(422);
    // The wave cannot be submitted before the statuses are in.
    const early = await call(
      'put',
      `/me/events/${eventId}/assessments/follow_up?wave=1`,
      { answers: {}, submit: true },
      cookies.dee,
    );
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('plan_progress_missing');

    const recorded = await call(
      'put',
      path,
      {
        actions: [
          {
            actionId: first!.id,
            status: 'applied',
            note: 'Used the measures in the Q1 plan',
            occurredOn: '2026-12-10',
          },
          { actionId: second!.id, status: 'started' },
        ],
      },
      cookies.dee,
    );
    expect(recorded.status, recorded.text).toBe(200);
    const fu = recorded.body.assessments.find(
      (a: { stage: string; wave: number }) => a.stage === 'follow_up' && a.wave === 1,
    );
    expect(fu.context.plan.actions[0].followUps).toEqual([
      expect.objectContaining({
        wave: 1,
        waveLabel: '30-day follow-up',
        status: 'applied',
        note: 'Used the measures in the Q1 plan',
        occurredOn: '2026-12-10',
      }),
    ]);
    // The plan shows it as progress, and the action's current status follows.
    const plan = await call('get', planUrl, undefined, cookies.dee);
    const action = plan.body.plan.actions[0];
    expect(action.progressStatus).toBe('applied');
    expect(action.progress).toHaveLength(1);
    expect(action.progress[0]).toMatchObject({
      status: 'applied',
      wave: 1,
      waveLabel: '30-day follow-up',
      occurredOn: '2026-12-10',
      note: 'Used the measures in the Q1 plan',
    });
    // A correction before the wave is submitted replaces the record of that wave; it adds none.
    const corrected = await call(
      'put',
      path,
      {
        actions: [
          {
            actionId: first!.id,
            status: 'applied_consistently',
            note: 'Used it in every programme since',
            occurredOn: '2026-12-12',
          },
          { actionId: second!.id, status: 'started' },
        ],
      },
      cookies.dee,
    );
    expect(corrected.status, corrected.text).toBe(200);
    const again = await call('get', planUrl, undefined, cookies.dee);
    expect(again.body.plan.actions[0].progress).toHaveLength(1);
    expect(again.body.plan.actions[0].progress[0].status).toBe('applied_consistently');
    // Another delegate's actions, and admins, are refused.
    const other = await call(
      'put',
      path,
      {
        actions: [
          { actionId: first!.id, status: 'completed', note: 'done', occurredOn: '2026-12-10' },
        ],
      },
      cookies.ada,
    );
    expect(other.status).toBe(422);
    expect(
      (await call('put', path, { actions: [{ actionId: first!.id, status: 'started' }] })).status,
    ).toBe(403);

    const list = await call('get', `/events/${eventId}/transfer-plans`);
    expect(list.status, list.text).toBe(200);
    const dee = list.body.plans.find((p: { delegate: { id: string } }) => p.delegate.id === deeId);
    expect(dee).toMatchObject({
      status: 'submitted',
      actions: 2,
      priorityAction: 'Brief stakeholders (revised)',
      reminderFrequency: 'weekly',
    });
    // Each action counted once, in its latest status.
    expect(dee.progress).toMatchObject({ applied_consistently: 1, started: 1 });
    expect(list.body.sessions).toHaveLength(2);
  });

  it('keeps business measures, their results and evidence on the action of the existing plan, with history and server-side rules', async () => {
    const mine = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    const version = mine.body.plan.version as number;
    const [first, second] = mine.body.plan.actions as Array<{ id: string }>;
    const path = (actionId: string, tail: string) =>
      `/me/events/${eventId}/transfer-plans/${planId}/actions/${actionId}/${tail}`;
    type MeasureRow = Record<string, unknown> & { id: string };
    const actionOf = (body: { plan: { actions: Array<{ id: string }> } }, id: string) =>
      body.plan.actions.find((a) => a.id === id) as unknown as {
        measureStatus: string | null;
        measures: MeasureRow[];
        evidenceRecords: Array<Record<string, unknown> & { support: string }>;
      };
    const measureInput = (m: MeasureRow) => ({
      id: m.id,
      kind: m.kind,
      name: m.name,
      importance: m.importance,
      method: m.method,
      unit: m.unit,
      direction: m.direction,
      baselineState: m.baselineState,
      baselineValue: m.baselineValue,
      baselineOn: m.baselineOn,
      targetState: m.targetState,
      targetValue: m.targetValue,
      targetOn: m.targetOn,
    });
    // Before any choice, the action says nothing about measures.
    expect(actionOf(mine.body, first!.id).measureStatus).toBeNull();

    // "I can identify a measure" needs at least one measure, and a measure needs its name, why
    // it matters, how it is measured and, when quantitative, a unit.
    const empty = await call(
      'put',
      path(first!.id, 'measures'),
      { version, measureStatus: 'identified', measures: [] },
      cookies.dee,
    );
    expect(empty.status).toBe(422);
    const incomplete = await call(
      'put',
      path(first!.id, 'measures'),
      { version, measureStatus: 'identified', measures: [{ name: 'Turnaround time' }] },
      cookies.dee,
    );
    expect(incomplete.status).toBe(422);

    // Two measures: a quantitative one with a known baseline and a target, and a qualitative
    // one whose baseline is not yet known.
    const defined = {
      name: 'Turnaround time',
      importance: 'Clients wait for it',
      method: 'Days from request to delivery, from the team tracker',
      kind: 'quantitative',
      unit: 'days',
      direction: 'lower',
      baselineState: 'known',
      baselineValue: '12',
      baselineOn: '2026-11-01',
      targetState: 'set',
      targetValue: '8',
      targetOn: '2027-03-31',
    };
    const saved = await call(
      'put',
      path(first!.id, 'measures'),
      {
        version,
        measureStatus: 'identified',
        measures: [
          defined,
          {
            name: 'Handover quality',
            importance: 'Fewer rounds of corrections',
            method: 'Reviewer feedback on each brief',
            kind: 'qualitative',
          },
        ],
      },
      cookies.dee,
    );
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.plan.id).toBe(planId);
    expect(saved.body.plan.version).toBe(version + 1);
    const a1 = actionOf(saved.body, first!.id);
    expect(a1.measureStatus).toBe('identified');
    expect(a1.measures).toHaveLength(2);
    expect(a1.measures[0]).toMatchObject({
      order: 1,
      name: 'Turnaround time',
      method: 'Days from request to delivery, from the team tracker',
      unit: 'days',
      direction: 'lower',
      baselineState: 'known',
      baselineValue: '12',
      baselineOn: '2026-11-01',
      targetState: 'set',
      targetValue: '8',
      targetOn: '2027-03-31',
      actualValue: '',
      actualOn: null,
      support: 'self_reported',
      results: [],
    });
    expect(a1.measures[1]).toMatchObject({
      kind: 'qualitative',
      baselineState: 'not_yet_known',
      baselineValue: '',
      targetState: 'not_yet_known',
      direction: 'unspecified',
    });

    // The other action: the measure is not yet known, and no measure record is needed.
    const unknown = await call(
      'put',
      path(second!.id, 'measures'),
      { version: version + 1, measureStatus: 'not_yet_known', measures: [] },
      cookies.dee,
    );
    expect(unknown.status, unknown.text).toBe(200);
    expect(actionOf(unknown.body, second!.id)).toMatchObject({
      measureStatus: 'not_yet_known',
      measures: [],
    });

    // A quantitative value must be a number; the unit lives in its own field.
    const text = await call(
      'put',
      path(first!.id, 'measures'),
      {
        version: version + 2,
        measureStatus: 'identified',
        measures: [{ ...defined, baselineValue: '12 days' }],
      },
      cookies.dee,
    );
    expect(text.status).toBe(422);
    expect(text.body.error.code).toBe('validation_failed');

    // No actual results are recorded on a measure (decision 2026-11-09): the route is gone.
    const measureId = a1.measures[0]!.id;
    expect(
      (
        await call(
          'put',
          path(first!.id, `measures/${measureId}/results`),
          { version: version + 2, results: [] },
          cookies.dee,
        )
      ).status,
    ).toBe(404);

    // A foreign measure id, other delegates and admins are refused.
    const foreignId = await call(
      'put',
      path(first!.id, 'measures'),
      {
        version: version + 2,
        measureStatus: 'identified',
        measures: [{ ...defined, id: randomUUID() }],
      },
      cookies.dee,
    );
    expect(foreignId.status).toBe(422);
    expect(
      (
        await call(
          'put',
          path(first!.id, 'measures'),
          { version: 1, measureStatus: 'not_applicable', measures: [] },
          cookies.ada,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call('put', path(first!.id, 'measures'), {
          version: 1,
          measureStatus: 'not_applicable',
          measures: [],
        })
      ).status,
    ).toBe(403);

    // The measure's definition can be changed later; its id stays.
    const renamed = await call(
      'put',
      path(first!.id, 'measures'),
      {
        version: version + 2,
        measureStatus: 'identified',
        measures: [
          { ...measureInput(a1.measures[0]!), name: 'Delivery time', unit: 'working days' },
          measureInput(a1.measures[1]!),
        ],
      },
      cookies.dee,
    );
    expect(renamed.status, renamed.text).toBe(200);
    const m3 = actionOf(renamed.body, first!.id).measures[0]!;
    expect(m3).toMatchObject({ id: measureId, name: 'Delivery time', unit: 'working days' });

    // Evidence: a description is the only requirement; each record says how it is supported
    // and may name the measure it supports.
    const noText = await call(
      'put',
      path(first!.id, 'evidence'),
      { version: version + 3, evidence: [{ type: 'example', description: ' ' }] },
      cookies.dee,
    );
    expect(noText.status).toBe(422);
    const wrongMeasure = await call(
      'put',
      path(first!.id, 'evidence'),
      {
        version: version + 3,
        evidence: [{ type: 'example', description: 'Report', measureId: randomUUID() }],
      },
      cookies.dee,
    );
    expect(wrongMeasure.status).toBe(422);
    const evidence = await call(
      'put',
      path(first!.id, 'evidence'),
      {
        version: version + 3,
        evidence: [
          {
            type: 'work_product',
            description: 'Set up the measures before the January workshop',
            evidenceOn: '2027-01-10',
          },
          {
            type: 'confirmation',
            measureId,
            description: 'My manager confirmed the new turnaround in the February review',
            support: 'supported',
            supportedBy: 'Line manager',
            reference: 'February review notes',
          },
        ],
      },
      cookies.dee,
    );
    expect(evidence.status, evidence.text).toBe(200);
    expect(evidence.body.plan.id).toBe(planId);
    expect(evidence.body.plan.version).toBe(version + 4);
    const records = actionOf(evidence.body, first!.id).evidenceRecords;
    expect(records.map((e) => e.support)).toEqual(['self_reported', 'supported']);
    expect(records[0]).toMatchObject({ measureId: null, type: 'work_product' });
    expect(records[1]).toMatchObject({
      order: 2,
      type: 'confirmation',
      measureId,
      supportedBy: 'Line manager',
      reference: 'February review notes',
    });
    expect(
      (await call('put', path(first!.id, 'evidence'), { version: 1, evidence: [] }, cookies.ada))
        .status,
    ).toBe(404);

    // One plan throughout; the snapshot taken at submission is untouched; the history shows the saves.
    expect(await prisma.transferPlan.count({ where: { eventId, delegateId: deeId } })).toBe(1);
    const detail = await call('get', `/events/${eventId}/transfer-plans/${deeId}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.plan.snapshot.actions[0].measures).toEqual([]);
    expect(actionOf(detail.body.plan, first!.id).measures[0]!.results).toHaveLength(0);
    expect(detail.body.plan.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['transfer_plan.measures_saved', 'transfer_plan.evidence_saved']),
    );

    // The organisers: counts on the list; the report carries each action's choice and its
    // measures (no results are recorded), evidence counted but not quoted unless asked (and asking is
    // audited); delegates get nothing.
    const list = await call('get', `/events/${eventId}/transfer-plans`);
    const dee = list.body.plans.find((p: { delegate: { id: string } }) => p.delegate.id === deeId);
    expect(dee.measures).toMatchObject({ baseline_only: 1, not_yet_known: 1 });
    expect(dee.evidence).toEqual({ self_reported: 1, supported: 1 });
    const report = await call('get', `/events/${eventId}/transfer-plans/measures`);
    expect(report.status, report.text).toBe(200);
    const row = report.body.rows.find((r: { action: { id: string } }) => r.action.id === first!.id);
    expect(row).toMatchObject({
      planStatus: 'submitted',
      summary: 'baseline_only',
      action: { measureStatus: 'identified' },
      evidence: { self_reported: 1, supported: 1 },
      evidenceRecords: null,
    });
    expect(row.measures[0]).toMatchObject({ name: 'Delivery time', actualValue: '' });
    expect(row.measures[0].results).toHaveLength(0);
    expect(
      report.body.rows.find((r: { action: { id: string } }) => r.action.id === second!.id),
    ).toMatchObject({ summary: 'not_yet_known', action: { measureStatus: 'not_yet_known' } });
    expect(JSON.stringify(report.body)).not.toContain('February review notes');
    const full = await call('get', `/events/${eventId}/transfer-plans/measures?evidence=true`);
    expect(full.status, full.text).toBe(200);
    expect(
      full.body.rows.find((r: { action: { id: string } }) => r.action.id === first!.id)
        .evidenceRecords,
    ).toHaveLength(2);
    expect(
      await prisma.auditLog.count({
        where: { eventId, action: 'transfer_plan.evidence_exported' },
      }),
    ).toBe(1);
    expect(
      (await call('get', `/events/${eventId}/transfer-plans/measures`, undefined, cookies.dee))
        .status,
    ).toBe(403);
  });

  it('hides Transfer Planning from delegates outright or until a date, keeps the plans, and reopens it (2026-11-08)', async () => {
    const eventUrl = `/events/${eventId}`;
    const mine = `/me/events/${eventId}`;
    // Scheduled needs a date.
    const noDate = await call('patch', eventUrl, { transferPlanVisibility: 'scheduled' });
    expect(noDate.status).toBe(422);
    // Hidden: the delegate's event says so, the plan routes refuse, the journey has no plan step.
    const hidden = await call('patch', eventUrl, { transferPlanVisibility: 'hidden' });
    expect(hidden.status, hidden.text).toBe(200);
    expect(hidden.body.event).toMatchObject({
      transferPlanVisibility: 'hidden',
      transferPlanShownFrom: null,
    });
    const myEvent = await call('get', mine, undefined, cookies.dee);
    expect(myEvent.status, myEvent.text).toBe(200);
    expect(myEvent.body.event.transferPlan).toEqual({ visible: false, shownFrom: null });
    const refused = await call('get', `${mine}/transfer-plans`, undefined, cookies.dee);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('transfer_plan_hidden');
    expect(
      (await call('get', `${mine}/transfer-plans/${planId}`, undefined, cookies.dee)).status,
    ).toBe(409);
    const journey = await call('get', `${mine}/journey`, undefined, cookies.dee);
    expect(journey.body.journey).toMatchObject({ transferPlanHidden: true, plan: null });
    // The follow-up shows no plan and asks for no statuses while it is hidden.
    const assessments = await call('get', `${mine}/assessments`, undefined, cookies.dee);
    const fu = assessments.body.assessments.find((a: { stage: string }) => a.stage === 'follow_up');
    if (fu) expect(fu.context.plan).toBeNull();
    // The organisers still see every plan.
    expect((await call('get', `${eventUrl}/transfer-plans`)).body.plans.length).toBeGreaterThan(0);
    // Scheduled for the day after tomorrow: still hidden; once the time comes, shown, with the
    // same plan.
    const soon = new Date(now.getTime() + 2 * 86_400_000);
    const later = await call('patch', eventUrl, {
      transferPlanVisibility: 'scheduled',
      transferPlanShownFrom: soon.toISOString(),
    });
    expect(later.status, later.text).toBe(200);
    expect(later.body.event.transferPlanShownFrom).toBe(soon.toISOString());
    expect((await call('get', mine, undefined, cookies.dee)).body.event.transferPlan).toEqual({
      visible: false,
      shownFrom: soon.toISOString(),
    });
    expect((await call('get', `${mine}/transfer-plans`, undefined, cookies.dee)).status).toBe(409);
    await tick(new Date(soon.getTime() + 3_600_000).toISOString());
    const shown = await call('get', mine, undefined, cookies.dee);
    expect(shown.status, shown.text).toBe(200);
    expect(shown.body.event.transferPlan.visible).toBe(true);
    const back = await call('get', `${mine}/transfer-plans/${planId}`, undefined, cookies.dee);
    expect(back.status, back.text).toBe(200);
    expect(back.body.plan.id).toBe(planId);
    // Shown again outright, for the tests that follow.
    expect((await call('patch', eventUrl, { transferPlanVisibility: 'shown' })).status).toBe(200);
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'event.updated' } }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('sends the reminders delegates asked for, once per interval, and logs each attempt', async () => {
    mailer.sent.length = 0;
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
    const plan = await prisma.transferPlan.findUniqueOrThrow({ where: { id: planId } });
    // Weekly, chosen on the 18th at 10:00 Lagos with the default 09:00: next Wednesday at 09:00.
    expect(plan.nextReminderAt).toEqual(new Date('2026-11-25T08:00:00.000Z'));
    now = new Date('2026-11-24T12:00:00.000Z');
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 0, sent: 0 });
    await tick('2026-11-25T09:05:00.000Z');
    // Hidden Transfer Planning sends no reminder (2026-11-08); shown again, the due one goes.
    await prisma.event.update({
      where: { id: eventId },
      data: { transferPlanVisibility: 'hidden' },
    });
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 0, sent: 0 });
    await prisma.event.update({
      where: { id: eventId },
      data: { transferPlanVisibility: 'shown' },
    });
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toMatch(/plan going/);
    expect(mailer.sent[0]!.subject).not.toMatch(/Last days/);
    expect(mailer.sent[0]!.text).toContain('Brief stakeholders (revised)');
    expect(mailer.sent[0]!.text).toContain(`${ORIGIN}/account/events/${eventId}#transfer-plan`);
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 0 });
    const after = await prisma.transferPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.nextReminderAt).toEqual(new Date('2026-12-02T08:00:00.000Z'));
    expect(mailer.sent[0]!.text).toContain('Plan 1');
    const mine = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    expect(mine.body.reminders).toHaveLength(1);
    expect(mine.body.reminders[0]).toMatchObject({ status: 'sent' });

    // A reminder that fires while a post-conference follow-up is open asks for that follow-up
    // (decision 2026-11-09). The 30-day wave of this event is open with no window; it needs a
    // question to count.
    const wave1 = await prisma.assessmentStageConfig.findUniqueOrThrow({
      where: { eventId_stage_wave: { eventId, stage: 'follow_up', wave: 1 } },
    });
    await prisma.assessmentQuestion.create({
      data: {
        eventId,
        stageConfigId: wave1.id,
        order: 1,
        prompt: 'What have you applied so far?',
        type: 'long_text',
        required: false,
      },
    });
    mailer.sent.length = 0;
    await tick('2026-12-02T09:05:00.000Z');
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 1, sent: 1, skipped: 0 });
    expect(mailer.sent[0]!.subject).toContain('30-day follow-up');
    expect(mailer.sent[0]!.text).toContain(
      `${ORIGIN}/account/events/${eventId}#assessment-follow_up-1`,
    );
    // Once the follow-up is answered, the next occurrence sends nothing and the pointer moves on.
    await prisma.assessmentResponse.upsert({
      where: { stageConfigId_delegateId: { stageConfigId: wave1.id, delegateId: deeId } },
      create: { stageConfigId: wave1.id, delegateId: deeId, submittedAt: now },
      update: { submittedAt: now },
    });
    mailer.sent.length = 0;
    await tick('2026-12-09T09:05:00.000Z');
    expect(await sendDueTransferPlanReminders(deps)).toMatchObject({ due: 1, sent: 0, skipped: 1 });
    expect(mailer.sent).toHaveLength(0);
    const moved = await prisma.transferPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(moved.nextReminderAt).toEqual(new Date('2026-12-16T08:00:00.000Z'));
    // The follow-up is left unanswered for the tests that follow.
    await prisma.assessmentResponse.deleteMany({
      where: { stageConfigId: wave1.id, delegateId: deeId },
    });
  });

  it('keeps several plans per delegate, each with its own reminder window, and refuses bad preferences', async () => {
    await tick('2026-12-03T10:00:00.000Z');
    const created = await call(
      'post',
      `/me/events/${eventId}/transfer-plans`,
      { title: 'Coaching rollout' },
      cookies.dee,
    );
    expect(created.status, created.text).toBe(201);
    expect(created.body.plan).toMatchObject({
      sequence: 2,
      title: 'Coaching rollout',
      status: 'draft',
    });
    const second = created.body.plan.id as string;
    const list = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    expect(list.body.plans.map((p: { sequence: number }) => p.sequence)).toEqual([1, 2]);
    expect(list.body.plans[0].status).toBe('submitted');

    // Twice a week needs two different days; the window cannot end before it starts.
    const oneDay = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${second}`,
      { version: 1, actions: [], reminder: { frequency: 'twice_weekly', days: [2] } },
      cookies.dee,
    );
    expect(oneDay.status).toBe(422);
    const backwards = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${second}`,
      {
        version: 1,
        actions: [],
        reminder: { frequency: 'daily', startOn: '2026-12-10', endOn: '2026-12-09' },
      },
      cookies.dee,
    );
    expect(backwards.status).toBe(422);
    // Tuesdays and Fridays at 18:00 Lagos from 10 December: the first one is Friday the 11th.
    const saved = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${second}`,
      {
        version: 1,
        actions: [
          {
            title: 'Coaching rollout',
            priorityLearning: 'Coaching conversations',
            action: 'Coach two team leads',
            isPriority: true,
          },
        ],
        reminder: {
          frequency: 'twice_weekly',
          days: [5, 2],
          time: '18:00',
          startOn: '2026-12-10',
          endOn: '2027-01-31',
        },
      },
      cookies.dee,
    );
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.plan.reminder).toEqual({
      frequency: 'twice_weekly',
      days: [2, 5],
      time: '18:00',
      startOn: '2026-12-10',
      endOn: '2027-01-31',
      nextReminderAt: '2026-12-11T17:00:00.000Z',
    });
    // The first plan is untouched by the second; its weekly reminder stands.
    const first = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    expect(first.body.plan.reminder.frequency).toBe('weekly');

    // The organisers see one row per plan, and can open either.
    const admin = await call('get', `/events/${eventId}/transfer-plans`);
    const rows = admin.body.plans.filter(
      (p: { delegate: { id: string } }) => p.delegate.id === deeId,
    );
    expect(rows.map((r: { sequence: number; title: string }) => [r.sequence, r.title])).toEqual(
      expect.arrayContaining([
        [1, ''],
        [2, 'Coaching rollout'],
      ]),
    );
    const latest = await call('get', `/events/${eventId}/transfer-plans/${deeId}`);
    expect(latest.body.plan.plan.sequence).toBe(2);
    const chosen = await call('get', `/events/${eventId}/transfer-plans/${deeId}?plan=${planId}`);
    expect(chosen.body.plan.plan.sequence).toBe(1);
  });

  it('completes a plan only when every action has a result and evidence, then tells the organisers', async () => {
    await tick('2026-12-20T10:00:00.000Z');
    const mine = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    const [first, second] = mine.body.plan.actions as Array<{ id: string; action: string }>;
    // The first action carries evidence from earlier; the second has none and is not applied.
    const blocked = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/complete`,
      { version: mine.body.plan.version, improvement: 'seen' },
      cookies.dee,
    );
    expect(blocked.status, blocked.text).toBe(422);
    expect(blocked.body.error.code).toBe('plan_incomplete');
    expect(blocked.body.gaps).toEqual([
      { actionId: second!.id, action: second!.action, missing: ['applied', 'evidence'] },
    ]);
    // The follow-up records the action as applied, and one evidence record closes the gaps.
    const progressed = await call(
      'put',
      `/me/events/${eventId}/assessments/follow_up/plan-progress?wave=1`,
      {
        planId,
        actions: [
          {
            actionId: first!.id,
            status: 'applied_consistently',
            note: 'Used it in every programme since',
            occurredOn: '2026-12-12',
          },
          {
            actionId: second!.id,
            status: 'applied',
            note: 'Agreed with the programme owners in December',
            occurredOn: '2026-12-20',
          },
        ],
      },
      cookies.dee,
    );
    expect(progressed.status, progressed.text).toBe(200);
    const afterProgress = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    const evidenced = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}/actions/${second!.id}/evidence`,
      {
        version: afterProgress.body.plan.version,
        evidence: [{ type: 'work_product', description: 'The signed-off measures sheet' }],
      },
      cookies.dee,
    );
    expect(evidenced.status, evidenced.text).toBe(200);
    mailer.sent.length = 0;
    const stale = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/complete`,
      { version: 1, improvement: 'seen' },
      cookies.dee,
    );
    expect(stale.body.error.code).toBe('stale_plan');
    const completed = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/complete`,
      {
        version: evidenced.body.plan.version,
        improvement: 'seen',
        note: 'Turnaround is down from 12 to 9 days',
      },
      cookies.dee,
    );
    expect(completed.status, completed.text).toBe(200);
    expect(completed.body.plan).toMatchObject({
      status: 'completed',
      completedAt: '2026-12-20T10:00:00.000Z',
      outcome: 'impact_demonstrated',
      outcomeNote: 'Turnaround is down from 12 to 9 days',
      reminder: { frequency: 'none', nextReminderAt: null },
    });
    // The first impact check falls due 90 days on; nothing is promoted by completion itself.
    expect(completed.body.plan.impactChecks).toEqual([
      expect.objectContaining({ round: 1, dueOn: '2027-03-20', answeredAt: null, answer: null }),
    ]);
    // The organisers are told, without any of the plan's text.
    const notice = mailer.sent.find((m) => m.to === `admin-tp-${tag}@example.com`);
    expect(notice).toBeDefined();
    expect(notice!.subject).toMatch(/Dee Legate completed a transfer plan/);
    expect(notice!.text).toContain('Plan 1');
    expect(notice!.text).toContain('Impact demonstrated');
    expect(notice!.text).not.toContain('Brief stakeholders');
    expect(notice!.text).toContain(`/admin/events/${eventId}#transfer-plans`);
    // Finished means finished: no more saves, progress or completion; a new plan is the way on.
    const locked = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      { version: completed.body.plan.version, actions: [], reminder: { frequency: 'none' } },
      cookies.dee,
    );
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('plan_completed');
    const again = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/complete`,
      { version: completed.body.plan.version, improvement: 'seen' },
      cookies.dee,
    );
    expect(again.body.error.code).toBe('plan_completed');
    // A draft cannot be completed; it has to be submitted first.
    const draft = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    const second2 = draft.body.plans.find((p: { sequence: number }) => p.sequence === 2);
    const early = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${second2.id}/complete`,
      { version: 2, improvement: 'not_yet' },
      cookies.dee,
    );
    expect(early.body.error.code).toBe('not_submitted');
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'transfer_plan.completed' } }),
    ).toBe(1);
    const row = (await call('get', `/events/${eventId}/transfer-plans`)).body.plans.find(
      (p: { planId: string }) => p.planId === planId,
    );
    expect(row).toMatchObject({
      status: 'completed',
      completedAt: '2026-12-20T10:00:00.000Z',
      outcome: 'impact_demonstrated',
    });
  });

  it('warns in the last week of a reminder window, then stops at its end', async () => {
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
    const list = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    const second = list.body.plans.find((p: { sequence: number }) => p.sequence === 2);
    // Daily at 09:00 Lagos for three days at the end of December: every one is a last-days notice.
    await tick('2026-12-26T10:00:00.000Z');
    const current = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${second.id}`,
      undefined,
      cookies.dee,
    );
    const saved = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${second.id}`,
      {
        version: current.body.plan.version,
        actions: [
          {
            title: 'Coaching rollout',
            priorityLearning: 'Coaching conversations',
            action: 'Coach two team leads',
            isPriority: true,
          },
        ],
        reminder: { frequency: 'daily', startOn: '2026-12-27', endOn: '2026-12-29' },
      },
      cookies.dee,
    );
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.plan.reminder.nextReminderAt).toBe('2026-12-27T08:00:00.000Z');
    // The job is global, so only Dee's mail is counted: other runs may have left plans behind.
    const toDee = () => mailer.sent.filter((m) => m.to === `dee-tp-${tag}@example.com`);
    mailer.sent.length = 0;
    now = new Date('2026-12-27T08:05:00.000Z');
    expect((await sendDueTransferPlanReminders(deps)).failed).toBe(0);
    expect(toDee()).toHaveLength(1);
    expect(toDee()[0]!.subject).toMatch(/Last days of reminders/);
    expect(toDee()[0]!.text).toMatch(/extend/);
    expect(toDee()[0]!.text).toContain('Coaching rollout');
    let plan = await prisma.transferPlan.findUniqueOrThrow({ where: { id: second.id } });
    expect(plan.nextReminderAt).toEqual(new Date('2026-12-28T08:00:00.000Z'));
    expect(
      (
        await prisma.transferPlanReminderLog.findFirst({
          where: { planId: second.id },
          orderBy: { createdAt: 'desc' },
        })
      )?.kind,
    ).toBe('final_week');
    now = new Date('2026-12-29T08:05:00.000Z');
    mailer.sent.length = 0;
    expect((await sendDueTransferPlanReminders(deps)).failed).toBe(0);
    expect(toDee()).toHaveLength(1);
    // The 29th was the last day: nothing is scheduled after it and the completed first plan never fires.
    plan = await prisma.transferPlan.findUniqueOrThrow({ where: { id: second.id } });
    expect(plan.nextReminderAt).toBeNull();
    now = new Date('2026-12-31T08:05:00.000Z');
    mailer.sent.length = 0;
    await sendDueTransferPlanReminders(deps);
    expect(toDee()).toHaveLength(0);
  });

  it('runs the impact checks after completion: emails when due, moves the outcome only on evidence, and stops when sustained', async () => {
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
    const toDee = () => mailer.sent.filter((m) => m.to === `dee-tp-${tag}@example.com`);
    const mine = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      undefined,
      cookies.dee,
    );
    const check = mine.body.plan.impactChecks[0] as { id: string; dueOn: string };
    expect(check.dueOn).toBe('2027-03-20');

    // Not due yet: the job sends nothing for it. Due: one email, once, logged as an impact check.
    const before = now;
    mailer.sent.length = 0;
    now = new Date('2027-03-19T09:00:00.000Z');
    await sendDueTransferPlanReminders(deps);
    expect(toDee()).toHaveLength(0);
    now = new Date('2027-03-21T09:00:00.000Z');
    const run = await sendDueTransferPlanReminders(deps);
    expect(run.impactChecks).toMatchObject({ sent: 1, failed: 0 });
    expect(toDee()).toHaveLength(1);
    expect(toDee()[0]!.subject).toMatch(/Has the improvement from your .* plan continued/);
    expect(toDee()[0]!.text).toContain('Impact demonstrated');
    await sendDueTransferPlanReminders(deps);
    expect(toDee()).toHaveLength(1);
    expect(
      (
        await prisma.transferPlanReminderLog.findFirst({
          where: { planId, kind: 'impact_check' },
        })
      )?.status,
    ).toBe('sent');
    now = before;

    // From "impact demonstrated" only sustained/faded apply; a sustained claim needs evidence.
    const wrong = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/impact-checks/${check.id}`,
      { answer: 'improved', evidence: 'x' },
      cookies.dee,
    );
    expect(wrong.status).toBe(422);
    const bare = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/impact-checks/${check.id}`,
      { answer: 'sustained' },
      cookies.dee,
    );
    expect(bare.status).toBe(422);
    const sustained = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${planId}/impact-checks/${check.id}`,
      {
        answer: 'sustained',
        evidence: 'Turnaround held at 9 days through the second quarter (operations report)',
      },
      cookies.dee,
    );
    expect(sustained.status, sustained.text).toBe(200);
    expect(sustained.body.plan.outcome).toBe('sustained_impact');
    expect(sustained.body.plan.impactChecks).toHaveLength(1);
    expect(sustained.body.plan.impactChecks[0]).toMatchObject({ answer: 'sustained' });
    expect(
      (
        await call(
          'post',
          `/me/events/${eventId}/transfer-plans/${planId}/impact-checks/${check.id}`,
          { answer: 'faded' },
          cookies.dee,
        )
      ).body.error.code,
    ).toBe('already_answered');

    // The second plan: completed with no improvement yet, then checked round by round.
    const list = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    const p2 = list.body.plans.find((p: { sequence: number }) => p.sequence === 2);
    const v = (
      await call('get', `/me/events/${eventId}/transfer-plans/${p2.id}`, undefined, cookies.dee)
    ).body.plan;
    const submitted = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${p2.id}/submit`,
      { version: v.version },
      cookies.dee,
    );
    expect(submitted.status, submitted.text).toBe(200);
    const a = submitted.body.plan.actions[0] as { id: string };
    const applied = await call(
      'put',
      `/me/events/${eventId}/assessments/follow_up/plan-progress?wave=1`,
      {
        planId: p2.id,
        actions: [
          {
            actionId: a.id,
            status: 'applied',
            note: 'Coached both team leads through January',
            occurredOn: '2027-01-20',
          },
        ],
      },
      cookies.dee,
    );
    expect(applied.status, applied.text).toBe(200);
    const p2Now = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${p2.id}`,
      undefined,
      cookies.dee,
    );
    const withEvidence = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${p2.id}/actions/${a.id}/evidence`,
      {
        version: p2Now.body.plan.version,
        evidence: [{ type: 'example', description: 'Coaching notes from four sessions' }],
      },
      cookies.dee,
    );
    expect(withEvidence.status, withEvidence.text).toBe(200);
    const done = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${p2.id}/complete`,
      {
        version: withEvidence.body.plan.version,
        improvement: 'not_yet',
        note: 'Too early to tell',
      },
      cookies.dee,
    );
    expect(done.status, done.text).toBe(200);
    expect(done.body.plan.outcome).toBe('applied');
    const c1 = done.body.plan.impactChecks[0] as { id: string };
    // Still nothing: a further check is scheduled. Then an improvement, with evidence: promoted,
    // and one more check asks whether it lasts.
    const still = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${p2.id}/impact-checks/${c1.id}`,
      { answer: 'not_yet', note: 'The team leads are still settling in' },
      cookies.dee,
    );
    expect(still.status, still.text).toBe(200);
    expect(still.body.plan.outcome).toBe('applied');
    expect(still.body.plan.impactChecks).toHaveLength(2);
    const c2 = still.body.plan.impactChecks[1] as { id: string; round: number };
    expect(c2.round).toBe(2);
    const improved = await call(
      'post',
      `/me/events/${eventId}/transfer-plans/${p2.id}/impact-checks/${c2.id}`,
      {
        answer: 'improved',
        evidence: 'Both team leads now run their own one-to-ones; retention up',
      },
      cookies.dee,
    );
    expect(improved.status, improved.text).toBe(200);
    expect(improved.body.plan.outcome).toBe('impact_demonstrated');
    expect(improved.body.plan.impactChecks).toHaveLength(3);
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'transfer_plan.impact_check' } }),
    ).toBe(3);
    // The organisers' list carries the outcome of each plan.
    const rows = (await call('get', `/events/${eventId}/transfer-plans`)).body.plans.filter(
      (p: { delegate: { id: string } }) => p.delegate.id === deeId,
    );
    expect(rows.map((r: { sequence: number; outcome: string }) => [r.sequence, r.outcome])).toEqual(
      expect.arrayContaining([
        [1, 'sustained_impact'],
        [2, 'impact_demonstrated'],
      ]),
    );
  });
});
