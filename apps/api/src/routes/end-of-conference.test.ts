import { randomUUID } from 'node:crypto';

import { PREFER_NOT_TO_ANSWER } from '@mbc/shared';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import {
  ITTEC_END_OF_CONFERENCE,
  ITTEC_PRE_CONFERENCE,
  loadTemplateInto,
} from '../assessments/templates.js';
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

interface Q {
  id: string;
  prompt: string;
  sectionId: string | null;
  builtin: string | null;
  sourceQuestionKey: string | null;
  required: boolean;
}
interface S {
  id: string;
  title: string;
  audience: string;
  sourceSectionId: string | null;
  sourceLabel: string | null;
}

describe.skipIf(!hasDatabase)('end-of-conference evaluation', () => {
  let prisma: PrismaClient;
  let eventId = '';
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  let now = new Date('2026-11-05T10:00:00.000Z');
  const pre = () => `/events/${eventId}/assessments/pre_conference`;
  const eoc = () => `/events/${eventId}/assessments/end_of_conference`;
  const ids: Record<string, string> = {};
  let learnKey = '';

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
  const myStage = async (cookie: string | undefined, stage: string) => {
    const r = await call('get', `/me/events/${eventId}/assessments`, undefined, cookie);
    expect(r.status, r.text).toBe(200);
    return r.body.assessments.find((a: { stage: string }) => a.stage === stage) as {
      sections: S[];
      questions: Q[];
      context: { references: Array<{ key: string; answer: string | null }>; planStatus: string };
      response: { submittedAt: string | null } | null;
    };
  };
  const byBuiltin = (qs: Q[], builtin: string) => qs.find((q) => q.builtin === builtin);
  const bySource = (qs: Q[], sourceId: string) =>
    qs.find((q) => q.sourceQuestionKey === ids[`key:${sourceId}`]);

  beforeAll(async () => {
    prisma = testPrisma();
    await signedIn('admin', 'admin', `admin-eoc-${tag}@example.com`);
    const dee = await signedIn('dee', 'delegate', `dee-eoc-${tag}@example.com`);
    const ada = await signedIn('ada', 'delegate', `ada-eoc-${tag}@example.com`);
    const created = await call('post', '/events', {
      name: `EOC ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12', '2026-11-13'],
    });
    expect(created.status, created.text).toBe(201);
    eventId = created.body.event.id;
    expect(created.body.event.assessmentStages.map((s: { stage: string }) => s.stage)).toEqual([
      'pre_conference',
      'during_conference',
      'end_of_conference',
      'follow_up',
    ]);
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const a = await createRegisteredIdentity(prisma, eventId, `dee-eoc-${tag}@example.com`, {
      name: 'Dee Legate',
      userAccountId: dee.id,
      attendanceFormat: 'physical',
    });
    const b = await createRegisteredIdentity(prisma, eventId, `ada-eoc-${tag}@example.com`, {
      name: 'Ada Other',
      userAccountId: ada.id,
      attendanceFormat: 'virtual',
    });
    identityIds.push(a.identity.id, b.identity.id);
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('builds the pre-conference stage and collects two delegates’ baselines', async () => {
    const knowledge = await call('post', `${pre()}/sections`, {
      title: 'Baseline knowledge',
      marking: 'knowledge',
    });
    expect(knowledge.status, knowledge.text).toBe(201);
    expect(knowledge.body.section).toMatchObject({ audience: 'all', sourceSectionId: null });
    ids.knowledgeSection = knowledge.body.section.id;
    const confidence = await call('post', `${pre()}/sections`, {
      title: 'Baseline confidence',
      marking: 'scored',
    });
    ids.confidenceSection = confidence.body.section.id;
    const expectations = await call('post', `${pre()}/sections`, { title: 'Expectations' });
    ids.expectationsSection = expectations.body.section.id;
    const k = async (prompt: string, correct: string) => {
      const r = await call('post', `${pre()}/questions`, {
        prompt,
        type: 'single_choice',
        sectionId: ids.knowledgeSection,
        options: [
          { value: 'a', label: 'A', correct: correct === 'a' },
          { value: 'b', label: 'B', correct: correct === 'b' },
          { value: 'e', label: 'I am not sure' },
        ],
      });
      expect(r.status, r.text).toBe(201);
      ids[`key:${r.body.question.id}`] = r.body.question.questionKey;
      return r.body.question.id as string;
    };
    const c = async (prompt: string) => {
      const r = await call('post', `${pre()}/questions`, {
        prompt,
        type: 'single_choice',
        sectionId: ids.confidenceSection,
        options: [
          { value: '1', label: 'Low', score: 1 },
          { value: '2', label: 'Medium', score: 2 },
          { value: '3', label: 'High', score: 3 },
          { value: 'na', label: 'Not applicable', score: null },
        ],
      });
      expect(r.status, r.text).toBe(201);
      ids[`key:${r.body.question.id}`] = r.body.question.questionKey;
      return r.body.question.id as string;
    };
    ids.k1 = await k('What comes first?', 'b');
    ids.k2 = await k('What comes next?', 'a');
    ids.c1 = await c('Identify a measure');
    ids.c2 = await c('Plan the application');
    const learn = await call('post', `${pre()}/questions`, {
      prompt: 'What would you like to learn or gain from the conference?',
      type: 'long_text',
      required: false,
      sectionId: ids.expectationsSection,
    });
    ids.learn = learn.body.question.id;
    learnKey = learn.body.question.questionKey;
    const refs = await call('put', `/events/${eventId}/reference-questions`, {
      questionKeys: [learn.body.question.questionKey],
    });
    expect(refs.status, refs.text).toBe(200);
    const opened = await call('put', pre(), { enabled: true, status: 'open' });
    expect(opened.status, opened.text).toBe(200);

    const deePre = await call(
      'put',
      `/me/events/${eventId}/assessments/pre_conference`,
      {
        answers: {
          [ids.k1!]: 'b',
          [ids.k2!]: 'b',
          [ids.c1!]: '1',
          [ids.c2!]: '2',
          [ids.learn!]: 'How to measure transfer',
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
        answers: { [ids.k1!]: 'b', [ids.k2!]: 'a', [ids.c1!]: '3', [ids.c2!]: 'na' },
        submit: true,
      },
      cookies.ada,
    );
    expect(adaPre.status, adaPre.text).toBe(200);
  });

  it('repeats sections for pairing, adds the built-in blocks and sections per audience, and locks repeated wording', async () => {
    const mirrored = await call('post', `${eoc()}/sections/mirror`, {
      sourceSectionId: ids.knowledgeSection,
      title: 'Knowledge check',
    });
    expect(mirrored.status, mirrored.text).toBe(201);
    expect(mirrored.body.section).toMatchObject({
      title: 'Knowledge check',
      marking: 'knowledge',
      sourceSectionId: ids.knowledgeSection,
      sourceLabel: 'pre-conference · Baseline knowledge',
    });
    ids.eocKnowledge = mirrored.body.section.id;
    const again = await call('post', `${eoc()}/sections/mirror`, {
      sourceSectionId: ids.knowledgeSection,
    });
    expect(again.status).toBe(409);
    const ownStage = await call('post', `${pre()}/sections/mirror`, {
      sourceSectionId: ids.knowledgeSection,
    });
    expect(ownStage.status).toBe(422);
    const conf = await call('post', `${eoc()}/sections/mirror`, {
      sourceSectionId: ids.confidenceSection,
    });
    expect(conf.status, conf.text).toBe(201);
    ids.eocConfidence = conf.body.section.id;
    const repeated = (conf.body.questions as Q[]).filter((q) => q.sectionId === ids.eocKnowledge);
    expect(repeated).toHaveLength(2);
    expect(repeated.map((q) => q.sourceQuestionKey)).toEqual([
      ids[`key:${ids.k1}`],
      ids[`key:${ids.k2}`],
    ]);
    // Wording is locked; whether it is required is not.
    const reword = await call('patch', `${eoc()}/questions/${repeated[0]!.id}`, {
      prompt: 'Something else',
    });
    expect(reword.status).toBe(409);
    expect(reword.body.error.code).toBe('locked_question');
    const relax = await call('patch', `${eoc()}/questions/${repeated[0]!.id}`, { required: false });
    expect(relax.status, relax.text).toBe(200);
    await call('patch', `${eoc()}/questions/${repeated[0]!.id}`, { required: true });

    const block = await call('post', `${eoc()}/sections/builtin`, { kind: 'expectations' });
    expect(block.status, block.text).toBe(201);
    expect(
      (block.body.questions as Q[])
        .filter((q) => q.sectionId === block.body.section.id)
        .map((q) => q.builtin),
    ).toEqual([
      'expectation_met_pre',
      'expectation_explain',
      'expectation_recorded_after',
      'expectation_met_post',
    ]);
    expect((await call('post', `${eoc()}/sections/builtin`, { kind: 'expectations' })).status).toBe(
      409,
    );
    const readiness = await call('post', `${eoc()}/sections/builtin`, { kind: 'readiness' });
    expect(readiness.status, readiness.text).toBe(201);

    const physical = await call('post', `${eoc()}/sections`, {
      title: 'In person',
      marking: 'scored',
      audience: 'physical',
    });
    ids.physicalSection = physical.body.section.id;
    const virtual = await call('post', `${eoc()}/sections`, {
      title: 'Online',
      marking: 'scored',
      audience: 'virtual',
    });
    ids.virtualSection = virtual.body.section.id;
    for (const [key, sectionId, prompt] of [
      ['pq', ids.physicalSection, 'Venue and facilities.'],
      ['vq', ids.virtualSection, 'Audio and visual quality.'],
    ] as const) {
      const r = await call('post', `${eoc()}/questions`, {
        prompt,
        type: 'single_choice',
        sectionId,
        options: [
          { value: 'excellent', label: 'Excellent', score: 4 },
          { value: 'poor', label: 'Poor', score: 1 },
          { value: 'na', label: 'Not applicable', score: null },
        ],
      });
      expect(r.status, r.text).toBe(201);
      ids[key] = r.body.question.id;
    }
    const opened = await call('put', eoc(), { enabled: true, status: 'open' });
    expect(opened.status, opened.text).toBe(200);
  });

  it('shows each delegate only their audience’s sections and their branch of the expectations block', async () => {
    await tick('2026-11-09T10:00:00.000Z');
    const dee = await myStage(cookies.dee, 'end_of_conference');
    expect(dee.sections.map((s) => s.title)).toEqual([
      'Knowledge check',
      'Baseline confidence',
      'Your expectations',
      'Readiness to apply',
      'In person',
    ]);
    expect(dee.questions.map((q) => q.builtin).filter(Boolean)).toEqual([
      'expectation_met_pre',
      'expectation_explain',
      'readiness',
      'plan_status',
      'readiness_support',
    ]);
    expect(dee.context.references[0]).toMatchObject({
      questionKey: learnKey,
      answer: 'How to measure transfer',
    });
    expect(dee.context.planStatus).toBe('no');
    // A started plan is reported as started (prefilled on the readiness block).
    await call(
      'put',
      `/me/events/${eventId}/transfer-plan`,
      { version: 1, actions: [{ action: 'Define measures first', isPriority: true }] },
      cookies.dee,
    );
    expect((await myStage(cookies.dee, 'end_of_conference')).context.planStatus).toBe('started');

    const ada = await myStage(cookies.ada, 'end_of_conference');
    expect(ada.sections.map((s) => s.title)).toContain('Online');
    expect(ada.sections.map((s) => s.title)).not.toContain('In person');
    expect(ada.questions.map((q) => q.builtin).filter(Boolean)).toEqual([
      'expectation_recorded_after',
      'expectation_met_post',
      'readiness',
      'plan_status',
      'readiness_support',
    ]);
    expect(ada.context.references[0]?.answer).toBeNull();
  });

  it('validates each branch and audience on submission and pairs the repeated answers per delegate', async () => {
    const dee = await myStage(cookies.dee, 'end_of_conference');
    const deeAnswers = {
      [bySource(dee.questions, ids.k1!)!.id]: 'b',
      [bySource(dee.questions, ids.k2!)!.id]: 'a',
      [bySource(dee.questions, ids.c1!)!.id]: '2',
      [bySource(dee.questions, ids.c2!)!.id]: '3',
      [byBuiltin(dee.questions, 'expectation_met_pre')!.id]: 'partly',
      [byBuiltin(dee.questions, 'readiness')!.id]: 'ready_now',
      [byBuiltin(dee.questions, 'plan_status')!.id]: 'started',
      [ids.pq!]: 'excellent',
    };
    // A question of the other audience is not part of this delegate's evaluation.
    const wrongAudience = await call(
      'put',
      `/me/events/${eventId}/assessments/end_of_conference`,
      { answers: { ...deeAnswers, [ids.vq!]: 'poor' } },
      cookies.dee,
    );
    expect(wrongAudience.status).toBe(422);
    expect(wrongAudience.body.problems[ids.vq!]).toMatch(/no longer part/);
    const deeDone = await call(
      'put',
      `/me/events/${eventId}/assessments/end_of_conference`,
      { answers: deeAnswers, submit: true },
      cookies.dee,
    );
    expect(deeDone.status, deeDone.text).toBe(200);
    expect((await myStage(cookies.dee, 'end_of_conference')).response?.submittedAt).toBeTruthy();

    const ada = await myStage(cookies.ada, 'end_of_conference');
    const recordedAfter = byBuiltin(ada.questions, 'expectation_recorded_after')!;
    const metPost = byBuiltin(ada.questions, 'expectation_met_post')!;
    const adaBase = {
      [bySource(ada.questions, ids.k1!)!.id]: 'b',
      [bySource(ada.questions, ids.k2!)!.id]: 'a',
      [bySource(ada.questions, ids.c1!)!.id]: '2',
      [bySource(ada.questions, ids.c2!)!.id]: '2',
      [byBuiltin(ada.questions, 'readiness')!.id]: 'ready_with_support',
      [byBuiltin(ada.questions, 'plan_status')!.id]: 'no',
      [ids.vq!]: 'poor',
    };
    // An expectation recorded now must say whether it was met...
    const missing = await call(
      'put',
      `/me/events/${eventId}/assessments/end_of_conference`,
      { answers: { ...adaBase, [recordedAfter.id]: 'Practical tools' }, submit: true },
      cookies.ada,
    );
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.problems)).toEqual([metPost.id]);
    // ...unless the delegate prefers not to record one.
    const declined = await call(
      'put',
      `/me/events/${eventId}/assessments/end_of_conference`,
      { answers: { ...adaBase, [recordedAfter.id]: PREFER_NOT_TO_ANSWER }, submit: true },
      cookies.ada,
    );
    expect(declined.status, declined.text).toBe(200);

    const paired = await call('get', `${eoc()}/paired`);
    expect(paired.status, paired.text).toBe(200);
    expect((await call('get', `${eoc()}/paired`, undefined, cookies.dee)).status).toBe(403);
    const [knowledge, confidence] = paired.body.paired.sections as Array<{
      title: string;
      sourceTitle: string;
      knowledge: Record<string, number | null> | null;
      statements: Array<Record<string, number | string | null>>;
    }>;
    // Dee: 1 of 2 before, 2 of 2 after. Ada: 2 of 2 both times. Average 75% to 100%.
    expect(knowledge).toMatchObject({
      title: 'Knowledge check',
      sourceTitle: 'Baseline knowledge',
      knowledge: {
        questions: 2,
        paired: 2,
        averageBeforePercent: 75,
        averageAfterPercent: 100,
        changePoints: 25,
      },
      statements: [],
    });
    // Statement 1: Dee 1 to 2, Ada 3 to 2. Statement 2: Ada's "Not applicable" leaves Dee alone.
    expect(confidence!.statements).toEqual([
      expect.objectContaining({ paired: 2, averageBefore: 2, averageAfter: 2, change: 0 }),
      expect.objectContaining({ paired: 1, averageBefore: 2, averageAfter: 3, change: 1 }),
    ]);

    const summary = await call('get', `${eoc()}/summary`);
    expect(summary.status, summary.text).toBe(200);
    const metPre = summary.body.summary.distributions.find(
      (d: { builtin: string | null }) => d.builtin === 'expectation_met_pre',
    );
    expect(metPre).toMatchObject({ responses: 1, sectionTitle: 'Your expectations' });
    expect(metPre.options.find((o: { value: string }) => o.value === 'partly')).toMatchObject({
      count: 1,
      percent: 100,
    });
    const venue = summary.body.summary.distributions.find(
      (d: { questionId: string }) => d.questionId === ids.pq,
    );
    expect(venue.options.map((o: { count: number }) => o.count)).toEqual([1, 0, 0]);
  });

  it('seeds the ITTEC end-of-conference content on top of the pre-conference content', async () => {
    const created = await call('post', '/events', {
      name: `EOC seed ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'hybrid',
      location: 'Lagos',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12'],
    });
    expect(created.status, created.text).toBe(201);
    const seedEventId = created.body.event.id as string;
    try {
      const preStage = await prisma.assessmentStageConfig.findUniqueOrThrow({
        where: { eventId_stage: { eventId: seedEventId, stage: 'pre_conference' } },
      });
      const finalStage = await prisma.assessmentStageConfig.findUniqueOrThrow({
        where: { eventId_stage: { eventId: seedEventId, stage: 'end_of_conference' } },
      });
      await prisma.$transaction((tx) => loadTemplateInto(tx, preStage, ITTEC_PRE_CONFERENCE));
      const loaded = await prisma.$transaction((tx) =>
        loadTemplateInto(tx, finalStage, ITTEC_END_OF_CONFERENCE),
      );
      expect(loaded.sections).toBe(ITTEC_END_OF_CONFERENCE.sections.length);
      const lists = await call(
        'get',
        `/events/${seedEventId}/assessments/end_of_conference/questions`,
      );
      const sections = lists.body.sections as S[];
      expect(sections.filter((s) => s.sourceSectionId).map((s) => s.title)).toEqual([
        'Knowledge assessment',
        'Confidence assessment',
      ]);
      expect(sections.find((s) => s.title === 'Your experience online')?.audience).toBe('virtual');
      expect(sections.find((s) => s.title === 'Your experience in person')?.audience).toBe(
        'physical',
      );
      const questions = lists.body.questions as Q[];
      expect(questions.filter((q) => q.builtin)).toHaveLength(7);
      expect(questions.filter((q) => q.sourceQuestionKey)).toHaveLength(12);
      expect(loaded.questions).toBe(questions.length);
    } finally {
      await prisma.event.delete({ where: { id: seedEventId } }).catch(() => undefined);
    }
  });
});
