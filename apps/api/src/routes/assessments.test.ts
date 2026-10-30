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

describe.skipIf(!hasDatabase)('assessment questions and answers', () => {
  let prisma: PrismaClient;
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  let eventId = '';
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

  beforeAll(async () => {
    prisma = testPrisma();
    const admin = await prisma.userAccount.create({
      data: { email: `admin-q-${tag}@example.com`, role: 'admin' },
    });
    accountIds.push(admin.id);
    const adminToken = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: admin.id,
        tokenHash: hashToken(adminToken),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    cookies.admin = `mbc_session=${adminToken}`;
    const created = await call('post', '/events', {
      name: `Q Event ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12'],
    });
    eventId = created.body.event.id;
    // A delegate registered for the event, signed in.
    const delegateAccount = await prisma.userAccount.create({
      data: { email: `del-q-${tag}@example.com`, role: 'delegate' },
    });
    accountIds.push(delegateAccount.id);
    const reg = await createRegisteredIdentity(prisma, eventId, `del-q-${tag}@example.com`, {
      name: 'Dee Legate',
      userAccountId: delegateAccount.id,
    });
    identityIds.push(reg.identity.id);
    const delegateToken = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: delegateAccount.id,
        tokenHash: hashToken(delegateToken),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    cookies.delegate = `mbc_session=${delegateToken}`;
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('lets admins build, validate, reorder and version questions, and blocks opening or publishing a stage without them', async () => {
    const base = `/events/${eventId}/assessments/pre_conference/questions`;
    expect((await call('get', base, undefined, cookies.delegate)).status).toBe(403);
    expect((await call('post', base, { prompt: 'x', type: 'single_choice' })).status).toBe(422); // needs options
    expect(
      (
        await call('post', base, {
          prompt: 'x',
          type: 'short_text',
          options: [{ value: 'a', label: 'A' }],
        })
      ).status,
    ).toBe(422);
    const q1 = await call('post', base, {
      prompt: 'How confident are you today?',
      type: 'rating',
      area: 'Current confidence level',
      scale: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very' },
    });
    expect(q1.status, q1.text).toBe(201);
    expect(q1.body.question).toMatchObject({
      version: 1,
      order: 1,
      required: true,
      responseCount: 0,
    });
    const q2 = await call('post', base, {
      prompt: 'What do you want to learn?',
      type: 'long_text',
      required: false,
    });
    const q3 = await call('post', base, {
      prompt: 'Which best describes your role?',
      type: 'single_choice',
      options: [
        { value: 'hr', label: 'HR' },
        { value: 'ld', label: 'L&D' },
      ],
    });
    expect(q3.body.question).toMatchObject({ isKnowledge: false });
    expect(q3.body.questions.map((q: { order: number }) => q.order)).toEqual([1, 2, 3]);
    // Option rules: one correct answer at most, no exclusive/other on single choice, no scores on multiple choice.
    const invalidOptions = [
      {
        type: 'single_choice',
        options: [
          { value: 'a', label: 'A', correct: true },
          { value: 'b', label: 'B', correct: true },
        ],
      },
      { type: 'single_choice', options: [{ value: 'a', label: 'A', exclusive: true }] },
      { type: 'multiple_choice', options: [{ value: 'a', label: 'A', score: 3 }] },
      {
        type: 'multiple_choice',
        options: [
          { value: 'a', label: 'A', other: true },
          { value: 'b', label: 'B', other: true },
        ],
      },
    ];
    for (const body of invalidOptions) {
      expect(
        (await call('post', base, { prompt: 'bad', ...body })).status,
        JSON.stringify(body),
      ).toBe(422);
    }

    // Reorder must list every question once.
    expect(
      (await call('put', `${base}/order`, { questionIds: [q3.body.question.id] })).status,
    ).toBe(422);
    const reordered = await call('put', `${base}/order`, {
      questionIds: [q3.body.question.id, q1.body.question.id, q2.body.question.id],
    });
    expect(reordered.body.questions.map((q: { prompt: string }) => q.prompt)).toEqual([
      'Which best describes your role?',
      'How confident are you today?',
      'What do you want to learn?',
    ]);

    // Edits before any answer change the row in place (same version).
    const edited = await call('patch', `${base}/${q2.body.question.id}`, {
      prompt: 'What do you most want to learn?',
    });
    expect(edited.body.question).toMatchObject({ id: q2.body.question.id, version: 1 });
    expect(
      (
        await call('patch', `${base}/${q3.body.question.id}`, {
          options: [{ value: 'x', label: 'X' }],
        })
      ).status,
    ).toBe(422);

    // The stage cannot be scheduled or opened without questions, and the publish checklist says so.
    const stageUrl = `/events/${eventId}/assessments/during_conference`;
    const noQ = await call('put', stageUrl, { enabled: true, status: 'open' });
    expect(noQ.status).toBe(422);
    expect(noQ.body.error.code).toBe('stage_without_questions');
    await call('put', stageUrl, { enabled: true, status: 'draft' });
    const publish = await call('post', `/events/${eventId}/status`, { status: 'active' });
    expect(publish.status).toBe(422);
    expect(publish.body.error.message).toMatch(
      /during-conference assessment is enabled but has no questions/,
    );
    await call('put', stageUrl, { enabled: false, status: 'draft' });
    const detail = await call('get', `/events/${eventId}`);
    expect(
      detail.body.event.assessmentStages.find(
        (s: { stage: string }) => s.stage === 'pre_conference',
      ).questionCount,
    ).toBe(3);
    expect(
      await prisma.auditLog.count({
        where: { eventId, action: { startsWith: 'assessment.question' } },
      }),
    ).toBeGreaterThanOrEqual(4);
  });

  it('groups questions into ordered sections for admins and delegates', async () => {
    const stageUrl = `/events/${eventId}/assessments/during_conference`;
    const q = `${stageUrl}/questions`;
    const sec = `${stageUrl}/sections`;
    expect((await call('post', sec, { title: '' })).status).toBe(422);
    const s1 = await call('post', sec, {
      title: 'About the sessions',
      description: 'Today',
      marking: 'scored',
    });
    expect(s1.status, s1.text).toBe(201);
    expect(s1.body.section.marking).toBe('scored');
    expect((await call('post', sec, { title: 'x', marking: 'weighted' })).status).toBe(422);
    const s2 = await call('post', sec, { title: 'About you' });
    expect(
      s2.body.sections.map((x: { title: string; order: number }) => [x.title, x.order]),
    ).toEqual([
      ['About the sessions', 1],
      ['About you', 2],
    ]);
    // Questions: one in the untitled group, one per section; a foreign section is refused.
    const general = await call('post', q, { prompt: 'General question', type: 'yes_no' });
    const inS2 = await call('post', q, {
      prompt: 'In section two',
      type: 'yes_no',
      sectionId: s2.body.section.id,
    });
    const inS1 = await call('post', q, {
      prompt: 'In section one',
      type: 'yes_no',
      sectionId: s1.body.section.id,
    });
    expect(inS1.status, inS1.text).toBe(201);
    expect(
      (await call('post', q, { prompt: 'x', type: 'yes_no', sectionId: randomUUID() })).status,
    ).toBe(422);
    const list = await call('get', q);
    expect(list.body.sections).toHaveLength(2);
    expect(list.body.questions.map((x: { prompt: string }) => x.prompt)).toEqual([
      'General question',
      'In section one',
      'In section two',
    ]);
    // Reordering sections reorders the questions under them.
    const reordered = await call('put', `${sec}/order`, {
      sectionIds: [s2.body.section.id, s1.body.section.id],
    });
    expect(reordered.body.questions.map((x: { prompt: string }) => x.prompt)).toEqual([
      'General question',
      'In section two',
      'In section one',
    ]);
    // Moving a question between sections, and renaming a section.
    const moved = await call('patch', `${q}/${general.body.question.id}`, {
      sectionId: s1.body.section.id,
    });
    expect(moved.body.question.sectionId).toBe(s1.body.section.id);
    const renamed = await call('patch', `${sec}/${s1.body.section.id}`, { title: 'About the day' });
    expect(
      renamed.body.sections.find((x: { id: string }) => x.id === s1.body.section.id).title,
    ).toBe('About the day');
    // Deleting a section keeps its questions in the untitled group.
    const deleted = await call('delete', `${sec}/${s2.body.section.id}`);
    expect(deleted.body.sections).toHaveLength(1);
    expect(
      deleted.body.questions.find((x: { id: string }) => x.id === inS2.body.question.id).sectionId,
    ).toBeNull();
    // Delegates get the sections with the open stage.
    await call('put', stageUrl, { enabled: true, status: 'open' });
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const mine = await call(
      'get',
      `/me/events/${eventId}/assessments`,
      undefined,
      cookies.delegate,
    );
    const during = (
      mine.body.assessments as Array<{
        stage: string;
        sections: Array<{ title: string }>;
        questions: Array<{ prompt: string; sectionId: string | null }>;
      }>
    ).find((a) => a.stage === 'during_conference')!;
    expect(during.sections.map((x) => x.title)).toEqual(['About the day']);
    expect(during.questions.map((x) => x.prompt)).toEqual([
      'In section two',
      'General question',
      'In section one',
    ]);
    await call('put', stageUrl, { enabled: false, status: 'draft' });
    expect(
      await prisma.auditLog.count({
        where: { eventId, action: { startsWith: 'assessment.section' } },
      }),
    ).toBe(5);
  });

  it('serves open stages to the delegate, validates answers, keeps drafts, submits once, and versions a question that was answered', async () => {
    const stageUrl = `/events/${eventId}/assessments/pre_conference`;
    const base = `${stageUrl}/questions`;
    // Not open yet: scheduled stage shows as upcoming without questions.
    await call('put', stageUrl, {
      enabled: true,
      status: 'scheduled',
      opensAt: '2026-11-06T09:00:00+01:00',
      closesAt: '2026-11-11T23:59:00+01:00',
    });
    await call('post', `/events/${eventId}/status`, { status: 'active' });
    const me = `/me/events/${eventId}/assessments`;
    expect((await call('get', me)).status).toBe(403); // admins do not answer
    const upcoming = await call('get', me, undefined, cookies.delegate);
    expect(upcoming.status, upcoming.text).toBe(200);
    expect(upcoming.body.assessments).toHaveLength(1);
    expect(upcoming.body.assessments[0]).toMatchObject({
      stage: 'pre_conference',
      status: 'upcoming',
      canAnswer: false,
      questions: [],
    });
    expect(
      (await call('put', `${me}/pre_conference`, { answers: {} }, cookies.delegate)).body.error
        .code,
    ).toBe('assessment_not_open');

    // Marking belongs to the section: a correct option outside a knowledge section is ignored
    // and never served.
    const plain = await call('post', base, {
      prompt: 'Unmarked',
      type: 'single_choice',
      options: [
        { value: 'a', label: 'A', correct: true, score: 3 },
        { value: 'b', label: 'B' },
      ],
    });
    expect(plain.status, plain.text).toBe(201);
    expect(plain.body.question.isKnowledge).toBe(false);
    expect(plain.body.question.options[0]).toEqual({ value: 'a', label: 'A' });
    await call('delete', base + '/' + plain.body.question.id);
    const kSec = await call('post', `${stageUrl}/sections`, {
      title: 'Baseline knowledge',
      marking: 'knowledge',
    });
    const sSec = await call('post', `${stageUrl}/sections`, {
      title: 'Current practices',
      marking: 'scored',
    });
    expect(kSec.status, kSec.text).toBe(201);
    expect(sSec.status, sSec.text).toBe(201);
    // A knowledge question (one correct option) and a "select all that apply" question with
    // exclusive and "Other" options.
    const quiz = await call('post', base, {
      prompt: 'What does Return on Expectations assess?',
      type: 'single_choice',
      area: 'Baseline knowledge',
      sectionId: kSec.body.section.id,
      options: [
        { value: 'a', label: 'Certificates issued' },
        { value: 'b', label: 'Whether stakeholder expectations were met', correct: true },
        { value: 'e', label: 'I am not sure' },
      ],
    });
    expect(quiz.status, quiz.text).toBe(201);
    expect(quiz.body.question.isKnowledge).toBe(true);
    const tools = await call('post', base, {
      prompt: 'Which do you use? Select all that apply.',
      type: 'multiple_choice',
      required: false,
      sectionId: kSec.body.section.id,
      options: [
        { value: 'plan', label: 'A transfer plan' },
        { value: 'baseline', label: 'Baseline data' },
        { value: 'none', label: 'None of the above', exclusive: true },
        { value: 'other', label: 'Other, please specify', other: true },
      ],
    });
    expect(tools.status, tools.text).toBe(201);
    const scored = await call('post', base, {
      prompt: 'I follow up after training.',
      type: 'single_choice',
      sectionId: sSec.body.section.id,
      options: [
        { value: 'always', label: 'Always', score: 5 },
        { value: 'never', label: 'Never', score: 1 },
        { value: 'na', label: 'Not applicable', score: null },
      ],
    });
    expect(scored.status, scored.text).toBe(201);
    expect(scored.body.question.isKnowledge).toBe(false);

    // Open, inside the window.
    await call('put', stageUrl, {
      enabled: true,
      status: 'open',
      opensAt: '2026-11-06T09:00:00+01:00',
      closesAt: '2026-11-11T23:59:00+01:00',
    });
    now = new Date('2026-11-07T10:00:00.000Z');
    const open = await call('get', me, undefined, cookies.delegate);
    const stage = open.body.assessments[0];
    expect(stage).toMatchObject({ status: 'open', canAnswer: true, response: null, feedback: {} });
    expect(stage.questions).toHaveLength(6);
    const [role, confidence, learn, quizQ, toolsQ, scoredQ] = stage.questions as Array<{
      id: string;
      type: string;
      isKnowledge: boolean;
      options: Array<Record<string, unknown>> | null;
    }>;
    // Delegates never see which option is correct, nor option scores.
    expect(quizQ!.isKnowledge).toBe(true);
    for (const q of [quizQ!, toolsQ!, scoredQ!]) {
      for (const o of q.options ?? []) {
        expect(o).not.toHaveProperty('correct');
        expect(o).not.toHaveProperty('score');
      }
    }

    // Multiple choice: exclusive options cannot be combined; "Other" needs its text.
    const combo = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [toolsQ!.id]: { selected: ['plan', 'none'], other: null } } },
      cookies.delegate,
    );
    expect(combo.status).toBe(422);
    expect(combo.body.problems[toolsQ!.id]).toMatch(/cannot be combined/);
    const noOther = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [toolsQ!.id]: { selected: ['plan', 'other'], other: '' } } },
      cookies.delegate,
    );
    expect(noOther.status).toBe(422);
    expect(noOther.body.problems[toolsQ!.id]).toMatch(/specify/);

    // A knowledge answer is scored at once, gets feedback, and is then locked.
    const wrong = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [quizQ!.id]: 'a' } },
      cookies.delegate,
    );
    expect(wrong.status, wrong.text).toBe(200);
    expect(wrong.body.assessments[0].feedback[quizQ!.id]).toEqual({
      correct: false,
      correctValue: 'b',
      correctLabel: 'Whether stakeholder expectations were met',
    });
    const retry = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [quizQ!.id]: 'b' } },
      cookies.delegate,
    );
    expect(retry.status).toBe(422);
    expect(retry.body.problems[quizQ!.id]).toMatch(/cannot be changed/);
    // Leaving it out of a later save keeps the locked answer.
    const keep = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [toolsQ!.id]: { selected: ['plan', 'other'], other: 'A coaching log' } } },
      cookies.delegate,
    );
    expect(keep.status, keep.text).toBe(200);
    expect(keep.body.assessments[0].response.answers[quizQ!.id]).toBe('a');
    expect(keep.body.assessments[0].feedback[quizQ!.id].correct).toBe(false);
    const storedQuiz = await prisma.assessmentAnswer.findFirstOrThrow({
      where: { questionId: quizQ!.id },
    });
    expect(storedQuiz).toMatchObject({ correct: false, score: 0 });

    // Admin summary counts started responses; nothing submitted yet.
    const early = await call('get', `${stageUrl}/summary`);
    expect(early.status, early.text).toBe(200);
    expect(early.body.summary).toMatchObject({
      stage: 'pre_conference',
      invited: 1,
      started: 1,
      submitted: 0,
      responseRate: 0,
      knowledge: { questions: 1, respondents: 0, averageScore: null },
    });

    // Invalid answers are reported per question; a draft saves what is valid.
    const bad = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [role!.id]: 'ceo', [confidence!.id]: 9 } },
      cookies.delegate,
    );
    expect(bad.status).toBe(422);
    expect(bad.body.problems[role!.id]).toMatch(/Choose one/);
    expect(bad.body.problems[confidence!.id]).toMatch(/from 1 to 5/);
    const draft = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [role!.id]: 'hr', [confidence!.id]: 4 } },
      cookies.delegate,
    );
    expect(draft.status, draft.text).toBe(200);
    expect(draft.body.assessments[0].response).toMatchObject({
      submittedAt: null,
      answers: { [role!.id]: 'hr', [confidence!.id]: 4 },
    });
    expect(draft.body.assessments[0].canAnswer).toBe(true);

    // Submitting requires every required question (the long answer is optional).
    const missing = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [confidence!.id]: 4 }, submit: true },
      cookies.delegate,
    );
    expect(missing.status).toBe(422);
    expect(missing.body.problems[role!.id]).toMatch(/needs an answer/);
    const submitted = await call(
      'put',
      `${me}/pre_conference`,
      {
        answers: {
          [role!.id]: 'ld',
          [confidence!.id]: 5,
          [learn!.id]: 'Transfer planning',
          [scoredQ!.id]: 'always',
          [toolsQ!.id]: { selected: ['plan', 'other'], other: 'A coaching log' },
        },
        submit: true,
      },
      cookies.delegate,
    );
    expect(submitted.status, submitted.text).toBe(200);
    const summary = await call('get', `${stageUrl}/summary`);
    expect(summary.body.summary).toMatchObject({
      invited: 1,
      started: 1,
      submitted: 1,
      responseRate: 100,
      knowledge: { questions: 1, respondents: 1, averageScore: 0, averagePercent: 0 },
    });
    expect(summary.body.summary.statements).toEqual([
      expect.objectContaining({ questionId: scoredQ!.id, responses: 1, average: 5 }),
    ]);
    const storedScored = await prisma.assessmentAnswer.findFirstOrThrow({
      where: { questionId: scoredQ!.id },
    });
    expect(storedScored).toMatchObject({ correct: null, score: 5 });
    expect(submitted.body.assessments[0]).toMatchObject({ canAnswer: false });
    expect(submitted.body.assessments[0].response.submittedAt).toBeTruthy();
    expect(
      (await call('put', `${me}/pre_conference`, { answers: {} }, cookies.delegate)).body.error
        .code,
    ).toBe('already_submitted');
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'assessment.submitted' } }),
    ).toBe(1);
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { eventId, action: 'assessment.submitted' },
    });
    expect(JSON.stringify(auditRow.newValue)).not.toContain('Transfer planning'); // no answer content in the audit

    // Editing an answered question creates version 2 and keeps the answer on version 1.
    const versioned = await call('patch', `${base}/${confidence!.id}`, {
      prompt: 'How confident do you feel today?',
    });
    expect(versioned.status, versioned.text).toBe(200);
    expect(versioned.body.question).toMatchObject({ version: 2, responseCount: 0 });
    expect(versioned.body.question.id).not.toBe(confidence!.id);
    expect(versioned.body.question.questionKey).toBe(
      (stage.questions as Array<{ id: string; questionKey: string }>).find(
        (q) => q.id === confidence!.id,
      )!.questionKey,
    );
    const old = await prisma.assessmentQuestion.findUniqueOrThrow({
      where: { id: confidence!.id },
    });
    expect(old.retiredAt).toBeTruthy();
    expect(await prisma.assessmentAnswer.count({ where: { questionId: confidence!.id } })).toBe(1);
    // Deleting an answered question retires it instead of removing it.
    const retired = await call('delete', `${base}/${role!.id}`);
    expect(retired.status).toBe(200);
    expect(await prisma.assessmentQuestion.count({ where: { id: role!.id } })).toBe(1);
    expect(retired.body.questions.map((q: { id: string }) => q.id)).not.toContain(role!.id);

    // After the deadline the stage reads as closed and keeps the submitted answers visible.
    now = new Date('2026-11-12T10:00:00.000Z');
    const closed = await call('get', me, undefined, cookies.delegate);
    expect(closed.body.assessments[0]).toMatchObject({ status: 'closed', canAnswer: false });
    expect(closed.body.assessments[0].response.answers[confidence!.id]).toBe(5);
  });

  it('opens a scheduled stage by itself at its opening time, lists non-completers for reminders, and exports submitted responses as CSV', async () => {
    const stageUrl = `/events/${eventId}/assessments/pre_conference`;
    const me = `/me/events/${eventId}/assessments`;
    // The delegate submitted the pre-conference stage in the previous test.
    const saved = await call('put', stageUrl, {
      enabled: true,
      status: 'scheduled',
      opensAt: '2026-11-14T09:00:00+01:00',
      closesAt: '2026-11-16T18:00:00+01:00',
    });
    expect(saved.status, saved.text).toBe(200);
    const stageOf = async () => {
      const res = await call('get', me, undefined, cookies.delegate);
      expect(res.status, res.text).toBe(200);
      return res.body.assessments[0] as { status: string; questions: unknown[] };
    };
    now = new Date('2026-11-13T12:00:00.000Z');
    expect((await stageOf()).status).toBe('upcoming');
    now = new Date('2026-11-15T12:00:00.000Z');
    const open = await stageOf();
    expect(open.status).toBe('open'); // nobody flipped the status; the window did it
    expect(open.questions.length).toBeGreaterThan(0);
    now = new Date('2026-11-17T12:00:00.000Z');
    expect((await stageOf()).status).toBe('closed');

    // Non-completers: every eligible registration without a submitted response.
    const other = await createRegisteredIdentity(prisma, eventId, `other-q-${tag}@example.com`, {
      name: 'Ada Other',
    });
    identityIds.push(other.identity.id);
    expect(
      (await call('get', `${stageUrl}/non-completers`, undefined, cookies.delegate)).status,
    ).toBe(403);
    const pending = await call('get', `${stageUrl}/non-completers`);
    expect(pending.status, pending.text).toBe(200);
    const names = (pending.body.delegates as Array<{ name: string }>).map((d) => d.name);
    expect(names).toContain('Ada Other');
    expect(names).not.toContain('Dee Legate');
    expect(
      pending.body.delegates.find((d: { name: string }) => d.name === 'Ada Other'),
    ).toMatchObject({ signedUp: false, started: false, organisation: null });

    // CSV export of submitted responses: labels, a "correct" column per knowledge question and
    // a total; audited without contents; admins only.
    expect(
      (await call('get', `${stageUrl}/responses.csv`, undefined, cookies.delegate)).status,
    ).toBe(403);
    const csv = await call('get', `${stageUrl}/responses.csv`);
    expect(csv.status, csv.text).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/pre_conference-responses-2026-11-17\.csv/);
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toMatch(
      /^Name,Email,Organisation,Job title,Country,Attendance format,Capacity,Submitted at \(UTC\),/,
    );
    // One knowledge question in the stage (the quiz of the earlier test), answered (a): wrong.
    const knowledgeColumns = lines[0]!.match(/\(correct\?\)/g)?.length ?? 0;
    expect(knowledgeColumns).toBe(1);
    expect(lines[0]).toContain('What does Return on Expectations assess? (correct?)');
    expect(lines[0]).toContain('Knowledge score (of 1)');
    // The confidence question was re-versioned after it was answered: the answer still shows
    // under its current wording (answers are matched by question key, not version id).
    expect(lines[0]).toContain('How confident do you feel today?');
    expect(lines).toHaveLength(2); // header + the one submitted response
    expect(lines[1]).toMatch(
      /^Dee Legate,[^,]+,,,,physical,individual,2026-11-07T10:00:00.000Z,5,/,
    );
    expect(lines[1]).toContain(',Always,'); // the option label, not the code "always"
    expect(lines[1]).toContain(',Certificates issued,'); // the quiz answer as its label
    expect(lines[1]).toContain('"A transfer plan; Other, please specify: A coaching log"');
    const tail = lines[1]!.split(',').slice(-(knowledgeColumns + 1));
    expect(tail).toEqual(['No', '0']);
    expect(await prisma.auditLog.count({ where: { eventId, action: 'assessment.exported' } })).toBe(
      1,
    );
  });
});
