import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { authConfigFromEnv } from '../auth/config.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import type { PrismaClient } from '../db.js';
import { hasDatabase, testPrisma } from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('event setup (E1 brief)', () => {
  let prisma: PrismaClient;
  const accountIds: string[] = [];
  const eventIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
    });
  async function signedIn(role: 'admin' | 'speaker') {
    const account = await prisma.userAccount.create({
      data: { email: `${role}-setup-${tag}@example.com`, role },
    });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    cookies[role] = `mbc_session=${token}`;
  }
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
  const profile = {
    name: `Transfer Summit ${tag}`,
    description: 'A one-day summit on training transfer.',
    eventType: 'summit',
    organiser: 'M.Bryan Consulting Limited',
    format: 'hybrid',
    timezone: 'Africa/Lagos',
    location: 'Lagos Oriental Hotel',
    website: 'https://example.com/summit',
  };

  beforeAll(async () => {
    prisma = testPrisma();
    await signedIn('admin');
    await signedIn('speaker');
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is admin-only and validates the profile and dates', async () => {
    const body = { ...profile, dates: ['2026-11-10', '2026-11-12'] };
    expect((await call('post', '/events', body, '')).status).toBe(401);
    expect((await call('post', '/events', body, cookies.speaker)).status).toBe(403);
    expect((await call('post', '/events', { ...body, dates: [] })).status).toBe(422);
    expect(
      (await call('post', '/events', { ...body, dates: ['2026-11-10', '2026-11-10'] })).status,
    ).toBe(422);
    expect((await call('post', '/events', { ...body, dates: ['2026-02-30'] })).status).toBe(422);
    expect((await call('post', '/events', { ...body, timezone: 'Mars/Olympus' })).status).toBe(422);
    const noVenue = await call('post', '/events', { ...body, location: '' });
    expect(noVenue.status).toBe(422);
    expect(noVenue.body.error.message).toMatch(/venue or location/i);
    // The code is generated from the name; a second event with the same name gets a numbered code.
    const first = await call('post', '/events', { ...body, format: 'virtual', location: '' });
    expect(first.status).toBe(201);
    expect(first.body.event.code).toBe(`transfer-summit-${tag}`);
    eventIds.push(first.body.event.id);
    const second = await call('post', '/events', body);
    expect(second.status).toBe(201);
    expect(second.body.event.code).toBe(`transfer-summit-${tag}-2`);
    eventIds.push(second.body.event.id);
    // The preview says what the next event of that name would be called.
    const preview = await call(
      'get',
      `/events/code-preview?name=${encodeURIComponent(profile.name)}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      base: `transfer-summit-${tag}`,
      code: `transfer-summit-${tag}-3`,
      available: false,
    });
    expect((await call('get', `/events/code-preview?name=Brand%20New%20${tag}`)).body).toEqual({
      base: `brand-new-${tag}`,
      code: `brand-new-${tag}`,
      available: true,
    });
    expect(
      (await call('get', '/events/code-preview?name=x', undefined, cookies.speaker)).status,
    ).toBe(403);
    // A client-supplied code is ignored.
    const supplied = await call('post', '/events', { ...body, code: 'my-own-code' });
    expect(supplied.body.event.code).toBe(`transfer-summit-${tag}-3`);
    eventIds.push(supplied.body.event.id);
  });

  it('creates a draft with non-consecutive dates in order, derived start and end, three disabled stages, and audits it', async () => {
    const code = `transfer-summit-b-${tag}`;
    const res = await call('post', '/events', {
      ...profile,
      name: `Transfer Summit B ${tag}`,
      dates: ['2026-11-17', '2026-11-10', '2026-11-12'],
    });
    expect(res.status, res.text).toBe(201);
    const ev = res.body.event;
    eventIds.push(ev.id);
    expect(ev).toMatchObject({
      code,
      slug: code,
      status: 'draft',
      eventType: 'summit',
      startsOn: '2026-11-10',
      endsOn: '2026-11-17',
    });
    expect(ev.dates.map((d: { date: string }) => d.date)).toEqual([
      '2026-11-10',
      '2026-11-12',
      '2026-11-17',
    ]);
    expect(ev.sessions).toEqual([]);
    expect(
      ev.assessmentStages.map((s: { stage: string; enabled: boolean; status: string }) => [
        s.stage,
        s.enabled,
        s.status,
      ]),
    ).toEqual([
      ['pre_conference', false, 'draft'],
      ['during_conference', false, 'draft'],
      ['follow_up', false, 'draft'],
    ]);
    expect(await prisma.participationCategory.count({ where: { eventId: ev.id } })).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { action: 'event.created', entityId: ev.id } }),
    ).toBe(1);

    // The detail route serves the same shape; the list carries the type.
    const detail = await call('get', `/events/${ev.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.event.dates).toHaveLength(3);
    const list = await call('get', '/events');
    expect(
      (list.body.events as Array<{ id: string; eventType: string }>).find((e) => e.id === ev.id)
        ?.eventType,
    ).toBe('summit');

    // Profile patch: the code cannot be changed, venue rule on the merged profile, audit.
    expect((await call('patch', `/events/${ev.id}`, { code: 'other' })).body.event.code).toBe(code);
    expect((await call('patch', `/events/${ev.id}`, { location: '' })).status).toBe(422);
    const patched = await call('patch', `/events/${ev.id}`, {
      name: 'Transfer Summit 2026',
      theme: 'Impact',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.event).toMatchObject({ name: 'Transfer Summit 2026', theme: 'Impact' });
    expect(
      await prisma.auditLog.count({ where: { action: 'event.updated', entityId: ev.id } }),
    ).toBe(1);
  });

  it('binds sessions to selected dates, enforces times, blocks removing a date with sessions, and keeps the schedule in order', async () => {
    const created = await call('post', '/events', {
      ...profile,
      name: `Transfer Summit C ${tag}`,
      dates: ['2026-11-10', '2026-11-12'],
    });
    const id = created.body.event.id as string;
    eventIds.push(id);
    const session = {
      title: 'Opening keynote',
      date: '2026-11-12',
      startTime: '09:00',
      endTime: '10:00',
      sessionType: 'keynote',
      speaker: 'Dr A. Speaker',
    };
    expect(
      (await call('post', `/events/${id}/sessions`, { ...session, date: '2026-11-11' })).body.error
        .code,
    ).toBe('date_not_in_event');
    expect(
      (await call('post', `/events/${id}/sessions`, { ...session, endTime: '09:00' })).status,
    ).toBe(422);
    expect(
      (await call('post', `/events/${id}/sessions`, { ...session, startTime: '9am' })).status,
    ).toBe(422);
    const s1 = await call('post', `/events/${id}/sessions`, session);
    expect(s1.status, s1.text).toBe(201);
    const s2 = await call('post', `/events/${id}/sessions`, {
      ...session,
      title: 'Early workshop',
      date: '2026-11-10',
      startTime: '14:00',
      endTime: '16:00',
      sessionType: 'workshop',
      capacity: 30,
    });
    const s3 = await call('post', `/events/${id}/sessions`, {
      ...session,
      title: 'Morning panel',
      startTime: '08:00',
      endTime: '08:45',
      sessionType: 'panel',
    });
    expect(s3.body.event.sessions.map((s: { title: string }) => s.title)).toEqual([
      'Early workshop',
      'Morning panel',
      'Opening keynote',
    ]);
    expect(s2.status).toBe(201);
    const keynoteId = (s1.body.event.sessions as Array<{ id: string; title: string }>).find(
      (s) => s.title === 'Opening keynote',
    )!.id;

    // Edit: moving to a date outside the event is refused; a time patch is checked against the stored other half.
    expect(
      (await call('patch', `/events/${id}/sessions/${keynoteId}`, { date: '2026-11-11' })).body
        .error.code,
    ).toBe('date_not_in_event');
    expect(
      (await call('patch', `/events/${id}/sessions/${keynoteId}`, { endTime: '08:30' })).status,
    ).toBe(422);
    const moved = await call('patch', `/events/${id}/sessions/${keynoteId}`, {
      date: '2026-11-10',
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(moved.status).toBe(200);
    expect(
      (moved.body.event.sessions as Array<{ title: string; date: string }>).find(
        (s) => s.title === 'Opening keynote',
      )?.date,
    ).toBe('2026-11-10');

    // Delete the panel; its date is then free.
    const panelId = (moved.body.event.sessions as Array<{ id: string; title: string }>).find(
      (s) => s.title === 'Morning panel',
    )!.id;
    const gone = await call('delete', `/events/${id}/sessions/${panelId}`);
    expect(gone.status).toBe(200);
    expect(gone.body.event.sessions).toHaveLength(2);
    expect((await call('delete', `/events/${id}/sessions/${panelId}`)).status).toBe(404);

    // Dates: removing a date with sessions is refused with the count; removing a free date works; start/end follow.
    const blocked = await call('put', `/events/${id}/dates`, { dates: ['2026-11-12'] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('dates_have_sessions');
    expect(blocked.body.error.message).toContain('2026-11-10 (2)');
    const freed = await call('put', `/events/${id}/dates`, { dates: ['2026-11-10', '2026-11-20'] });
    expect(freed.status, freed.text).toBe(200);
    expect(freed.body.event.dates.map((d: { date: string }) => d.date)).toEqual([
      '2026-11-10',
      '2026-11-20',
    ]);
    expect(freed.body.event).toMatchObject({ startsOn: '2026-11-10', endsOn: '2026-11-20' });
    expect(
      await prisma.auditLog.count({ where: { action: 'event.dates_changed', entityId: id } }),
    ).toBe(1);
  });

  it('configures each assessment stage independently with valid windows, and publishes only a complete event', async () => {
    const created = await call('post', '/events', {
      ...profile,
      name: `Transfer Summit D ${tag}`,
      dates: ['2026-11-12'],
    });
    const id = created.body.event.id as string;
    eventIds.push(id);
    expect((await call('put', `/events/${id}/assessments/nope`, { enabled: true })).status).toBe(
      404,
    );
    expect(
      (
        await call('put', `/events/${id}/assessments/pre_conference`, {
          enabled: true,
          opensAt: '2026-11-05T09:00:00+01:00',
          closesAt: '2026-11-01T09:00:00+01:00',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('put', `/events/${id}/assessments/pre_conference`, {
          enabled: false,
          status: 'open',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('put', `/events/${id}/assessments/pre_conference`, {
          enabled: true,
          target: 'group',
        })
      ).status,
    ).toBe(422);
    // Scheduling or opening needs at least one question on the stage.
    const noQuestions = await call('put', `/events/${id}/assessments/pre_conference`, {
      enabled: true,
      opensAt: '2026-11-01T09:00:00+01:00',
      closesAt: '2026-11-11T23:59:00+01:00',
      status: 'scheduled',
    });
    expect(noQuestions.status).toBe(422);
    expect(noQuestions.body.error.code).toBe('stage_without_questions');
    expect(
      (
        await call('post', `/events/${id}/assessments/pre_conference/questions`, {
          prompt: 'What do you expect to gain?',
          type: 'long_text',
        })
      ).status,
    ).toBe(201);
    const pre = await call('put', `/events/${id}/assessments/pre_conference`, {
      enabled: true,
      opensAt: '2026-11-01T09:00:00+01:00',
      closesAt: '2026-11-11T23:59:00+01:00',
      status: 'scheduled',
    });
    expect(pre.status, pre.text).toBe(200);
    const follow = await call('put', `/events/${id}/assessments/follow_up`, {
      enabled: true,
      target: 'group',
      targetGroup: 'Nominated delegates',
    });
    expect(follow.status).toBe(200);
    // Publishing needs questions on every enabled stage.
    expect(
      (
        await call('post', `/events/${id}/assessments/follow_up/questions`, {
          prompt: 'Have you applied what you learned?',
          type: 'yes_no',
        })
      ).status,
    ).toBe(201);
    const stages = follow.body.event.assessmentStages as Array<Record<string, unknown>>;
    expect(stages.map((s) => [s.stage, s.enabled, s.status])).toEqual([
      ['pre_conference', true, 'scheduled'],
      ['during_conference', false, 'draft'],
      ['follow_up', true, 'draft'],
    ]);
    expect(stages[0]?.opensAt).toBe('2026-11-01T08:00:00.000Z');
    expect(stages[2]).toMatchObject({ target: 'group', targetGroup: 'Nominated delegates' });
    expect(
      await prisma.auditLog.count({
        where: { action: 'event.assessment_configured', eventId: id },
      }),
    ).toBe(2);

    // Publish: refused without a venue for a hybrid event, allowed once complete; archived events are frozen.
    await prisma.event.update({ where: { id }, data: { location: null } });
    const refused = await call('post', `/events/${id}/status`, { status: 'active' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('not_publishable');
    await prisma.event.update({ where: { id }, data: { location: 'Lagos' } });
    const published = await call('post', `/events/${id}/status`, { status: 'active' });
    expect(published.status).toBe(200);
    expect(published.body.event.status).toBe('active');
    expect(
      await prisma.auditLog.count({ where: { action: 'event.status_changed', entityId: id } }),
    ).toBe(1);
    const archived = await call('post', `/events/${id}/status`, { status: 'archived' });
    expect(archived.body.event.status).toBe('archived');
    expect((await call('patch', `/events/${id}`, { name: 'x' })).body.error.code).toBe(
      'event_archived',
    );
    expect((await call('put', `/events/${id}/dates`, { dates: ['2026-11-12'] })).status).toBe(409);
    expect(
      (await call('post', `/events/${id}/status`, { status: 'draft' })).body.event.status,
    ).toBe('draft');
  });
});
