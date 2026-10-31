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
import { MemoryMailer } from '../mail/mailer.js';
import { ITTEC_DAILY_REFLECTIONS, seedDailyReflections } from '../reflections/ittec-daily.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('daily learning reflections', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let day1 = '';
  let day2 = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-05T10:00:00.000Z');

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
    await signedIn('admin', 'admin', `admin-ref-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-ref-${tag}@example.com`);
    const ada = await signedIn('ada', 'delegate', `ada-ref-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Ref ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12', '2026-11-13'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    [day1, day2] = created.body.event.dates.map((d: { id: string }) => d.id);
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const a = await createRegisteredIdentity(prisma, eventId, `dee-ref-${tag}@example.com`, {
      name: 'Dee Legate',
      userAccountId: dee.id,
    });
    const b = await createRegisteredIdentity(prisma, eventId, `ada-ref-${tag}@example.com`, {
      name: 'Ada Other',
      userAccountId: ada.id,
    });
    identityIds.push(a.identity.id, b.identity.id);
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('seeds the ITTEC wording as drafts, one reflection per date, nothing automatic for other dates', async () => {
    const drafted = await prisma.$transaction((tx) => seedDailyReflections(tx, eventId));
    expect(drafted).toBe(2);
    expect(await prisma.$transaction((tx) => seedDailyReflections(tx, eventId))).toBe(0); // idempotent
    const list = await call('get', `/events/${eventId}/reflections`);
    expect(list.status, list.text).toBe(200);
    expect(
      (await call('get', `/events/${eventId}/reflections`, undefined, cookies.dee)).status,
    ).toBe(403);
    const [d1, d2] = list.body.dates as Array<{
      activity: {
        title: string;
        status: string;
        questions: Array<{ prompt: string; concern: boolean; required: boolean }>;
      };
    }>;
    expect(d1!.activity).toMatchObject({
      title: 'Day 1 reflection',
      status: 'draft',
      submitted: 0,
      registered: 2,
    });
    expect(d1!.activity.questions.map((q) => q.prompt)).toEqual(
      ITTEC_DAILY_REFLECTIONS[0]!.questions.map((q) => q.prompt),
    );
    expect(d1!.activity.questions[2]).toMatchObject({ concern: true, required: false });
    expect(d2!.activity.questions.map((q) => q.prompt)).toEqual(
      ITTEC_DAILY_REFLECTIONS[1]!.questions.map((q) => q.prompt),
    );
    expect(list.body.concerns).toEqual([]);
    // Drafts are invisible to delegates.
    const mine = await call('get', `/me/events/${eventId}/reflections`, undefined, cookies.dee);
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.reflections).toEqual([]);
  });

  it('configures questions before publication, refuses a foreign date, and versions a question that was answered', async () => {
    const list = await call('get', `/events/${eventId}/reflections`);
    const day1Activity = list.body.dates[0].activity.id as string;
    const base = `/events/${eventId}/reflections/${day1Activity}`;
    expect(
      (await call('post', `/events/${eventId}/reflections/dates/${randomUUID()}`, { title: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await call('post', `/events/${eventId}/reflections/dates/${day1}`, { title: 'x' })).status,
    ).toBe(409);
    expect(
      (
        await call('patch', base, {
          title: 'Day 1',
          opensAt: '2026-11-12T18:00:00+01:00',
          closesAt: '2026-11-12T17:00:00+01:00',
        })
      ).status,
    ).toBe(422);
    const window = await call('patch', base, {
      title: 'Day 1 reflection',
      opensAt: '2026-11-06T17:00:00+01:00',
      closesAt: '2026-11-07T23:59:00+01:00',
    });
    expect(window.status, window.text).toBe(200);
    expect(window.body.activity).toMatchObject({
      opensAt: '2026-11-06T16:00:00.000Z',
      status: 'draft',
    });

    // Add, edit, reorder, remove before publication.
    const added = await call('post', `${base}/questions`, {
      prompt: 'Anything else?',
      type: 'short_text',
      required: false,
    });
    expect(added.status, added.text).toBe(201);
    const ids = (
      await call('get', `/events/${eventId}/reflections`)
    ).body.dates[0].activity.questions.map((q: { id: string }) => q.id) as string[];
    expect(ids).toHaveLength(4);
    const reordered = await call('put', `${base}/questions/order`, {
      questionIds: [ids[3], ids[0], ids[1], ids[2]],
    });
    expect(reordered.status, reordered.text).toBe(200);
    expect(reordered.body.activity.questions[0].prompt).toBe('Anything else?');
    expect((await call('put', `${base}/questions/order`, { questionIds: [ids[0]] })).status).toBe(
      422,
    );
    const edited = await call('patch', `${base}/questions/${added.body.question.id}`, {
      prompt: 'Anything else to add?',
    });
    expect(edited.body.question).toMatchObject({ prompt: 'Anything else to add?', version: 1 });
    expect((await call('delete', `${base}/questions/${added.body.question.id}`)).status).toBe(204);
    expect(
      (await call('get', `/events/${eventId}/reflections`)).body.dates[0].activity.questions,
    ).toHaveLength(3);
    expect(await prisma.reflectionQuestion.count({ where: { id: added.body.question.id } })).toBe(
      0,
    );
  });

  it('publishes, lets an eligible delegate submit once inside the window, and shows concerns promptly', async () => {
    const list = await call('get', `/events/${eventId}/reflections`);
    const day1Activity = list.body.dates[0].activity.id as string;
    const day2Activity = list.body.dates[1].activity.id as string;
    const base = `/events/${eventId}/reflections/${day1Activity}`;
    expect((await call('post', `${base}/close`, {})).status).toBe(409);
    const published = await call('post', `${base}/publish`, {});
    expect(published.status, published.text).toBe(200);
    expect(published.body.activity).toMatchObject({ status: 'published' });
    expect((await call('post', `${base}/publish`, {})).status).toBe(409);
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'reflection.published' } }),
    ).toBe(1);

    // Before the window: upcoming, no questions; Day 2 stays hidden (still a draft).
    const early = await call('get', `/me/events/${eventId}/reflections`, undefined, cookies.dee);
    expect(early.body.reflections).toEqual([
      expect.objectContaining({
        id: day1Activity,
        status: 'upcoming',
        questions: [],
        canSubmit: false,
      }),
    ]);
    expect(
      (
        await call(
          'post',
          `/me/events/${eventId}/reflections/${day1Activity}`,
          { answers: {} },
          cookies.dee,
        )
      ).body.error.code,
    ).toBe('reflection_not_open');
    expect(
      (
        await call(
          'post',
          `/me/events/${eventId}/reflections/${day2Activity}`,
          { answers: {} },
          cookies.dee,
        )
      ).status,
    ).toBe(404);

    now = new Date('2026-11-06T18:00:00.000Z');
    const open = await call('get', `/me/events/${eventId}/reflections`, undefined, cookies.dee);
    const activity = open.body.reflections[0];
    expect(activity).toMatchObject({ status: 'open', canSubmit: true, submission: null });
    const [q1, q2, q3] = activity.questions as Array<{ id: string; concern: boolean }>;
    expect(q3!.concern).toBe(true);

    // Required answers and unknown questions are refused; nothing is stored.
    const missing = await call(
      'post',
      `/me/events/${eventId}/reflections/${day1Activity}`,
      { answers: { [q1!.id]: 'Learned a lot', [randomUUID()]: 'x' } },
      cookies.dee,
    );
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.problems)).toHaveLength(2);
    expect(await prisma.reflectionResponse.count({ where: { eventId } })).toBe(0);

    const attendanceBefore = await prisma.attendanceRecord.count({ where: { eventId } });
    const submitted = await call(
      'post',
      `/me/events/${eventId}/reflections/${day1Activity}`,
      {
        answers: {
          [q1!.id]: 'The gap analysis model.',
          [q2!.id]: ' The transfer plan template. ',
          [q3!.id]: 'The room was too cold in the afternoon.',
        },
      },
      cookies.dee,
    );
    expect(submitted.status, submitted.text).toBe(201);
    expect(submitted.body.reflections[0]).toMatchObject({
      canSubmit: false,
      submission: {
        submittedAt: now.toISOString(),
        answers: { [q2!.id]: 'The transfer plan template.' },
      },
    });
    expect(
      (
        await call(
          'post',
          `/me/events/${eventId}/reflections/${day1Activity}`,
          { answers: { [q1!.id]: 'again', [q2!.id]: 'again' } },
          cookies.dee,
        )
      ).body.error.code,
    ).toBe('already_submitted');
    // No attendance side effect, and the audit row holds counts only.
    expect(await prisma.attendanceRecord.count({ where: { eventId } })).toBe(attendanceBefore);
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { eventId, action: 'reflection.submitted' },
    });
    expect(JSON.stringify(auditRow.newValue)).not.toContain('too cold');

    // The concern is visible at once, with the right event date and delegate.
    const concerns = await call('get', `/events/${eventId}/reflections/concerns`);
    expect(concerns.status, concerns.text).toBe(200);
    expect(concerns.body.concerns).toEqual([
      expect.objectContaining({
        activityId: day1Activity,
        date: '2026-11-12',
        delegate: expect.objectContaining({ name: 'Dee Legate' }),
        value: 'The room was too cold in the afternoon.',
      }),
    ]);
    expect(
      (await call('get', `/events/${eventId}/reflections/concerns`, undefined, cookies.dee)).status,
    ).toBe(403);

    // Responses by delegate, with who has not submitted; another delegate sees nothing of Dee's.
    const responses = await call('get', `${base}/responses`);
    expect(responses.status, responses.text).toBe(200);
    expect(responses.body.rows).toEqual([
      expect.objectContaining({
        delegate: expect.objectContaining({ name: 'Dee Legate' }),
        answers: expect.objectContaining({ [q1!.id]: 'The gap analysis model.' }),
      }),
    ]);
    expect(responses.body.notSubmitted.map((d: { name: string }) => d.name)).toEqual(['Ada Other']);
    expect((await call('get', `${base}/responses`, undefined, cookies.ada)).status).toBe(403);
    const adas = await call('get', `/me/events/${eventId}/reflections`, undefined, cookies.ada);
    expect(adas.body.reflections[0]).toMatchObject({ submission: null, canSubmit: true });

    // Editing an answered question's wording creates version 2; Dee's answer keeps version 1
    // and still shows under the current question in the admin view.
    const versioned = await call('patch', `${base}/questions/${q1!.id}`, {
      prompt: 'What was the most valuable thing you learned today?',
    });
    expect(versioned.status, versioned.text).toBe(200);
    expect(versioned.body.question).toMatchObject({ version: 2, responseCount: 0 });
    expect(versioned.body.question.id).not.toBe(q1!.id);
    expect(await prisma.reflectionAnswer.count({ where: { questionId: q1!.id } })).toBe(1);
    const after = await call('get', `${base}/responses`);
    expect(after.body.rows[0].answers[versioned.body.question.id]).toBe('The gap analysis model.');
    // A question with answers is retired, not deleted; disabling the date is refused.
    expect((await call('delete', `${base}/questions/${q2!.id}`)).status).toBe(204);
    expect(await prisma.reflectionQuestion.count({ where: { id: q2!.id } })).toBe(1);
    expect((await call('delete', base)).status).toBe(409);

    // Past the deadline the reflection is closed to new submissions; existing answers stay.
    now = new Date('2026-11-08T08:00:00.000Z');
    expect(
      (
        await call(
          'post',
          `/me/events/${eventId}/reflections/${day1Activity}`,
          { answers: { [versioned.body.question.id]: 'late' } },
          cookies.ada,
        )
      ).body.error.code,
    ).toBe('reflection_not_open');
    const closedView = await call(
      'get',
      `/me/events/${eventId}/reflections`,
      undefined,
      cookies.ada,
    );
    expect(closedView.body.reflections[0]).toMatchObject({ status: 'closed', canSubmit: false });
    expect(await prisma.reflectionAnswer.count({ where: { response: { eventId } } })).toBe(3);
    expect((await call('post', `${base}/close`, {})).body.activity.status).toBe('closed');
  });

  it('keeps dates independent: disabling Day 2 removes its draft only, and a new activity can be enabled with its own questions', async () => {
    const list = await call('get', `/events/${eventId}/reflections`);
    const day2Activity = list.body.dates[1].activity.id as string;
    expect((await call('delete', `/events/${eventId}/reflections/${day2Activity}`)).status).toBe(
      204,
    );
    const again = await call('get', `/events/${eventId}/reflections`);
    expect(again.body.dates[1].activity).toBeNull();
    expect(again.body.dates[0].activity.questions.length).toBeGreaterThan(0);
    const enabled = await call('post', `/events/${eventId}/reflections/dates/${day2}`, {
      title: 'Day 2 reflection',
    });
    expect(enabled.status, enabled.text).toBe(201);
    expect(enabled.body.activity).toMatchObject({
      eventDateId: day2,
      status: 'draft',
      questions: [],
    });
    expect(
      (await call('post', `/events/${eventId}/reflections/${enabled.body.activity.id}/publish`, {}))
        .status,
    ).toBe(422);
  });
});
