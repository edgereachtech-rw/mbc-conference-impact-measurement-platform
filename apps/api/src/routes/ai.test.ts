import { randomUUID } from 'node:crypto';

import ExcelJS from 'exceljs';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AiClient, AiRequest } from '../ai/client.js';
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

/** The writing assistant in the admin console (2026-11-25), against a fake model. */
describe.skipIf(!hasDatabase)('writing assistant', () => {
  let prisma: PrismaClient;
  const accountIds: string[] = [];
  const identityIds: string[] = [];
  let eventId = '';
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const now = new Date('2026-11-07T10:00:00.000Z');
  const sent: AiRequest[] = [];
  let reply = '';
  const fake: AiClient = {
    model: 'fake-model',
    complete: async (r) => {
      sent.push(r);
      return reply;
    },
  };
  let aiOn = true;

  const app = () =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      now: () => now,
      ai: () => (aiOn ? fake : null),
    });
  const call = (
    method: 'post' | 'put' | 'get',
    path: string,
    body?: object,
    cookie = cookies.admin,
  ) =>
    request(app())
      [method](`/api/v1${path}`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);

  async function session(role: 'admin' | 'delegate', email: string) {
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
    return { account, cookie: `mbc_session=${token}` };
  }

  beforeAll(async () => {
    prisma = testPrisma();
    cookies.admin = (await session('admin', `admin-ai-${tag}@example.com`)).cookie;
    const created = await call('post', '/events', {
      name: `AI Event ${tag}`,
      description: 'd',
      eventType: 'conference',
      organiser: 'M.Bryan',
      format: 'virtual',
      timezone: 'Africa/Lagos',
      dates: ['2026-11-12'],
    });
    eventId = created.body.event.id;
    const delegate = await session('delegate', `del-ai-${tag}@example.com`);
    const reg = await createRegisteredIdentity(prisma, eventId, `del-ai-${tag}@example.com`, {
      name: 'Private Person',
      userAccountId: delegate.account.id,
    });
    identityIds.push(reg.identity.id);
    cookies.delegate = delegate.cookie;
  });
  afterAll(async () => {
    if (eventId) await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    for (const id of identityIds) await deleteIdentity(prisma, id);
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('says whether it is on, to admins only', async () => {
    expect((await call('get', '/ai/status', undefined, cookies.delegate)).status).toBe(403);
    expect((await call('get', '/ai/status')).body).toEqual({ enabled: true });
    aiOn = false;
    expect((await call('get', '/ai/status')).body).toEqual({ enabled: false });
    const off = await call('post', '/ai/wording', { text: 'Hello there' });
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe('ai_not_configured');
    aiOn = true;
  });

  it('rewords an admin’s text, keeping an email address out of the request', async () => {
    reply = 'How confident are you? Write to [[KEEP1]].';
    expect(
      (await call('post', '/ai/wording', { text: 'how confident r u' }, cookies.delegate)).status,
    ).toBe(403);
    expect((await call('post', '/ai/wording', { text: ' ' })).status).toBe(422);
    expect((await call('post', '/ai/wording', { text: 'x'.repeat(7000) })).status).toBe(422);
    const res = await call('post', '/ai/wording', {
      text: 'how confident r u, write to help@example.com',
      mode: 'improve',
      field: 'Question',
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.suggestion).toBe('How confident are you? Write to help@example.com.');
    const last = sent.at(-1)!;
    expect(last.user).toContain('Question');
    expect(last.user).not.toContain('help@example.com');
  });

  it('summarises an assessment from its figures only, saves it, and prints it in the exports', async () => {
    const stageUrl = `/events/${eventId}/assessments/pre_conference`;
    const question = await call('post', `${stageUrl}/questions`, {
      prompt: 'How did you hear about the event?',
      type: 'single_choice',
      options: [
        { value: 'web', label: 'Website' },
        { value: 'friend', label: 'A colleague' },
      ],
    });
    expect(question.status, question.text).toBe(201);
    const opened = await call('put', stageUrl, {
      enabled: true,
      status: 'open',
      opensAt: '2026-11-06T09:00:00+01:00',
      closesAt: '2026-11-11T23:59:00+01:00',
    });
    expect(opened.status, opened.text).toBe(200);
    const published = await call('post', `/events/${eventId}/status`, { status: 'active' });
    expect(published.status, published.text).toBe(200);

    // Nothing submitted yet: nothing to summarise.
    expect((await call('get', `${stageUrl}/ai-summary`)).body).toEqual({
      enabled: true,
      summary: null,
    });
    expect((await call('post', `${stageUrl}/ai-summary`)).status).toBe(409);

    const me = `/me/events/${eventId}/assessments`;
    const mine = await call('get', me, undefined, cookies.delegate);
    const stage = mine.body.assessments.find(
      (a: { stage: string }) => a.stage === 'pre_conference',
    );
    const submitted = await call(
      'put',
      `${me}/pre_conference`,
      { answers: { [stage.questions[0].id]: 'web' }, submit: true },
      cookies.delegate,
    );
    expect(submitted.status, submitted.text).toBe(200);

    reply = JSON.stringify({
      overview: 'One delegate has replied so far.',
      findings: ['They heard about the event on the website.'],
    });
    expect((await call('post', `${stageUrl}/ai-summary`, {}, cookies.delegate)).status).toBe(403);
    const written = await call('post', `${stageUrl}/ai-summary`);
    expect(written.status, written.text).toBe(200);
    expect(written.body.summary).toMatchObject({
      overview: 'One delegate has replied so far.',
      findings: ['They heard about the event on the website.'],
      basedOn: 1,
      batchId: null,
      generatedAt: now.toISOString(),
    });
    // What left the platform: figures and the admins' wording, never the delegate.
    const payload = sent.at(-1)!.user;
    expect(payload).toContain('How did you hear about the event?');
    expect(payload).toContain('"count":1');
    expect(payload).not.toContain('Private Person');
    expect(payload).not.toContain(`del-ai-${tag}`);
    expect((await call('get', `${stageUrl}/ai-summary`)).body.summary.overview).toBe(
      'One delegate has replied so far.',
    );
    expect(
      await prisma.auditLog.count({ where: { eventId, action: 'assessment.ai_summary_written' } }),
    ).toBe(1);
    // Writing again replaces it.
    reply = JSON.stringify({ overview: 'Updated.', findings: [] });
    expect((await call('post', `${stageUrl}/ai-summary`)).body.summary.overview).toBe('Updated.');
    expect(await prisma.aiSummary.count({ where: { eventId } })).toBe(1);

    // The spreadsheet has a Summary sheet; the documents still build.
    const download = (path: string) =>
      request(app())
        .get(`/api/v1${path}`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookies.admin ?? '')
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const sheet = await download(`${stageUrl}/responses.xlsx`);
    expect(sheet.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sheet.body as unknown as ArrayBuffer);
    const summarySheet = workbook.getWorksheet('Summary')!;
    expect(summarySheet.getRow(1).getCell(1).value).toMatch(/written by AI/);
    expect(summarySheet.getRow(2).getCell(1).value).toBe('Updated.');
    const pdf = await download(`${stageUrl}/responses.pdf`);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});
