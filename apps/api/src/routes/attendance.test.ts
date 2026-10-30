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

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('attendance management', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let day1 = '';
  let day2 = '';
  let sessionId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const delegates: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-05T08:30:00.000Z'); // within the session idle window

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

  async function signedIn(role: 'admin' | 'delegate', email: string) {
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
    cookies[role] = `mbc_session=${token}`;
    return account;
  }

  beforeAll(async () => {
    prisma = testPrisma();
    await signedIn('admin', `admin-att-${tag}@example.com`);
    const delegateAccount = await signedIn('delegate', `dee-att-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Att ${tag}`,
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
    const session = await call('post', `/events/${eventId}/sessions`, {
      title: 'Opening keynote',
      date: '2026-11-12',
      startTime: '09:00',
      endTime: '10:00',
      sessionType: 'keynote',
    });
    expect(session.status, session.text).toBe(201);
    sessionId = session.body.event.sessions[0].id;
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const dee = await createRegisteredIdentity(prisma, eventId, `dee-att-${tag}@example.com`, {
      name: 'Dee Legate',
      attendanceFormat: 'physical',
      userAccountId: delegateAccount.id,
    });
    const vee = await createRegisteredIdentity(prisma, eventId, `vee-att-${tag}@example.com`, {
      name: 'Vee Virtual',
      attendanceFormat: 'virtual',
    });
    const wee = await createRegisteredIdentity(prisma, eventId, `wee-att-${tag}@example.com`, {
      name: 'Wee Virtual',
      attendanceFormat: 'virtual',
    });
    const gone = await createRegisteredIdentity(prisma, eventId, `gone-att-${tag}@example.com`, {
      name: 'Gone Away',
      registrationStatus: 'cancelled',
    });
    identityIds.push(dee.identity.id, vee.identity.id, wee.identity.id, gone.identity.id);
    delegates.dee = dee.delegate.id;
    delegates.vee = vee.delegate.id;
    delegates.wee = wee.delegate.id;
    delegates.gone = gone.delegate.id;
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('gives the delegate a code per date, checks in by QR after validation, and never counts the code itself', async () => {
    const base = `/events/${eventId}/attendance`;
    expect((await call('get', base, undefined, '')).status).toBe(401);
    expect((await call('get', base, undefined, cookies.delegate)).status).toBe(403);

    // The delegate's own view creates the codes; the admin does not see them.
    const mine = await call('get', `/me/events/${eventId}/attendance`, undefined, cookies.delegate);
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.attendance.overall).toBe('pending');
    expect(
      mine.body.attendance.dates.map((d: { date: string; daily: string }) => [d.date, d.daily]),
    ).toEqual([
      ['2026-11-12', 'not_checked_in'],
      ['2026-11-13', 'not_checked_in'],
    ]);
    const [codeDay1, codeDay2] = mine.body.attendance.dates.map((d: { token: string }) => d.token);
    expect(codeDay1).not.toBe(codeDay2);
    expect(codeDay1).not.toMatch(/@/);
    // The same code comes back next time (nothing is stored but its hash).
    const again = await call(
      'get',
      `/me/events/${eventId}/attendance`,
      undefined,
      cookies.delegate,
    );
    expect(again.body.attendance.dates[0].token).toBe(codeDay1);
    expect(await prisma.attendanceToken.count({ where: { eventId } })).toBe(2);

    // Scanning validates without recording.
    const bad = await call('post', `${base}/scan`, {
      token: 'not-a-real-code-at-all',
      eventDateId: day1,
    });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('invalid_code');
    const wrongDay = await call('post', `${base}/scan`, { token: codeDay2, eventDateId: day1 });
    expect(wrongDay.status).toBe(409);
    expect(wrongDay.body.error.code).toBe('wrong_date');
    const scan = await call('post', `${base}/scan`, { token: codeDay1, eventDateId: day1 });
    expect(scan.status, scan.text).toBe(200);
    expect(scan.body).toMatchObject({
      delegate: { name: 'Dee Legate', attendanceFormat: 'physical' },
      date: { id: day1, date: '2026-11-12' },
      record: null,
    });
    expect(await prisma.attendanceRecord.count({ where: { eventId } })).toBe(0);

    // The admin confirms after checking the person; a second check-in is refused.
    const checkIn = await call('post', `${base}/check-in`, { token: codeDay1, eventDateId: day1 });
    expect(checkIn.status, checkIn.text).toBe(201);
    expect(checkIn.body.record).toMatchObject({
      status: 'attended',
      mode: 'physical',
      method: 'qr',
      recordedBy: `admin-att-${tag}@example.com`,
    });
    const twice = await call('post', `${base}/check-in`, { token: codeDay1, eventDateId: day1 });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('already_recorded');
    expect(await prisma.auditLog.count({ where: { eventId, action: 'attendance.recorded' } })).toBe(
      1,
    );

    const list = await call('get', `${base}/dates/${day1}`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.counts).toMatchObject({
      registered: 3,
      attended: 1,
      notCheckedIn: 2,
      physical: 1,
      virtual: 0,
      rate: 33.3,
    });
    expect(
      list.body.rows.map((r: { delegate: { name: string }; daily: string }) => [
        r.delegate.name,
        r.daily,
      ]),
    ).toEqual([
      ['Dee Legate', 'attended'],
      ['Vee Virtual', 'not_checked_in'],
      ['Wee Virtual', 'not_checked_in'],
    ]);
    const filtered = await call('get', `${base}/dates/${day1}?format=virtual&q=vee`);
    expect(filtered.body.rows.map((r: { delegate: { name: string } }) => r.delegate.name)).toEqual([
      'Vee Virtual',
    ]);
  });

  it('marks virtual attendance manually and in bulk without duplicates, corrects with a reason, and closes the date with absences', async () => {
    const base = `/events/${eventId}/attendance`;
    const manual = await call('post', `${base}/dates/${day1}/mark`, {
      delegateId: delegates.vee,
      status: 'partial',
      note: 'Joined the afternoon only',
    });
    expect(manual.status, manual.text).toBe(201);
    expect(manual.body.record).toMatchObject({
      status: 'partial',
      mode: 'virtual',
      method: 'manual',
    });
    expect(
      (await call('post', `${base}/dates/${day1}/mark`, { delegateId: delegates.vee })).status,
    ).toBe(409);
    expect(
      (await call('post', `${base}/dates/${day1}/mark`, { delegateId: delegates.gone })).status,
    ).toBe(404);

    // Bulk: one new, one already recorded, one not registered.
    const bulk = await call('post', `${base}/dates/${day1}/bulk`, {
      delegateIds: [delegates.wee, delegates.vee, delegates.gone],
    });
    expect(bulk.status, bulk.text).toBe(201);
    expect(bulk.body).toEqual({
      created: 1,
      skipped: [
        { delegateId: delegates.vee, reason: 'Already recorded.' },
        { delegateId: delegates.gone, reason: 'No active registration with this id.' },
      ],
    });
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'attendance.bulk_recorded' } }),
    ).toBe(1);

    // Correction keeps the row, records old and new values and the reason.
    const recordId = manual.body.record.id;
    expect((await call('patch', `${base}/records/${recordId}`, { status: 'partial' })).status).toBe(
      422,
    );
    expect(
      (
        await call('patch', `${base}/records/${recordId}`, {
          status: 'partial',
          reason: 'Same values',
        })
      ).status,
    ).toBe(409);
    const corrected = await call('patch', `${base}/records/${recordId}`, {
      status: 'attended',
      reason: 'Joined the morning too, per the host',
    });
    expect(corrected.status, corrected.text).toBe(200);
    expect(corrected.body.record).toMatchObject({
      id: recordId,
      status: 'attended',
      method: 'correction',
    });
    const correction = await prisma.auditLog.findFirstOrThrow({
      where: { eventId, action: 'attendance.corrected' },
    });
    expect(correction.oldValue).toMatchObject({ status: 'partial', method: 'manual' });
    expect(correction.newValue).toMatchObject({
      status: 'attended',
      reason: 'Joined the morning too, per the host',
    });

    // Day 2: nobody recorded; closing marks the three registered delegates absent, once.
    const overviewBefore = await call('get', base);
    expect(overviewBefore.body.overview.overall).toMatchObject({
      registered: 3,
      attended: 0,
      pending: 3,
      attendees: 3,
    });
    const closed = await call('post', `${base}/dates/${day2}/close`, { markAbsent: true });
    expect(closed.status, closed.text).toBe(200);
    expect(closed.body.markedAbsent).toBe(3);
    expect((await call('post', `${base}/dates/${day2}/close`, {})).status).toBe(409);
    const day2List = await call('get', `${base}/dates/${day2}`);
    expect(day2List.body.date.closedAt).toBe(now.toISOString());
    expect(day2List.body.counts).toMatchObject({ absent: 3, notCheckedIn: 0, rate: 0 });

    // Overall: everyone attended day 1 (Dee by QR, Vee corrected, Wee bulk), nobody day 2.
    const overview = await call('get', base);
    expect(overview.status, overview.text).toBe(200);
    expect(overview.body.overview.overall).toMatchObject({
      registered: 3,
      attended: 0,
      partial: 3,
      pending: 0,
      attendees: 3,
      rate: 100,
    });
    // Day 1 is still open but already attended by everyone, so closing it changes nothing.
    now = new Date('2026-11-06T20:00:00.000Z');
    await call('post', `${base}/dates/${day1}/close`, { markAbsent: true });
    const final = await call('get', base);
    expect(final.body.overview.overall).toMatchObject({ partial: 3, pending: 0, absent: 0 });
    expect(
      final.body.overview.dates.map(
        (d: { date: string; counts: { attended: number; absent: number } }) => [
          d.date,
          d.counts.attended,
          d.counts.absent,
        ],
      ),
    ).toEqual([
      ['2026-11-12', 3, 0],
      ['2026-11-13', 0, 3],
    ]);
  });

  it('records session attendance separately and shows one delegate’s profile with history', async () => {
    const base = `/events/${eventId}/attendance`;
    expect(
      (await call('post', `${base}/sessions/${sessionId}`, { remove: [delegates.dee] })).status,
    ).toBe(422);
    const set = await call('post', `${base}/sessions/${sessionId}`, {
      add: [delegates.dee, delegates.vee, delegates.gone],
    });
    expect(set.status, set.text).toBe(200);
    expect(set.body).toEqual({ added: 2, removed: 0, skipped: [delegates.gone] });
    const undo = await call('post', `${base}/sessions/${sessionId}`, {
      remove: [delegates.vee],
      reason: 'Marked by mistake',
    });
    expect(undo.body).toMatchObject({ added: 0, removed: 1 });
    const session = await call('get', `${base}/sessions/${sessionId}`);
    expect(session.status, session.text).toBe(200);
    expect(session.body.counts).toEqual({ registered: 3, attended: 1, rate: 33.3 });
    expect(
      session.body.rows.map((r: { delegate: { name: string }; attended: boolean }) => [
        r.delegate.name,
        r.attended,
      ]),
    ).toEqual([
      ['Dee Legate', true],
      ['Vee Virtual', false],
      ['Wee Virtual', false],
    ]);

    const profile = await call('get', `${base}/delegates/${delegates.vee}`);
    expect(profile.status, profile.text).toBe(200);
    expect(profile.body.profile).toMatchObject({
      delegate: { name: 'Vee Virtual' },
      overall: 'partial',
      sessionsAttended: 0,
      sessionsTotal: 1,
    });
    expect(
      profile.body.profile.dates.map((d: { date: string; daily: string }) => [d.date, d.daily]),
    ).toEqual([
      ['2026-11-12', 'attended'],
      ['2026-11-13', 'absent'],
    ]);
    expect(profile.body.profile.sessions).toEqual([
      expect.objectContaining({ title: 'Opening keynote', attended: false }),
    ]);
    expect(
      profile.body.profile.history.map((h: { action: string; reason: string | null }) => [
        h.action,
        h.reason,
      ]),
    ).toEqual([
      ['attendance.corrected', 'Joined the morning too, per the host'],
      ['attendance.recorded', null],
    ]);
    expect((await call('get', `${base}/delegates/${randomUUID()}`)).status).toBe(404);

    // The delegate sees the recorded status, the session, and no code for a closed day.
    const mine = await call('get', `/me/events/${eventId}/attendance`, undefined, cookies.delegate);
    expect(mine.body.attendance.overall).toBe('partial');
    expect(mine.body.attendance.sessionsAttended).toEqual([
      expect.objectContaining({ title: 'Opening keynote' }),
    ]);
    const events = await call('get', `/me/events/${eventId}`, undefined, cookies.delegate);
    expect(events.body.event.attendance.status).toBe('partial');
  });
});
