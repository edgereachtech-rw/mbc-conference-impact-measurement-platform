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

describe.skipIf(!hasDatabase)('transfer support requests', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let deeId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-07T10:00:00.000Z');
  const mailer = new MemoryMailer();

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

  /** Moves the test clock in steps that keep every session inside its idle window. */
  async function tick(iso: string) {
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
    await signedIn('admin', 'admin', `admin-sr-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-sr-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Support ${tag}`,
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
    const a = await createRegisteredIdentity(prisma, eventId, `dee-sr-${tag}@example.com`, {
      name: 'Dee Legate',
      userAccountId: dee.id,
    });
    identityIds.push(a.identity.id);
    deeId = a.delegate.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('lets a delegate ask for support from the plan page, and the organisers see, answer and close it', async () => {
    // The plan exists on first access; the request names one of its actions.
    const plans = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    const planId = plans.body.plans[0].id as string;
    const saved = await call(
      'put',
      `/me/events/${eventId}/transfer-plans/${planId}`,
      { version: 1, actions: [{ action: 'Introduce a tracking process', isPriority: true }] },
      cookies.dee,
    );
    const actionId = saved.body.plan.actions[0].id as string;

    const foreign = await call(
      'post',
      `/me/events/${eventId}/support-requests`,
      { request: 'Help', actionId: randomUUID() },
      cookies.dee,
    );
    expect(foreign.status).toBe(422);
    const asked = await call(
      'post',
      `/me/events/${eventId}/support-requests`,
      {
        request: 'A short call with someone who has set up tracking before.',
        barrier: 'No one in my team has done it.',
        actionId,
      },
      cookies.dee,
    );
    expect(asked.status, asked.text).toBe(201);
    expect(asked.body.request).toMatchObject({
      source: 'delegate',
      context: 'Transfer plan page',
      action: 'Introduce a tracking process',
      status: 'open',
      actionTaken: '',
      addressedBy: null,
    });
    expect(asked.body.request).not.toHaveProperty('delegate');
    const requestId = asked.body.request.id as string;
    const mine = await call(
      'get',
      `/me/events/${eventId}/support-requests`,
      undefined,
      cookies.dee,
    );
    expect(mine.body.requests.map((r: { id: string }) => r.id)).toEqual([requestId]);

    // Admins only on the organisers' side; delegates only on the delegate's side.
    expect(
      (await call('get', `/events/${eventId}/support-requests`, undefined, cookies.dee)).status,
    ).toBe(403);
    expect(
      (await call('post', `/me/events/${eventId}/support-requests`, { request: 'x' })).status,
    ).toBe(403);

    const list = await call('get', `/events/${eventId}/support-requests`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.counts).toEqual({ open: 1, addressed: 0 });
    expect(list.body.barriers).toEqual([{ text: 'No one in my team has done it.', count: 1 }]);
    expect(list.body.requests[0]).toMatchObject({
      id: requestId,
      delegate: { id: deeId, name: 'Dee Legate' },
      request: 'A short call with someone who has set up tracking before.',
      action: 'Introduce a tracking process',
    });

    await tick('2026-11-08T09:00:00.000Z');
    const addressed = await call('patch', `/events/${eventId}/support-requests/${requestId}`, {
      status: 'addressed',
      actionTaken: 'Introduced to a 2025 delegate who runs tracking; call held 21 Nov.',
    });
    expect(addressed.status, addressed.text).toBe(200);
    expect(addressed.body.request).toMatchObject({
      status: 'addressed',
      addressedAt: '2026-11-08T09:00:00.000Z',
      addressedBy: `admin-sr-${tag}@example.com`,
    });
    const after = await call('get', `/events/${eventId}/support-requests`);
    expect(after.body.counts).toEqual({ open: 0, addressed: 1 });
    // Reopening clears who addressed it; the note stays.
    const reopened = await call('patch', `/events/${eventId}/support-requests/${requestId}`, {
      status: 'open',
      actionTaken: 'Call held; delegate asked for a second one.',
    });
    expect(reopened.body.request).toMatchObject({
      status: 'open',
      addressedAt: null,
      addressedBy: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { eventId, action: { in: ['support_request.created', 'support_request.updated'] } },
      }),
    ).toBe(3);
  });

  it('raises a request from a follow-up answer whose question asks about support, once', async () => {
    // A follow-up wave with a support question and a barrier question, open now.
    // Every event starts with a draft first wave; this one is opened with two questions.
    const stage = await prisma.assessmentStageConfig.upsert({
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
    const barrierQ = await prisma.assessmentQuestion.create({
      data: {
        stageConfigId: stage.id,
        eventId,
        order: 1,
        prompt: 'What has delayed or prevented progress?',
        type: 'long_text',
        required: false,
        area: 'Barriers',
      },
    });
    const supportQ = await prisma.assessmentQuestion.create({
      data: {
        stageConfigId: stage.id,
        eventId,
        order: 2,
        prompt: 'What support do you need from M.Bryan or another stakeholder?',
        type: 'long_text',
        required: false,
        area: 'Support needs',
      },
    });
    await tick('2026-12-15T09:00:00.000Z');
    // A draft raises nothing; the submitted section does, with the barrier beside it.
    const draft = await call(
      'put',
      `/me/events/${eventId}/assessments/follow_up?wave=1`,
      { answers: { [supportQ.id]: 'An introduction to the HR director.' } },
      cookies.dee,
    );
    expect(draft.status, draft.text).toBe(200);
    expect(await prisma.supportRequest.count({ where: { eventId, source: 'follow_up' } })).toBe(0);
    // The wave asks where each planned action stands before it can be submitted (2026-11-08).
    const plans = await call('get', `/me/events/${eventId}/transfer-plans`, undefined, cookies.dee);
    const plan = await call(
      'get',
      `/me/events/${eventId}/transfer-plans/${plans.body.plans[0].id}`,
      undefined,
      cookies.dee,
    );
    const statuses = await call(
      'put',
      `/me/events/${eventId}/assessments/follow_up/plan-progress?wave=1`,
      {
        actions: (plan.body.plan.actions as Array<{ id: string }>).map((a) => ({
          actionId: a.id,
          status: 'started',
        })),
      },
      cookies.dee,
    );
    expect(statuses.status, statuses.text).toBe(200);
    const submitted = await call(
      'put',
      `/me/events/${eventId}/assessments/follow_up?wave=1`,
      {
        answers: {
          [barrierQ.id]: 'HR has not agreed the time.',
          [supportQ.id]: 'An introduction to the HR director.',
        },
        submit: true,
      },
      cookies.dee,
    );
    expect(submitted.status, submitted.text).toBe(200);
    const list = await call('get', `/events/${eventId}/support-requests`);
    const raised = list.body.requests.filter((r: { source: string }) => r.source === 'follow_up');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      context: '30-day follow-up',
      request: 'An introduction to the HR director.',
      barrier: 'HR has not agreed the time.',
      status: 'open',
      delegate: { id: deeId },
    });
    expect(list.body.counts.open).toBe(2);
    expect(list.body.barriers.map((b: { text: string }) => b.text)).toContain(
      'HR has not agreed the time.',
    );
  });
});
