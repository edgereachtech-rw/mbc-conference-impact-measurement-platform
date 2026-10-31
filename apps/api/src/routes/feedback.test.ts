import { randomUUID } from 'node:crypto';

import { DEFAULT_FEEDBACK_QUESTIONS } from '@mbc/shared';
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

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('session feedback', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let sessionId = '';
  let otherSessionId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const delegates: Record<string, string> = {};
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
    await signedIn('admin', 'admin', `admin-fb-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-fb-${tag}@example.com`);
    const vee = await signedIn('vee', 'delegate', `vee-fb-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Fb ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    const s1 = await call('post', `/events/${eventId}/sessions`, {
      title: 'Measuring transfer',
      date: '2026-11-12',
      startTime: '09:00',
      endTime: '10:00',
      sessionType: 'keynote',
      speaker: 'Dr A. Speaker',
    });
    expect(s1.status, s1.text).toBe(201);
    const s2 = await call('post', `/events/${eventId}/sessions`, {
      title: 'Another session',
      date: '2026-11-12',
      startTime: '11:00',
      endTime: '12:00',
      sessionType: 'workshop',
    });
    const ids = (s2.body.event.sessions as Array<{ id: string; title: string }>)
      .sort((a, b) => a.title.localeCompare(b.title))
      .reverse()
      .map((s) => s.id);
    sessionId = ids[0]!;
    otherSessionId = ids[1]!;
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const a = await createRegisteredIdentity(prisma, eventId, `dee-fb-${tag}@example.com`, {
      name: 'Dee Legate',
      attendanceFormat: 'physical',
      userAccountId: dee.id,
    });
    const b = await createRegisteredIdentity(prisma, eventId, `vee-fb-${tag}@example.com`, {
      name: 'Vee Virtual',
      attendanceFormat: 'virtual',
      userAccountId: vee.id,
    });
    identityIds.push(a.identity.id, b.identity.id);
    delegates.dee = a.delegate.id;
    delegates.vee = b.delegate.id;
    // Dee attended the keynote; Vee attended only the other session.
    await call('post', `/events/${eventId}/attendance/sessions/${sessionId}`, {
      add: [delegates.dee],
    });
    await call('post', `/events/${eventId}/attendance/sessions/${otherSessionId}`, {
      add: [delegates.vee],
    });
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('enables feedback per session with the default questionnaire, a code and a deadline', async () => {
    const base = `/events/${eventId}/feedback`;
    expect((await call('get', base, undefined, cookies.dee)).status).toBe(403);
    const before = await call('get', base);
    expect(before.status, before.text).toBe(200);
    expect(
      before.body.sessions.map((s: { enabled: boolean; code: string | null }) => [
        s.enabled,
        s.code,
      ]),
    ).toEqual([
      [false, null],
      [false, null],
    ]);
    const enabled = await call('patch', `${base}/sessions/${sessionId}`, {
      enabled: true,
      closesAt: '2026-11-06T23:59:00+01:00',
    });
    expect(enabled.status, enabled.text).toBe(200);
    expect(enabled.body.session).toMatchObject({
      title: 'Measuring transfer',
      speaker: 'Dr A. Speaker',
      enabled: true,
      window: 'open',
      closesAt: '2026-11-06T22:59:00.000Z',
      attended: 1,
      submitted: 0,
    });
    expect(enabled.body.session.code).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(enabled.body.session.path).toBe(`/feedback/${enabled.body.session.code}`);
    expect(
      enabled.body.session.questions.map(
        (q: { prompt: string; type: string; required: boolean }) => [q.prompt, q.type, q.required],
      ),
    ).toEqual(DEFAULT_FEEDBACK_QUESTIONS.map((q) => [q.prompt, q.type, q.required]));
    // The other session is untouched; the code survives a disable/enable cycle.
    const list = await call('get', base);
    expect(list.body.sessions.find((s: { id: string }) => s.id === otherSessionId)).toMatchObject({
      enabled: false,
      questions: [],
    });
    const disabled = await call('patch', `${base}/sessions/${sessionId}`, { enabled: false });
    expect(disabled.body.session).toMatchObject({ enabled: false, window: 'disabled', code: null });
    const again = await call('patch', `${base}/sessions/${sessionId}`, { enabled: true });
    expect(again.body.session.code).toBe(enabled.body.session.code);
    expect(again.body.session.questions).toHaveLength(5);
    const opened = await call('post', `${base}/sessions/${sessionId}/open`, {});
    expect(opened.body.session.openedAt).toBe(now.toISOString());
  });

  it('resolves the link to the right session, requires recorded attendance, validates ratings, updates in place and never records attendance', async () => {
    const code = (await call('get', `/events/${eventId}/feedback`)).body.sessions.find(
      (s: { id: string }) => s.id === sessionId,
    ).code as string;
    expect((await call('get', `/me/feedback/${code}`)).status).toBe(403); // admins do not answer
    expect((await call('get', `/me/feedback/nope-nope-nope`, undefined, cookies.dee)).status).toBe(
      404,
    );

    // Vee did not attend this session: the form shows but cannot be submitted.
    const vee = await call('get', `/me/feedback/${code}`, undefined, cookies.vee);
    expect(vee.status, vee.text).toBe(200);
    expect(vee.body.feedback).toMatchObject({
      session: { title: 'Measuring transfer', speaker: 'Dr A. Speaker', date: '2026-11-12' },
      window: 'open',
      attended: false,
      canSubmit: false,
      response: null,
    });
    const [q1, q2, q3, q4] = vee.body.feedback.questions as Array<{ id: string; type: string }>;
    const refused = await call(
      'put',
      `/me/feedback/${code}`,
      { answers: { [q1!.id]: 'excellent', [q2!.id]: 'good', [q3!.id]: 'fair' } },
      cookies.vee,
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('not_attended');

    // Dee attended: required ratings validated, written answers optional.
    const dee = await call('get', `/me/feedback/${code}`, undefined, cookies.dee);
    expect(dee.body.feedback).toMatchObject({
      attended: true,
      canSubmit: true,
      openedAt: expect.any(String),
    });
    const bad = await call(
      'put',
      `/me/feedback/${code}`,
      { answers: { [q1!.id]: 'superb', [q2!.id]: 'good' } },
      cookies.dee,
    );
    expect(bad.status).toBe(422);
    expect(bad.body.problems[q1!.id]).toMatch(/Choose one of the ratings/);
    expect(bad.body.problems[q3!.id]).toMatch(/Choose a rating/);
    expect(bad.body.problems).not.toHaveProperty(q4!.id);
    const attendanceBefore = await prisma.sessionAttendance.count({ where: { eventId } });
    const first = await call(
      'put',
      `/me/feedback/${code}`,
      {
        answers: {
          [q1!.id]: 'excellent',
          [q2!.id]: 'good',
          [q3!.id]: 'fair',
          [q4!.id]: '  Measure before you train.  ',
        },
      },
      cookies.dee,
    );
    expect(first.status, first.text).toBe(201);
    expect(first.body.feedback.response).toMatchObject({
      revision: 1,
      submittedAt: now.toISOString(),
      answers: { [q1!.id]: 'excellent', [q4!.id]: 'Measure before you train.' },
    });
    expect(first.body.feedback.canSubmit).toBe(true); // may update

    // Update: same logical response, revision 2, previous answers kept, count unchanged.
    now = new Date('2026-11-05T10:20:00.000Z');
    const second = await call(
      'put',
      `/me/feedback/${code}`,
      {
        answers: { [q1!.id]: 'good', [q2!.id]: 'good', [q3!.id]: 'good' },
      },
      cookies.dee,
    );
    expect(second.status, second.text).toBe(200);
    expect(second.body.feedback.response).toMatchObject({
      revision: 2,
      submittedAt: '2026-11-05T10:00:00.000Z',
      updatedAt: now.toISOString(),
    });
    expect(second.body.feedback.response.answers).not.toHaveProperty(q4!.id);
    expect(await prisma.sessionFeedbackResponse.count({ where: { sessionId } })).toBe(1);
    const revision = await prisma.sessionFeedbackRevision.findFirstOrThrow({
      where: { response: { sessionId } },
    });
    expect(revision).toMatchObject({
      revision: 1,
      answers: expect.objectContaining({ [q1!.id]: 'excellent' }),
    });
    expect(await prisma.sessionAttendance.count({ where: { eventId } })).toBe(attendanceBefore);
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { eventId, action: 'feedback.submitted' },
    });
    expect(JSON.stringify(auditRow.newValue)).not.toContain('Measure before');

    // The delegate's list for the event.
    const mine = await call('get', `/me/events/${eventId}/feedback`, undefined, cookies.dee);
    expect(mine.body.sessions).toEqual([
      expect.objectContaining({
        sessionId,
        code,
        attended: true,
        submittedAt: now.toISOString(),
        window: 'open',
      }),
    ]);

    // Past the deadline the form closes; answers stay.
    now = new Date('2026-11-07T00:00:00.000Z'); // past the deadline, inside the session idle window
    expect(
      (
        await call(
          'put',
          `/me/feedback/${code}`,
          { answers: { [q1!.id]: 'poor', [q2!.id]: 'poor', [q3!.id]: 'poor' } },
          cookies.dee,
        )
      ).body.error.code,
    ).toBe('feedback_closed');
    expect(
      (await call('get', `/me/feedback/${code}`, undefined, cookies.dee)).body.feedback,
    ).toMatchObject({ window: 'closed', canSubmit: false, response: { revision: 2 } });
    now = new Date('2026-11-05T11:00:00.000Z');
  });

  it('shows the dashboard with question-specific percentages, written answers, an anonymised view and a matching export', async () => {
    const base = `/events/${eventId}/feedback/sessions/${sessionId}`;
    // A second attendee answers only the ratings, differently.
    await call('post', `/events/${eventId}/attendance/sessions/${sessionId}`, {
      add: [delegates.vee],
    });
    const code = (await call('get', `/events/${eventId}/feedback`)).body.sessions.find(
      (s: { id: string }) => s.id === sessionId,
    ).code as string;
    const questions = (await call('get', `/me/feedback/${code}`, undefined, cookies.vee)).body
      .feedback.questions as Array<{ id: string }>;
    const [q1, q2, q3, q4, q5] = questions;
    const veeSubmit = await call(
      'put',
      `/me/feedback/${code}`,
      {
        answers: {
          [q1!.id]: 'good',
          [q2!.id]: 'excellent',
          [q3!.id]: 'poor',
          [q5!.id]: 'Shorter slides.',
        },
      },
      cookies.vee,
    );
    expect(veeSubmit.status, veeSubmit.text).toBe(201);

    const dash = await call('get', `${base}/dashboard`);
    expect(dash.status, dash.text).toBe(200);
    expect(dash.body.dashboard.session).toMatchObject({
      title: 'Measuring transfer',
      speaker: 'Dr A. Speaker',
      submitted: 2,
      attended: 2,
    });
    const q1Dist = dash.body.dashboard.distributions.find(
      (d: { questionId: string }) => d.questionId === q1!.id,
    );
    expect(q1Dist).toMatchObject({
      total: 2,
      ratings: [
        { rating: 'excellent', count: 0, percent: 0 },
        { rating: 'good', count: 2, percent: 100 },
        { rating: 'fair', count: 0, percent: 0 },
        { rating: 'poor', count: 0, percent: 0 },
      ],
    });
    const q3Dist = dash.body.dashboard.distributions.find(
      (d: { questionId: string }) => d.questionId === q3!.id,
    );
    expect(
      q3Dist.ratings.map((r: { rating: string; count: number; percent: number }) => [
        r.rating,
        r.count,
        r.percent,
      ]),
    ).toEqual([
      ['excellent', 0, 0],
      ['good', 1, 50],
      ['fair', 0, 0],
      ['poor', 1, 50],
    ]);
    const written = dash.body.dashboard.written as Array<{
      questionId: string;
      responses: Array<{ delegate: { name: string } | null; value: string }>;
    }>;
    expect(written.find((w) => w.questionId === q4!.id)!.responses).toEqual([]); // Dee removed hers in the update
    expect(written.find((w) => w.questionId === q5!.id)!.responses).toEqual([
      expect.objectContaining({
        delegate: expect.objectContaining({ name: 'Vee Virtual' }),
        value: 'Shorter slides.',
      }),
    ]);
    expect(dash.body.dashboard.anonymised).toBe(false);
    const speakerView = await call('get', `${base}/dashboard?anonymised=true`);
    expect(speakerView.body.dashboard.anonymised).toBe(true);
    expect(JSON.stringify(speakerView.body.dashboard)).not.toContain('Vee Virtual');
    expect((await call('get', `${base}/dashboard`, undefined, cookies.dee)).status).toBe(403);

    const csv = await call('get', `${base}/export.csv?anonymised=true`);
    expect(csv.status, csv.text).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const text = csv.text.replace(/^\uFEFF/, '');
    expect(text).toContain('Session,Measuring transfer');
    expect(text).toContain('Speaker or facilitator,Dr A. Speaker');
    expect(text).toContain('Feedback submissions (latest per delegate),2');
    expect(text).toContain('Good,2,100%');
    expect(text).toContain('Poor,1,50%');
    expect(text).toContain('Shorter slides.');
    expect(text).not.toContain('Vee Virtual');
    const named = await call('get', `${base}/export.csv`);
    expect(named.text).toContain('Vee Virtual,Shorter slides.');
    expect(await prisma.auditLog.count({ where: { eventId, action: 'feedback.exported' } })).toBe(
      2,
    );

    // Editing an answered rating question's wording versions it; the distribution follows the key.
    const versioned = await call('patch', `${base}/questions/${q1!.id}`, {
      prompt: 'How relevant was this session to your work?',
    });
    expect(versioned.body.question).toMatchObject({ version: 2 });
    const after = await call('get', `${base}/dashboard`);
    expect(
      after.body.dashboard.distributions.find(
        (d: { questionId: string }) => d.questionId === versioned.body.question.id,
      ),
    ).toMatchObject({ total: 2 });
  });
});
