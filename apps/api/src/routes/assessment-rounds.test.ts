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

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

/**
 * Additional rounds of an assessment (2026-11-21): the organisers add a second pre-training
 * assessment with its own questions; delegates see and answer each round on its own; an
 * answered round, and the first round, cannot be removed.
 */
describe.skipIf(!hasDatabase)('assessment rounds', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-21T10:00:00.000Z');

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
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
    method: 'post' | 'put' | 'get' | 'delete',
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
        lastSeenAt: now,
      },
    });
    cookies[key] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    await signedIn('admin', 'admin', `admin-rd-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-rd-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Rounds ${tag}`,
      description: 'd',
      eventType: 'training',
      organiser: 'M.Bryan',
      format: 'physical',
      timezone: 'Africa/Lagos',
      location: 'Lagos',
      dates: ['2026-11-23'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const a = await createRegisteredIdentity(prisma, eventId, `dee-rd-${tag}@example.com`, {
      name: 'Dee Manager',
      userAccountId: dee.id,
    });
    identityIds.push(a.identity.id);
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  const open = {
    enabled: true,
    status: 'open',
    target: 'all_delegates',
    targetGroup: '',
    opensAt: null,
    closesAt: null,
  };

  async function questionFor(wave: number, prompt: string) {
    const res = await call(
      'post',
      `/events/${eventId}/assessments/pre_conference/questions?wave=${wave}`,
      { prompt, type: 'short_text', required: true, sectionId: null },
    );
    expect(res.status, res.text).toBe(201);
    return (res.body.questions as Array<{ id: string; prompt: string }>).find(
      (q) => q.prompt === prompt,
    )!.id;
  }

  it('adds a round with the next number, as a disabled empty draft, admins only', async () => {
    const path = `/events/${eventId}/assessments/pre_conference/waves`;
    expect((await call('post', path, undefined, cookies.dee)).status).toBe(403);
    expect((await call('post', `/events/${eventId}/assessments/follow_up/waves`)).status).toBe(404);
    const res = await call('post', path);
    expect(res.status, res.text).toBe(201);
    expect(res.body.wave).toBe(2);
    const round = (res.body.event.assessmentStages as Array<{ stage: string; wave: number }>).find(
      (s) => s.stage === 'pre_conference' && s.wave === 2,
    );
    expect(round).toMatchObject({ enabled: false, status: 'draft', questionCount: 0 });
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'event.assessment_wave_added' } }),
    ).toBe(1);
  });

  it('keeps each round’s questions apart, and lets a delegate answer each round on its own', async () => {
    const first = await questionFor(1, 'Your goal for this training?');
    const second = await questionFor(2, 'Your goal for the second module?');
    // The rounds' question lists are separate.
    const list2 = await call(
      'get',
      `/events/${eventId}/assessments/pre_conference/questions?wave=2`,
    );
    expect((list2.body.questions as Array<{ prompt: string }>).map((q) => q.prompt)).toEqual([
      'Your goal for the second module?',
    ]);
    for (const wave of [1, 2]) {
      const res = await call(
        'put',
        `/events/${eventId}/assessments/pre_conference?wave=${wave}`,
        open,
      );
      expect(res.status, res.text).toBe(200);
    }
    const mine = await call('get', `/me/events/${eventId}/assessments`, undefined, cookies.dee);
    expect(mine.status, mine.text).toBe(200);
    const pre = (mine.body.assessments as Array<{ stage: string; wave: number }>).filter(
      (a) => a.stage === 'pre_conference',
    );
    expect(pre.map((a) => a.wave)).toEqual([1, 2]);
    const answered = await call(
      'put',
      `/me/events/${eventId}/assessments/pre_conference?wave=2`,
      { answers: { [second]: 'Coach my team' }, submit: true },
      cookies.dee,
    );
    expect(answered.status, answered.text).toBe(200);
    const after = (
      answered.body.assessments as Array<{
        stage: string;
        wave: number;
        response: { submittedAt: string | null } | null;
      }>
    ).filter((a) => a.stage === 'pre_conference');
    // Round 2 is submitted; round 1 is untouched.
    expect(after.find((a) => a.wave === 2)?.response?.submittedAt).toBeTruthy();
    expect(after.find((a) => a.wave === 1)?.response).toBeNull();
    // The dashboard lists the unanswered first round, named, and not the answered second.
    const journey = await call('get', `/me/events/${eventId}/journey`, undefined, cookies.dee);
    expect(
      (journey.body.journey.assessments as Array<{ wave: number; state: string }>).map((a) => [
        a.wave,
        a.state,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [1, 'open'],
        [2, 'submitted'],
      ]),
    );
    void first;
  });

  it('removes an added round only while nobody has answered it, and never the first', async () => {
    const base = `/events/${eventId}/assessments/pre_conference/waves`;
    expect((await call('delete', `${base}/1`)).status).toBe(409);
    expect((await call('delete', `${base}/2`)).body.error.code).toBe('wave_has_responses');
    const third = await call('post', base);
    expect(third.body.wave).toBe(3);
    await questionFor(3, 'Anything else?');
    expect((await call('delete', `${base}/3`, undefined, cookies.dee)).status).toBe(403);
    const removed = await call('delete', `${base}/3`);
    expect(removed.status, removed.text).toBe(200);
    expect(
      (removed.body.event.assessmentStages as Array<{ stage: string; wave: number }>)
        .filter((s) => s.stage === 'pre_conference')
        .map((s) => s.wave)
        .sort(),
    ).toEqual([1, 2]);
    expect((await call('delete', `${base}/3`)).status).toBe(404);
  });
});
