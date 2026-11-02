import { randomUUID } from 'node:crypto';

import ExcelJS from 'exceljs';
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

/**
 * Formatting a table the browser already has as a spreadsheet (task of 2026-11-02). Used by the
 * two admin screens that build their rows client-side. It is admin-only and reads nothing, so what
 * matters is the guard, the size limits and that the file really is a workbook.
 */
describe.skipIf(!hasDatabase)('workbook export (POST /exports/workbook)', () => {
  let prisma: PrismaClient;
  const accountIds: string[] = [];
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

  async function sessionFor(role: 'admin' | 'delegate') {
    const account = await prisma.userAccount.create({
      data: { email: `${role}-wb-${tag}@example.com`, role },
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

  const post = (body: unknown, cookie = cookies.admin) =>
    request(app())
      .post('/api/v1/exports/workbook')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body as object)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    prisma = testPrisma();
    await sessionFor('admin');
    await sessionFor('delegate');
  });
  afterAll(async () => {
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  const body = {
    filename: 'ittec-2026-transfer-plans',
    title: 'ITTEC 2026: transfer plans',
    sheets: [
      {
        name: 'Transfer plans',
        header: ['Delegate', 'Actions', 'Applied'],
        rows: [
          ['Ada Admin', 3, 1],
          ['Bo Delegate', 2, 0],
        ],
      },
    ],
  };

  it('returns a workbook with the posted rows, keeping numbers as numbers', async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain(
      'filename="ittec-2026-transfer-plans.xlsx"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Transfer plans')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Delegate', 'Actions', 'Applied']);
    expect(sheet.getRow(2).getCell(1).value).toBe('Ada Admin');
    expect(sheet.getRow(2).getCell(2).value).toBe(3);
    expect(sheet.rowCount).toBe(3);
  });

  it('is admin-only and needs a session', async () => {
    expect((await post(body, '')).status).toBe(401);
    expect((await post(body, cookies.delegate)).status).toBe(403);
  });

  it('refuses a filename that tries to escape its own name', async () => {
    const res = await post({ ...body, filename: '../../etc/passwd' });
    expect(res.status).toBe(200);
    // The name is reduced to one safe segment: no slashes, no dot-dot.
    expect(res.headers['content-disposition']).toBe('attachment; filename="etc-passwd.xlsx"');
  });

  it('refuses a request with no sheet, too many sheets or too many rows', async () => {
    expect((await post({ ...body, sheets: [] })).status).toBe(422);
    expect(
      (await post({ ...body, sheets: Array.from({ length: 6 }, () => body.sheets[0]) })).status,
    ).toBe(422);
    const huge = {
      ...body,
      sheets: [{ name: 'Big', rows: Array.from({ length: 20_001 }, () => ['x']) }],
    };
    expect((await post(huge)).status).toBe(422);
    expect((await post({ ...body, filename: '' })).status).toBe(422);
    // A cell has to be a value a spreadsheet can hold, not an object or an array.
    expect((await post({ ...body, sheets: [{ name: 'Bad', rows: [[{ a: 1 }]] }] })).status).toBe(
      422,
    );
  });
});
