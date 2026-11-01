import { randomUUID } from 'node:crypto';

import type { EventReport } from '@mbc/shared';
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

type Q = { id: string; builtin: string | null; sourceQuestionKey: string | null; prompt: string };

/**
 * A known-results dataset (backlog E15-18): four registered delegates (plus one cancelled),
 * two dates, attendance on both, a pre-conference baseline, an end-of-conference evaluation
 * with a mirrored knowledge section and the expectations block, a follow-up, two Transfer
 * Plans with progress, a measure and evidence. Every figure below is worked out by hand.
 */
describe.skipIf(!hasDatabase)('event dashboards and reports', () => {
  let prisma: PrismaClient;
  let eventId = '';
  let adminId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-05T10:00:00.000Z');
  const ids: Record<string, string> = {};
  const delegateIds: Record<string, string> = {};

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
  /** Moves the clock in steps short enough to keep every session inside its idle window. */
  async function tick(iso: string) {
    const target = new Date(iso);
    while (now < target) {
      now = new Date(Math.min(target.getTime(), now.getTime() + 6 * 86_400_000));
      for (const cookie of Object.values(cookies)) await call('get', '/auth/me', undefined, cookie);
    }
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
  const pre = () => `/events/${eventId}/assessments/pre_conference`;
  const eoc = () => `/events/${eventId}/assessments/end_of_conference`;
  const fup = () => `/events/${eventId}/assessments/follow_up`;
  async function myQuestions(cookie: string | undefined, stage: string): Promise<Q[]> {
    const r = await call('get', `/me/events/${eventId}/assessments`, undefined, cookie);
    expect(r.status, r.text).toBe(200);
    const s = r.body.assessments.find((x: { stage: string }) => x.stage === stage);
    return s.questions as Q[];
  }
  const report = async (kind: string, query = '', cookie = cookies.admin) => {
    const r = await call('get', `/events/${eventId}/reports/${kind}${query}`, undefined, cookie);
    return r;
  };

  beforeAll(async () => {
    prisma = testPrisma();
    const admin = await signedIn('admin', 'admin', `admin-rep-${tag}@example.com`);
    adminId = admin.id;
    const dee = await signedIn('dee', 'delegate', `dee-rep-${tag}@example.com`);
    const ada = await signedIn('ada', 'delegate', `ada-rep-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `Report ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'hybrid',
      location: 'Lagos Oriental Hotel',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12', '2026-11-13'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const people: Array<[string, string, 'physical' | 'virtual', string | null, string | null]> = [
      ['dee', 'Dee Legate', 'physical', dee.id, 'Acme'],
      ['ada', 'Ada Other', 'virtual', ada.id, 'Acme'],
      ['bob', 'Bob Quiet', 'physical', null, null],
      ['cy', 'Cy Remote', 'virtual', null, 'Globex'],
    ];
    for (const [key, name, format, userAccountId, org] of people) {
      const r = await createRegisteredIdentity(prisma, eventId, `${key}-rep-${tag}@example.com`, {
        name,
        attendanceFormat: format,
        userAccountId,
      });
      identityIds.push(r.identity.id);
      delegateIds[key] = r.delegate.id;
      if (org) {
        await prisma.delegate.update({
          where: { id: r.delegate.id },
          data: {
            nominatingOrganisation: org,
            capacity: 'nominee',
            signedUpAt: userAccountId ? now : null,
          },
        });
      }
    }
    const gone = await createRegisteredIdentity(prisma, eventId, `gone-rep-${tag}@example.com`, {
      name: 'Gone Away',
      registrationStatus: 'cancelled',
    });
    identityIds.push(gone.identity.id);
    // Attendance: day 1 Dee attended, Ada partial, Bob absent, Cy nothing; day 2 Dee attended.
    const dates = await prisma.eventDate.findMany({ where: { eventId }, orderBy: { date: 'asc' } });
    ids.day1 = dates[0]!.id;
    ids.day2 = dates[1]!.id;
    const record = (
      delegateId: string,
      eventDateId: string,
      status: 'attended' | 'partial' | 'absent',
      mode: 'physical' | 'virtual',
    ) =>
      prisma.attendanceRecord.create({
        data: {
          eventId,
          delegateId,
          eventDateId,
          status,
          mode,
          method: 'manual',
          recordedByUserId: adminId,
        },
      });
    await record(delegateIds.dee!, ids.day1, 'attended', 'physical');
    await record(delegateIds.ada!, ids.day1, 'partial', 'virtual');
    await record(delegateIds.bob!, ids.day1, 'absent', 'physical');
    await record(delegateIds.dee!, ids.day2, 'attended', 'physical');
  });
  afterAll(async () => {
    if (eventId) {
      // Answers hold their question with onDelete: Restrict, so deleting the event while any
      // response exists fails and would leave this event's delegates behind for every later
      // test to scan. Clearing the responses first lets the event cascade take the rest.
      await prisma.assessmentResponse.deleteMany({ where: { stage: { eventId } } });
      await prisma.event.delete({ where: { id: eventId } });
    }
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is for admins only, and reports unconfigured stages as states rather than zeros', async () => {
    expect((await report('dashboard', '', '')).status).toBe(401);
    expect((await report('dashboard', '', cookies.dee)).status).toBe(403);
    expect((await report('nonsense')).status).toBe(404);
    expect((await call('get', `/events/${randomUUID()}/reports/dashboard`)).status).toBe(404);
    const r = await report('dashboard');
    expect(r.status, r.text).toBe(200);
    const d = r.body.report as EventReport;
    expect(d.kind).toBe('dashboard');
    expect(d.audience).toBe('internal');
    expect(d.approval).toBeNull();
    expect(d.sections).toHaveLength(6);
    expect(d.population).toMatchObject({ registered: 4 });
    const p = d.participation!;
    expect(p.registered).toMatchObject({ count: 4, of: 4, percent: 100 });
    expect(p.accounts).toMatchObject({ count: 2, of: 4, percent: 50 });
    expect(p.attended).toMatchObject({ count: 2, of: 4, percent: 50 });
    expect(p.assessed).toMatchObject({ count: 0, of: 4, percent: 0 });
    expect(p.byFormat).toEqual([
      { format: 'physical', registered: 2, accounts: 1, attended: 1, attendedRate: 50 },
      { format: 'virtual', registered: 2, accounts: 1, attended: 1, attendedRate: 50 },
    ]);
    expect(p.byDate[0]).toMatchObject({
      attended: 1,
      partial: 1,
      absent: 1,
      notCheckedIn: 1,
      physical: 1,
      virtual: 1,
      rate: 50,
      state: 'ok',
    });
    expect(p.byDate[1]).toMatchObject({ attended: 1, notCheckedIn: 3, rate: 25 });
    // No stage has questions yet: every stage is a state, and the rate is null, not 0.
    for (const s of p.stages) {
      expect(s).toMatchObject({ state: 'not_configured', responseRate: null, invited: 0 });
    }
    expect(d.expectations!.stage!.state).toBe('not_configured');
    expect(d.expectations!.organisationExpectations.state).toBe('not_collected');
    expect(d.expectationsEnd!.completed).toMatchObject({
      count: 0,
      of: 0,
      percent: null,
      state: 'not_configured',
    });
    expect(d.transfer!.plans.started).toMatchObject({ count: 0, of: 4, percent: 0 });
    expect(d.transfer!.plans.completionRate).toMatchObject({ count: 0, of: 2, percent: 0 });
    expect(d.transfer!.application.followUp).toBeNull();
    expect(d.results!.expectations.state).toBe('not_configured');
    expect(d.results!.measures.rowsState).toBe('no_response');
    expect(d.results!.evidence.examplesState).toBe('no_evidence');
    expect(d.limitations.join(' ')).toMatch(/never counted as zero/);
  });

  it('counts the known dataset exactly: baseline, paired learning, expectations at the end, plans, follow-up, measures', async () => {
    // Pre-conference: a reference text question, two knowledge questions, one confidence statement, one multi-select.
    const kSec = await call('post', `${pre()}/sections`, {
      title: 'Baseline knowledge',
      marking: 'knowledge',
    });
    const cSec = await call('post', `${pre()}/sections`, {
      title: 'Baseline confidence',
      marking: 'scored',
    });
    const q = async (path: string, body: object) => {
      const r = await call('post', `${path}/questions`, body);
      expect(r.status, r.text).toBe(201);
      ids[`key:${r.body.question.id}`] = r.body.question.questionKey;
      return r.body.question.id as string;
    };
    ids.k1 = await q(pre(), {
      prompt: 'What comes first?',
      type: 'single_choice',
      sectionId: kSec.body.section.id,
      options: [
        { value: 'a', label: 'A', correct: true },
        { value: 'b', label: 'B' },
      ],
    });
    ids.k2 = await q(pre(), {
      prompt: 'What comes next?',
      type: 'single_choice',
      sectionId: kSec.body.section.id,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', correct: true },
      ],
    });
    ids.c1 = await q(pre(), {
      prompt: 'I can identify a measure',
      type: 'single_choice',
      sectionId: cSec.body.section.id,
      options: [
        { value: '1', label: 'Low', score: 1 },
        { value: '3', label: 'High', score: 3 },
        { value: 'na', label: 'Not applicable', score: null },
      ],
    });
    ids.learn = await q(pre(), {
      prompt: 'What would you like to gain?',
      type: 'long_text',
      required: false,
    });
    ids.tools = await q(pre(), {
      prompt: 'Which do you use?',
      type: 'multiple_choice',
      required: false,
      options: [
        { value: 'plan', label: 'A transfer plan' },
        { value: 'baseline', label: 'Baseline data' },
      ],
    });
    await call('put', `/events/${eventId}/reference-questions`, {
      questionKeys: [ids[`key:${ids.learn}`]],
    });
    expect((await call('put', pre(), { enabled: true, status: 'open' })).status).toBe(200);
    // Dee: both knowledge right, confidence 1, wrote an expectation, uses both tools. Ada: one right, N/A, no expectation.
    const deePre = await call(
      'put',
      `/me/events/${eventId}/assessments/pre_conference`,
      {
        answers: {
          [ids.k1!]: 'a',
          [ids.k2!]: 'b',
          [ids.c1!]: '1',
          [ids.learn!]: 'How to measure transfer',
          [ids.tools!]: ['plan', 'baseline'],
        },
        submit: true,
      },
      cookies.dee,
    );
    expect(deePre.status, deePre.text).toBe(200);
    const adaPre = await call(
      'put',
      `/me/events/${eventId}/assessments/pre_conference`,
      {
        answers: { [ids.k1!]: 'a', [ids.k2!]: 'a', [ids.c1!]: 'na', [ids.tools!]: ['plan'] },
        submit: true,
      },
      cookies.ada,
    );
    expect(adaPre.status, adaPre.text).toBe(200);

    // End of conference: mirrored knowledge, expectations block, a physical-audience rating.
    const mirrored = await call('post', `${eoc()}/sections/mirror`, {
      sourceSectionId: kSec.body.section.id,
      title: 'Knowledge check',
    });
    expect(mirrored.status, mirrored.text).toBe(201);
    expect((await call('post', `${eoc()}/sections/builtin`, { kind: 'expectations' })).status).toBe(
      201,
    );
    const phys = await call('post', `${eoc()}/sections`, {
      title: 'In person',
      marking: 'scored',
      audience: 'physical',
    });
    ids.pq = await q(eoc(), {
      prompt: 'Venue and facilities.',
      type: 'single_choice',
      sectionId: phys.body.section.id,
      options: [
        { value: '4', label: 'Excellent', score: 4 },
        { value: '1', label: 'Poor', score: 1 },
      ],
    });
    ids.gained = await q(eoc(), {
      prompt: 'What did you learn?',
      type: 'long_text',
      required: false,
    });
    expect((await call('put', eoc(), { enabled: true, status: 'open' })).status).toBe(200);
    await tick('2026-11-13T15:00:00.000Z');
    const deeQ = await myQuestions(cookies.dee, 'end_of_conference');
    const by = (qs: Q[], builtin: string) => qs.find((x) => x.builtin === builtin)!.id;
    const src = (qs: Q[], sourceId: string) =>
      qs.find((x) => x.sourceQuestionKey === ids[`key:${sourceId}`])!.id;
    const deeEnd = await call(
      'put',
      `/me/events/${eventId}/assessments/end_of_conference`,
      {
        answers: {
          [src(deeQ, ids.k1!)]: 'a',
          [src(deeQ, ids.k2!)]: 'b',
          [by(deeQ, 'expectation_met_pre')]: 'fully',
          [by(deeQ, 'expectation_explain')]: 'Got the measures',
          [ids.pq!]: '4',
          [ids.gained!]: 'A way to baseline',
        },
        submit: true,
      },
      cookies.dee,
    );
    expect(deeEnd.status, deeEnd.text).toBe(200);
    const adaQ = await myQuestions(cookies.ada, 'end_of_conference');
    const adaEnd = await call(
      'put',
      `/me/events/${eventId}/assessments/end_of_conference`,
      {
        answers: {
          [src(adaQ, ids.k1!)]: 'a',
          [src(adaQ, ids.k2!)]: 'b',
          [by(adaQ, 'expectation_recorded_after')]: 'Practical tools',
          [by(adaQ, 'expectation_met_post')]: 'met',
        },
        submit: true,
      },
      cookies.ada,
    );
    expect(adaEnd.status, adaEnd.text).toBe(200);

    // Transfer plans: Dee submitted, Ada draft with content.
    const deePlan = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      {
        version: 1,
        actions: [
          {
            action: 'Brief stakeholders',
            isPriority: true,
            support: 'Time from my manager',
            targetOn: '2026-11-20',
          },
          { action: 'Baseline the error rate', barriers: 'Data access' },
        ],
        reminder: { frequency: 'weekly' },
      },
      cookies.dee,
    );
    expect(deePlan.status, deePlan.text).toBe(200);
    const submitted = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/submit`,
      { version: deePlan.body.plan.version },
      cookies.dee,
    );
    expect(submitted.status, submitted.text).toBe(200);
    const [a1, a2] = submitted.body.plan.actions as Array<{ id: string }>;
    const progress = await call(
      'post',
      `/me/events/${eventId}/transfer-plan/actions/${a1!.id}/progress`,
      { status: 'applied', note: 'Briefed them', challenges: 'Diary clashes' },
      cookies.dee,
    );
    expect(progress.status, progress.text).toBe(201);
    const measures = await call(
      'put',
      `/me/events/${eventId}/transfer-plan/actions/${a2!.id}/measures`,
      {
        version: progress.body.plan.version,
        measures: [
          {
            name: 'Error rate',
            kind: 'quantitative',
            unit: '%',
            direction: 'lower',
            baselineValue: '12',
            actualValue: '9',
            actualOn: '2027-01-15',
            support: 'supported',
            influences: 'New checklist too',
          },
          { status: 'not_yet_known' },
        ],
      },
      cookies.dee,
    );
    expect(measures.status, measures.text).toBe(200);
    const evidence = await call(
      'put',
      `/me/events/${eventId}/transfer-plan/actions/${a1!.id}/evidence`,
      {
        version: measures.body.plan.version,
        evidence: [
          {
            type: 'confirmation',
            description: 'Manager confirmed the briefing',
            support: 'supported',
            supportedBy: 'Line manager',
          },
        ],
      },
      cookies.dee,
    );
    expect(evidence.status, evidence.text).toBe(200);
    const adaPlan = await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      {
        version: 1,
        actions: [{ action: 'Try the checklist', isPriority: true }],
        reminder: { frequency: 'none' },
      },
      cookies.ada,
    );
    expect(adaPlan.status, adaPlan.text).toBe(200);

    // Follow-up: Dee and Ada respond; Dee has progress, Ada none.
    ids.fuText = await q(fup(), {
      prompt: 'What changed at work?',
      type: 'long_text',
      required: false,
    });
    expect((await call('put', fup(), { enabled: true, status: 'open' })).status).toBe(200);
    await tick('2026-12-15T10:00:00.000Z');
    expect(
      (
        await call(
          'put',
          `/me/events/${eventId}/assessments/follow_up`,
          { answers: { [ids.fuText!]: 'Fewer reworks' }, submit: true },
          cookies.dee,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'put',
          `/me/events/${eventId}/assessments/follow_up`,
          { answers: {}, submit: true },
          cookies.ada,
        )
      ).status,
    ).toBe(200);

    const r = await report('dashboard');
    expect(r.status, r.text).toBe(200);
    const d = r.body.report as EventReport;
    // Participation and stages.
    expect(d.participation!.assessed).toMatchObject({ count: 2, of: 4, percent: 50 });
    const stage = (s: string) => d.participation!.stages.find((x) => x.stage === s)!;
    expect(stage('pre_conference')).toMatchObject({
      invited: 4,
      submitted: 2,
      responseRate: 50,
      notSubmitted: 2,
      state: 'ok',
    });
    expect(stage('during_conference')).toMatchObject({
      state: 'not_configured',
      responseRate: null,
    });
    expect(stage('follow_up')).toMatchObject({ submitted: 2, responseRate: 50 });
    // Expectations and baseline: the reference question first, Dee's text, Ada's missing.
    const e = d.expectations!;
    expect(e.texts[0]).toMatchObject({ prompt: 'What would you like to gain?', responses: 1 });
    expect(e.texts[0]!.answers[0]).toMatchObject({
      delegate: { name: 'Dee Legate' },
      value: 'How to measure transfer',
    });
    expect(e.knowledge).toMatchObject({
      questions: 2,
      respondents: 2,
      averageScore: 1.5,
      averagePercent: 75,
      state: 'ok',
    });
    // Confidence: Ada's "Not applicable" is excluded, so one response averaging 1.
    expect(e.statements[0]).toMatchObject({ responses: 1, average: 1 });
    const tools = e.choices.find((c) => c.prompt === 'Which do you use?')!;
    expect(tools).toMatchObject({ multiple: true, responses: 2 });
    expect(tools.options).toEqual([
      { value: 'plan', label: 'A transfer plan', count: 2, percent: 100 },
      { value: 'baseline', label: 'Baseline data', count: 1, percent: 50 },
    ]);
    // Experience and learning: paired knowledge, Dee 100 → 100, Ada 50 → 100: +25 points over 2 delegates.
    const x = d.experience!;
    expect(x.ratings.physical[0]).toMatchObject({
      prompt: 'Venue and facilities.',
      responses: 1,
      average: 4,
    });
    expect(x.ratings.virtual).toEqual([]);
    expect(x.knowledge.before).toMatchObject({ averagePercent: 75 });
    expect(x.knowledge.after).toMatchObject({ averagePercent: 100, respondents: 2 });
    const paired = x.paired!.sections.find((s) => s.title === 'Knowledge check')!;
    expect(paired.knowledge).toEqual({
      questions: 2,
      paired: 2,
      averageBeforePercent: 75,
      averageAfterPercent: 100,
      changePoints: 25,
    });
    expect(x.written.find((w) => w.prompt === 'What did you learn?')).toMatchObject({
      responses: 1,
    });
    // Expectations at the end: Dee assessed her pre-event one, Ada recorded one afterwards.
    const xe = d.expectationsEnd!;
    expect(xe.completed).toMatchObject({ count: 2, of: 2, percent: 100 });
    expect(xe.met!.options.find((o) => o.value === 'fully')).toMatchObject({
      count: 1,
      percent: 100,
    });
    expect(xe.met!.responses).toBe(1);
    expect(xe.recordedAfter).toMatchObject({ count: 1, of: 2, percent: 50 });
    expect(xe.preferNotToAnswer).toBe(0);
    expect(xe.metPost!.options.find((o) => o.value === 'met')).toMatchObject({ count: 1 });
    // Transfer and application.
    const t = d.transfer!;
    expect(t.plans.started).toMatchObject({ count: 2, of: 4, percent: 50 });
    expect(t.plans.submitted).toMatchObject({ count: 1, of: 4, percent: 25 });
    expect(t.plans.incomplete).toMatchObject({ count: 1 });
    expect(t.plans.completionRate).toMatchObject({ count: 1, of: 2, percent: 50 });
    expect(t.actions).toMatchObject({
      total: 3,
      withSupport: 1,
      withBarriers: 1,
      withTarget: 1,
      overdueTarget: 0,
    });
    expect(t.actions.byStatus).toMatchObject({ applied: 1, not_started: 2 });
    expect(t.actions.priority.map((a) => a.action)).toEqual([
      'Brief stakeholders',
      'Try the checklist',
    ]);
    expect(t.reminders.byFrequency).toMatchObject({ weekly: 1, none: 1 });
    expect(t.application.appliedActions).toMatchObject({ count: 1, of: 3 });
    expect(t.application.appliedDelegates).toMatchObject({ count: 1, of: 2, percent: 50 });
    expect(t.application.followUp).toMatchObject({
      respondedWithProgress: 1,
      respondedNoProgress: 1,
      notResponded: 2,
    });
    expect(t.application.followUp!.texts[0]).toMatchObject({
      prompt: 'What changed at work?',
      responses: 1,
    });
    expect(t.application.barriers[1]).toMatchObject({ key: 'progress.challenges', responses: 1 });
    expect(t.application.measures).toMatchObject({ with_result: 1, none: 2 });
    expect(t.application.evidence).toEqual({ self_reported: 0, supported: 1 });
    // Results: a lower error rate is an improvement; the result is marked supported, nothing is verified.
    const res = d.results!;
    expect(res.measures.outcomes).toEqual({
      improved: 1,
      declined: 0,
      unchanged: 0,
      not_comparable: 0,
    });
    expect(res.measures.resultSupport).toEqual({ self_reported: 0, supported: 1 });
    expect(res.measures.rows[0]!.measures.map((m) => m.status)).toEqual([
      'identified',
      'not_yet_known',
    ]);
    expect(res.evidence.examples[0]).toMatchObject({
      support: 'supported',
      description: 'Manager confirmed the briefing',
    });
    expect(res.influences).toEqual(['New checklist too']);
    expect(res.expectations.state).toBe('not_configured');
    // "Verified" appears only where the report denies verification, never as a label on data.
    expect(d.limitations.join(' ')).toMatch(/neither label means independently verified/);
    expect(JSON.stringify({ ...d, limitations: [] })).not.toMatch(/verified/i);
  });

  it('filters by attendance format, organisation and period without changing the definitions', async () => {
    const physical = (await report('dashboard', '?format=physical')).body.report as EventReport;
    expect(physical.population.registered).toBe(2);
    expect(physical.participation!.attended).toMatchObject({ count: 1, of: 2, percent: 50 });
    expect(physical.participation!.stages[0]).toMatchObject({
      invited: 2,
      submitted: 1,
      responseRate: 50,
    });
    expect(physical.transfer!.plans.started).toMatchObject({ count: 1, of: 2 });
    const acme = (await report('dashboard', '?organisation=acme')).body.report as EventReport;
    expect(acme.population.registered).toBe(2);
    expect(acme.population.description).toMatch(/nominated by acme/);
    const later = (await report('follow_up', '?from=2027-02-01')).body.report as EventReport;
    expect(later.sections).toEqual(['participation', 'transfer', 'results']);
    expect(later.results!.measures.outcomes.improved).toBe(0);
    expect(later.transfer!.application.followUp).toMatchObject({
      respondedNoProgress: 0,
      notResponded: 4,
    });
    expect(later.limitations.join(' ')).toMatch(/reporting period/);
    expect((await report('dashboard', '?from=not-a-date')).status).toBe(422);
  });

  it('redacts external reports, requires approval before export, and audits every step', async () => {
    expect((await report('organisation')).status).toBe(422);
    const orgs = await call('get', `/events/${eventId}/reports/organisations`);
    expect(orgs.body.organisations).toEqual([
      { name: 'Acme', nominees: 2 },
      { name: 'Globex', nominees: 1 },
    ]);
    const org = await report('organisation', '?organisation=Acme');
    expect(org.status, org.text).toBe(200);
    const o = org.body.report as EventReport;
    expect(o).toMatchObject({
      kind: 'organisation',
      audience: 'external',
      population: { registered: 2 },
    });
    expect(o.approval).toMatchObject({ required: true, current: null, covers: false });
    expect(o.sections).toEqual(['participation', 'experience', 'transfer', 'results']);
    expect(o.transfer!.plans.started).toMatchObject({ count: 2, of: 2 });
    expect(o.transfer!.actions.priority).toEqual([]);
    expect(o.transfer!.actions.priorityState).toBe('withheld');
    expect(o.results!.measures.rowsState).toBe('withheld');
    expect(o.results!.evidence.examplesState).toBe('withheld');
    expect(o.experience!.written[0]).toMatchObject({
      responses: 1,
      state: 'withheld',
      answers: [],
    });
    expect(o.limitations.join(' ')).toMatch(/aggregates of so few people/i);
    const text = JSON.stringify(o);
    expect(text).not.toContain('Dee Legate');
    expect(text).not.toContain('Manager confirmed');
    expect(text).not.toContain('How to measure transfer');
    const sponsor = (await report('sponsor')).body.report as EventReport;
    expect(sponsor.population.registered).toBe(4);
    expect(JSON.stringify(sponsor)).not.toContain('Dee Legate');

    // Exports: internal kinds download at once; external ones wait for approval.
    const md = await call('get', `/events/${eventId}/reports/conference/export.md`);
    expect(md.status, md.text).toBe(200);
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.text).toContain(`# Report ${tag}: Immediate conference report`);
    expect(md.text).toContain('Reporting date');
    expect(md.text).toContain('Dee Legate');
    const csv = await call('get', `/events/${eventId}/reports/follow_up/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Plans submitted,1,4,25');
    const refused = await call(
      'get',
      `/events/${eventId}/reports/organisation/export.md?organisation=Acme`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('approval_required');
    expect(
      (
        await call('post', `/events/${eventId}/reports/conference/approve`, {
          sections: ['participation'],
        })
      ).status,
    ).toBe(422);
    const approved = await call('post', `/events/${eventId}/reports/organisation/approve`, {
      organisation: 'Acme',
      sections: ['participation', 'transfer'],
      note: 'Agreed with Acme on 2026-12-01',
    });
    expect(approved.status, approved.text).toBe(201);
    expect(approved.body.approval).toMatchObject({
      sections: ['participation', 'transfer'],
      approvedBy: `admin-rep-${tag}@example.com`,
    });
    // Still refused for the default (wider) section set; allowed for the approved one.
    expect(
      (await call('get', `/events/${eventId}/reports/organisation/export.md?organisation=Acme`))
        .status,
    ).toBe(409);
    const ok = await call(
      'get',
      `/events/${eventId}/reports/organisation/export.md?organisation=Acme&sections=transfer,participation`,
    );
    expect(ok.status, ok.text).toBe(200);
    expect(ok.text).not.toContain('DRAFT');
    expect(ok.text).toContain('Approved for sharing');
    expect(ok.text).not.toContain('Dee Legate');
    const draft = (
      await report('organisation', '?organisation=Acme&sections=participation,transfer,results')
    ).body.report as EventReport;
    expect(draft.approval).toMatchObject({ covers: false });
    const revoked = await call('post', `/events/${eventId}/reports/organisation/revoke`, {
      organisation: 'Acme',
    });
    expect(revoked.body).toEqual({ revoked: 1 });
    expect(
      (
        await call(
          'get',
          `/events/${eventId}/reports/organisation/export.md?organisation=Acme&sections=participation`,
        )
      ).status,
    ).toBe(409);
    const actions = await prisma.auditLog.findMany({
      where: { eventId, action: { startsWith: 'report.' } },
      select: { action: true },
    });
    const counts = actions.reduce<Record<string, number>>(
      (acc, a) => ({ ...acc, [a.action]: (acc[a.action] ?? 0) + 1 }),
      {},
    );
    expect(counts).toMatchObject({
      'report.approved': 1,
      'report.approval_revoked': 1,
      'report.exported': 3,
    });
    expect(counts['report.viewed']).toBeGreaterThanOrEqual(3);
  });

  it('gives each delegate their own journey and nothing else', async () => {
    expect((await call('get', `/me/events/${eventId}/journey`)).status).toBe(403);
    expect(
      (await call('get', `/me/events/${randomUUID()}/journey`, undefined, cookies.dee)).status,
    ).toBe(404);
    const dee = await call('get', `/me/events/${eventId}/journey`, undefined, cookies.dee);
    expect(dee.status, dee.text).toBe(200);
    expect(dee.body.journey).toMatchObject({
      attendance: { status: 'attended' },
      reflections: { available: 0, submitted: 0 },
      plan: {
        status: 'submitted',
        actions: 2,
        priority: 'Brief stakeholders',
        applied: 1,
        measures: 2,
        withResult: 1,
        evidence: 1,
        reminder: 'weekly',
      },
      supportRequests: { state: 'not_collected' },
    });
    expect(dee.body.journey.attendance.dates.map((d: { status: string }) => d.status)).toEqual([
      'attended',
      'attended',
    ]);
    expect(
      dee.body.journey.assessments.map((a: { stage: string; state: string }) => [a.stage, a.state]),
    ).toEqual([
      ['pre_conference', 'submitted'],
      ['during_conference', 'not_configured'],
      ['end_of_conference', 'submitted'],
      ['follow_up', 'submitted'],
    ]);
    const ada = await call('get', `/me/events/${eventId}/journey`, undefined, cookies.ada);
    expect(ada.body.journey.attendance.status).toBe('partial');
    expect(ada.body.journey.plan).toMatchObject({
      status: 'draft',
      actions: 1,
      applied: 0,
      evidence: 0,
    });
  });

  it('answers in reasonable time for a realistic event', async () => {
    // 250 more registrations with plans, pre-conference and follow-up responses, inserted in bulk.
    const extra = Array.from({ length: 250 }, (_, i) => ({
      eventId,
      name: `Bulk ${i}`,
      email: `bulk-${i}-${tag}@example.com`,
      attendanceFormat: (i % 2 ? 'physical' : 'virtual') as 'physical' | 'virtual',
      registrationStatus: 'active' as const,
    }));
    await prisma.delegate.createMany({ data: extra });
    const bulk = await prisma.delegate.findMany({
      where: { eventId, email: { startsWith: 'bulk-' } },
      select: { id: true },
    });
    const preStage = await prisma.assessmentStageConfig.findUniqueOrThrow({
      where: { eventId_stage: { eventId, stage: 'pre_conference' } },
    });
    await prisma.assessmentResponse.createMany({
      data: bulk.map((d) => ({ stageConfigId: preStage.id, delegateId: d.id, submittedAt: now })),
    });
    const responses = await prisma.assessmentResponse.findMany({
      where: { stageConfigId: preStage.id, delegateId: { in: bulk.map((d) => d.id) } },
      select: { id: true },
    });
    await prisma.assessmentAnswer.createMany({
      data: responses.flatMap((r) => [
        { responseId: r.id, questionId: ids.k1!, value: 'a', correct: true, score: 1 },
        { responseId: r.id, questionId: ids.c1!, value: '3', score: 3 },
      ]),
    });
    await prisma.transferPlan.createMany({
      data: bulk.map((d) => ({
        eventId,
        delegateId: d.id,
        status: 'submitted' as const,
        submittedAt: now,
      })),
    });
    const plans = await prisma.transferPlan.findMany({
      where: { eventId, delegateId: { in: bulk.map((d) => d.id) } },
      select: { id: true },
    });
    await prisma.transferPlanAction.createMany({
      data: plans.flatMap((p) => [
        {
          planId: p.id,
          order: 1,
          isPriority: true,
          action: 'Do the thing',
          progressStatus: 'applied' as const,
        },
        { planId: p.id, order: 2, action: 'Another' },
      ]),
    });
    await prisma.attendanceRecord.createMany({
      data: bulk.map((d) => ({
        eventId,
        delegateId: d.id,
        eventDateId: ids.day1!,
        status: 'attended' as const,
        mode: 'physical' as const,
        method: 'bulk' as const,
        recordedByUserId: adminId,
      })),
    });

    const started = Date.now();
    const r = await report('dashboard');
    const elapsed = Date.now() - started;
    expect(r.status, r.text).toBe(200);
    const d = r.body.report as EventReport;
    expect(d.population.registered).toBe(254);
    expect(d.participation!.attended).toMatchObject({ count: 252, of: 254 });
    expect(d.participation!.stages[0]).toMatchObject({ invited: 254, submitted: 252 });
    expect(d.transfer!.plans.submitted).toMatchObject({ count: 251, of: 254 });
    expect(d.transfer!.application.appliedActions).toMatchObject({ count: 251, of: 503 });
    expect(elapsed, `dashboard took ${elapsed} ms`).toBeLessThan(15_000);
    await prisma.delegate.deleteMany({ where: { id: { in: bulk.map((d) => d.id) } } });
  });
});
