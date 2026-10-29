import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, type AppOptions } from '../app.js';
import { authConfigFromEnv } from '../auth/config.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, testPrisma } from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('registration imports (E2-1, E2-8..11; D3, D5, D9)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  const eventIds: string[] = [];
  const accountIds: string[] = [];
  /** A throwaway event tracked for cleanup. */
  async function newEvent() {
    const event = await createTestEvent(prisma);
    eventIds.push(event.id);
    return event;
  }
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const email = (local: string) => `${local}-${tag}@example.com`;
  // The app clock starts at real time (sessions are checked against it) and is moved by one test.
  let clock = new Date();

  const app = (options: Partial<AppOptions> = {}) =>
    createApp({
      logger: silent,
      prisma: () => prisma,
      mailer: () => new MemoryMailer(),
      authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: ORIGIN }),
      allowedOrigins: [ORIGIN],
      importConfig: {
        uploadsEnabled: true,
        fileRetentionDays: null,
        production: false,
        requireMigrationGate: false,
      },
      now: () => clock,
      ...options,
    });

  async function signedIn(role: 'delegate' | 'admin' | 'analyst' | 'support' | 'speaker') {
    const account = await prisma.userAccount.create({ data: { email: email(role), role } });
    accountIds.push(account.id);
    const token = generateToken();
    await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    cookies[role] = `mbc_session=${token}`;
    return account;
  }

  const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');
  const HEADERS = ['Email', 'Full Name', 'Format', 'Company', 'Registration ID', 'Checked In'];
  const MAPPING = {
    email: 'Email',
    name: 'Full Name',
    attendanceFormat: 'Format',
    organisation: 'Company',
    externalRegistrationId: 'Registration ID',
  };

  async function upload(
    server: ReturnType<typeof app>,
    file: Buffer,
    name = 'reg.csv',
    target = eventId,
    source = 'eventbrite',
  ) {
    return request(server)
      .post(`/api/v1/events/${target}/imports`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .field('source', source)
      .attach('file', file, name);
  }
  async function preview(
    server: ReturnType<typeof app>,
    runId: string,
    body: object = { mapping: MAPPING },
  ) {
    return request(server)
      .post(`/api/v1/imports/${runId}/preview`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send(body);
  }
  async function confirm(server: ReturnType<typeof app>, runId: string) {
    return request(server)
      .post(`/api/v1/imports/${runId}/confirm`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '');
  }
  /** Upload, preview and confirm one file; returns run id and the three responses. */
  async function importFile(
    server: ReturnType<typeof app>,
    file: Buffer,
    body: object = { mapping: MAPPING },
    target = eventId,
  ) {
    const up = await upload(server, file, 'reg.csv', target);
    expect(up.status, up.text).toBe(201);
    const pv = await preview(server, up.body.run.id, body);
    expect(pv.status, pv.text).toBe(200);
    const cf = await confirm(server, up.body.run.id);
    expect(cf.status, cf.text).toBe(200);
    return { runId: up.body.run.id as string, up, pv, cf };
  }
  const auditCount = (action: string, entityId?: string) =>
    prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await newEvent()).id;
    for (const role of ['admin', 'delegate', 'analyst', 'support', 'speaker'] as const)
      await signedIn(role);
  });
  afterAll(async () => {
    // Identities created by the tests own registrations in test events; events cascade first.
    const runs = await prisma.importRun.findMany({
      where: { eventId: { in: eventIds } },
      select: { id: true },
    });
    const identityIds = (
      await prisma.importRow.findMany({
        where: { runId: { in: runs.map((r) => r.id) }, identityId: { not: null } },
        select: { identityId: true },
      })
    ).map((r) => r.identityId!);
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.identityEmail.deleteMany({
      where: {
        OR: [
          { identityId: { in: identityIds } },
          { emailNormalised: { endsWith: `${tag}@example.com` } },
        ],
      },
    });
    await prisma.delegateIdentity.deleteMany({
      where: {
        OR: [{ id: { in: identityIds } }, { delegates: { none: {} }, emails: { none: {} } }],
      },
    });
    await prisma.importSourceMapping.deleteMany({ where: { source: { startsWith: 'src-' } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('authorisation: only admins reach any import route (criterion 9)', async () => {
    const server = app();
    const runId = randomUUID();
    const routes: Array<[string, string]> = [
      ['post', `/api/v1/events/${eventId}/imports`],
      ['post', `/api/v1/imports/${runId}/preview`],
      ['post', `/api/v1/imports/${runId}/confirm`],
      ['post', `/api/v1/imports/${runId}/discard`],
      ['get', `/api/v1/events/${eventId}/imports`],
      ['get', `/api/v1/events/${eventId}/imports/conflicts`],
      ['get', `/api/v1/imports/${runId}`],
      ['get', `/api/v1/imports/${runId}/report.csv`],
      ['get', '/api/v1/imports/status'],
    ];
    for (const [method, path] of routes) {
      const anon = await (request(server) as never as Record<string, (p: string) => request.Test>)[
        method
      ]!(path).set('Origin', ORIGIN);
      expect(anon.status, `${method} ${path} anonymous`).toBe(401);
      for (const role of ['delegate', 'analyst', 'support', 'speaker'] as const) {
        const res = await (request(server) as never as Record<string, (p: string) => request.Test>)[
          method
        ]!(path)
          .set('Origin', ORIGIN)
          .set('Cookie', cookies[role] ?? '');
        expect(res.status, `${method} ${path} ${role}`).toBe(
          role === 'analyst' || role === 'support' ? 401 : 403, // retired roles hold no session (D8 item 7)
        );
      }
    }
    const status = await request(server)
      .get('/api/v1/imports/status')
      .set('Cookie', cookies.admin ?? '');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ uploadsEnabled: true, productionGateRequired: false });
  });

  it('upload refusals: type, size, row count, missing source, archived event (criterion 1)', async () => {
    const server = app();
    expect(
      (
        await upload(
          server,
          csv([
            ['a', 'b'],
            ['1', '2'],
          ]),
          'old.xls',
        )
      ).status,
    ).toBe(415);
    const big = await upload(server, Buffer.alloc(10 * 1024 * 1024 + 1, 0x61), 'big.csv');
    expect(big.status).toBe(413);
    expect(big.body.error.message).toMatch(/Split the export/);
    const rows = [HEADERS];
    for (let i = 0; i < 5001; i += 1)
      rows.push([email(`u${i}`), `User ${i}`, 'virtual', '', '', '']);
    const many = await upload(server, csv(rows), 'many.csv');
    expect(many.status).toBe(413);
    expect(many.body.error.code).toBe('too_many_rows');
    const noSource = await request(server)
      .post(`/api/v1/events/${eventId}/imports`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .attach('file', csv([HEADERS]), 'reg.csv');
    expect(noSource.status).toBe(422);
    const archived = await prisma.event.create({
      data: {
        slug: `test-event-arch-${tag}`,
        name: 'Archived',
        startsOn: new Date(),
        endsOn: new Date(),
        status: 'archived',
      },
    });
    const refused = await upload(
      server,
      csv([HEADERS, [email('x'), 'X', 'virtual', '', '', '']]),
      'reg.csv',
      archived.id,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('event_archived');
    await prisma.event.delete({ where: { id: archived.id } });
    expect((await upload(server, csv([HEADERS]), 'reg.csv', randomUUID())).status).toBe(404);
  });

  it('uploads disabled or gate not passed: refused with an audited refusal, nothing stored (criterion 41)', async () => {
    const before = await auditCount('import.upload_refused', eventId);
    const disabled = app({
      importConfig: {
        uploadsEnabled: false,
        fileRetentionDays: null,
        production: false,
        requireMigrationGate: false,
      },
    });
    const r1 = await upload(disabled, csv([HEADERS, [email('g'), 'G', 'virtual', '', '', '']]));
    expect(r1.status).toBe(503);
    // Production shape: uploads enabled but the migration gate must have passed. The gate read is
    // replaced by the hook because the audit log is append-only and cannot be staged per test.
    const gated = app({
      importConfig: {
        uploadsEnabled: true,
        fileRetentionDays: 30,
        production: true,
        requireMigrationGate: true,
      },
      importHooks: { migrationGatePassed: async () => false },
    });
    const r2 = await upload(gated, csv([HEADERS, [email('g'), 'G', 'virtual', '', '', '']]));
    expect(r2.status).toBe(503);
    expect(await auditCount('import.upload_refused', eventId)).toBe(before + 2);
    expect(await prisma.importRun.count({ where: { eventId } })).toBe(0);
  });

  it('upload returns headers, a suggested mapping and flags attendance columns; preview validates the mapping (criteria 2, 16)', async () => {
    const server = app();
    const up = await upload(
      server,
      csv([HEADERS, [email('ann'), 'Ann A', 'In person', 'Acme', 'R1', 'yes']]),
    );
    expect(up.status, up.text).toBe(201);
    expect(up.body.headers).toEqual(HEADERS);
    expect(up.body.suggestedMapping).toMatchObject({
      email: 'Email',
      name: 'Full Name',
      organisation: 'Company',
      externalRegistrationId: 'Registration ID',
    });
    expect(up.body.attendanceRecordColumns).toEqual(['Checked In']);
    expect(up.body.savedMapping).toBeNull();
    const runId = up.body.run.id as string;

    const unmapped = await preview(server, runId, {
      mapping: { email: 'Email', name: 'Full Name' },
    });
    expect(unmapped.status).toBe(422);
    expect(unmapped.body.error.message).toMatch(/attendanceFormat/);
    const attendance = await preview(server, runId, {
      mapping: { ...MAPPING, attendanceFormat: 'Checked In' },
    });
    expect(attendance.status).toBe(422);
    expect(attendance.body.error.code).toBe('mapping_attendance_column');

    const pv = await preview(server, runId);
    expect(pv.status, pv.text).toBe(200);
    expect(pv.body.ignoredColumns).toEqual(['Checked In']);
    expect(pv.body.counts).toMatchObject({ total: 1, accepted: 1 });
    expect(pv.body.run.status).toBe('previewed');
    expect(await prisma.delegate.count({ where: { eventId } })).toBe(0); // nothing written by a preview
    expect(await auditCount('import.previewed', runId)).toBe(1);
    const discard = await request(server)
      .post(`/api/v1/imports/${runId}/discard`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '');
    expect(discard.status).toBe(204);
    expect(await auditCount('import.discarded', runId)).toBe(1);
    expect((await confirm(server, runId)).status).toBe(409);
  });

  it('commits a file: identities, addresses, registrations, audit; repeat import changes nothing (criteria 3, 4, 5, 10, 11)', async () => {
    const server = app();
    const file = csv([
      HEADERS,
      [email('ann'), 'Ann A', 'In person', 'Acme', 'R1', 'yes'],
      [email('bob'), 'Bob B', 'online', 'Beta', 'R2', ''],
      [email('ANN'), ' ann   a', 'physical', 'Acme', 'R1', ''], // identical repeat
      ['not-an-email', 'Nobody', 'virtual', '', 'R3', ''],
      [email('cy'), 'Cy C', 'virtual', 'Acme', 'R4', ''],
      [email('cy2'), 'cy c', 'virtual', 'acme', 'R5', ''], // same name and organisation, other email
    ]);
    const first = await importFile(server, file);
    expect(first.pv.body.counts).toMatchObject({
      total: 6,
      accepted: 4,
      duplicateInFile: 1,
      rejected: 1,
      conflict: 0,
      possibleDuplicate: 1,
    });
    const byRow = new Map(
      (
        first.pv.body.rows as Array<{
          rowNumber: number;
          outcome: string;
          reasonCode: string | null;
          possibleDuplicate: boolean;
        }>
      ).map((r) => [r.rowNumber, r]),
    );
    expect(byRow.get(4)).toMatchObject({ outcome: 'duplicate_in_file' });
    expect(byRow.get(5)).toMatchObject({ outcome: 'rejected', reasonCode: 'email_invalid' });
    expect(byRow.get(7)).toMatchObject({ outcome: 'accepted', possibleDuplicate: true });
    expect(first.cf.body.alreadyCommitted).toBe(false);

    const delegates = await prisma.delegate.findMany({
      where: { eventId },
      orderBy: { email: 'asc' },
    });
    expect(delegates).toHaveLength(4);
    const ann = delegates.find((d) => d.email === email('ann'))!;
    expect(ann).toMatchObject({
      attendanceFormat: 'physical',
      organisation: 'Acme',
      externalRegistrationId: 'R1',
      registrationSource: 'eventbrite',
      registrationStatus: 'valid',
    });
    expect(ann.identityId).toBeTruthy();
    const address = await prisma.identityEmail.findUniqueOrThrow({
      where: { emailNormalised: email('ann') },
    });
    expect(address).toMatchObject({
      identityId: ann.identityId,
      kind: 'current',
      evidence: 'import',
    });
    expect(
      await prisma.delegateIdentity.count({
        where: { id: { in: delegates.map((d) => d.identityId!) } },
      }),
    ).toBe(4);
    expect(await auditCount('import.committed', first.runId)).toBe(1);
    expect(await auditCount('delegate.imported')).toBeGreaterThanOrEqual(4);
    expect(await auditCount('identity.created')).toBeGreaterThanOrEqual(4);
    const committed = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'import.committed', entityId: first.runId },
    });
    expect(committed.actorUserId).toBeTruthy();
    expect((committed.newValue as { counts: { accepted: number } }).counts.accepted).toBe(4);
    // No import audit entry carries an address or a name.
    const importAudit = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'import.' } },
    });
    for (const row of importAudit) {
      const text = JSON.stringify([row.oldValue, row.newValue]);
      expect(text).not.toContain('@example.com');
      expect(text).not.toContain('Ann A');
    }

    // Preservation fixtures on Ann: consent, invitation, sign-in link via account.
    const account = await prisma.userAccount.create({
      data: { email: email('ann'), role: 'delegate' },
    });
    accountIds.push(account.id);
    await prisma.delegate.update({
      where: { id: ann.id },
      data: { userAccountId: account.id, signedUpAt: clock },
    });
    await prisma.delegateIdentity.update({
      where: { id: ann.identityId! },
      data: { userAccountId: account.id },
    });
    await prisma.consentRecord.create({ data: { delegateId: ann.id, version: 'v1' } });
    await prisma.invitation.create({
      data: { delegateId: ann.id, tokenHash: randomUUID().replace(/-/g, '') },
    });
    const auditBefore = await prisma.auditLog.count({ where: { eventId } });

    // Repeat import: every row updated (no change), nothing new, history intact.
    const second = await importFile(server, file);
    expect(second.pv.body.counts).toMatchObject({
      accepted: 0,
      unchanged: 4,
      linked: 0,
      duplicateInFile: 1,
      rejected: 1,
    });
    expect(await prisma.delegate.count({ where: { eventId } })).toBe(4);
    expect(
      await prisma.delegateIdentity.count({
        where: { id: { in: delegates.map((d) => d.identityId!) } },
      }),
    ).toBe(4);
    const annAfter = await prisma.delegate.findUniqueOrThrow({ where: { id: ann.id } });
    expect(annAfter.userAccountId).toBe(account.id);
    expect(annAfter.signedUpAt).toEqual(clock);
    expect(await prisma.consentRecord.count({ where: { delegateId: ann.id } })).toBe(1);
    expect(await prisma.invitation.count({ where: { delegateId: ann.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'delegate.updated_by_import', eventId } }),
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { eventId } })).toBe(auditBefore + 2); // previewed + committed only

    // Corrected re-import: Bob's organisation changes in place, audited; Cy is missing but stays.
    const corrected = csv([HEADERS, [email('bob'), 'Bob B', 'online', 'Beta Ltd', 'R2', '']]);
    const third = await importFile(server, corrected);
    expect(third.pv.body.counts).toMatchObject({ updated: 1 });
    const bob = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('bob') } });
    expect(bob.organisation).toBe('Beta Ltd');
    const change = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'delegate.updated_by_import', entityId: bob.id },
    });
    expect(change.oldValue).toEqual({ organisation: 'Beta' });
    expect(change.newValue).toMatchObject({ organisation: 'Beta Ltd', runId: third.runId });
    expect(await prisma.delegate.count({ where: { eventId, registrationStatus: 'valid' } })).toBe(
      4,
    );

    // History and the row report.
    const history = await request(server)
      .get(`/api/v1/events/${eventId}/imports`)
      .set('Cookie', cookies.admin ?? '');
    expect(history.status).toBe(200);
    expect(history.body.runs.map((r: { status: string }) => r.status)).toContain('committed');
    const report = await request(server)
      .get(`/api/v1/imports/${first.runId}/report.csv`)
      .set('Cookie', cookies.admin ?? '');
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toMatch(/text\/csv/);
    expect(report.text).toContain('duplicate_in_file');
    expect(await auditCount('import.report_downloaded', first.runId)).toBe(1);
  });

  it('reuses an identity in another event and quarantines a name mismatch, keeping the identity name (criteria 6, 21)', async () => {
    const server = app();
    const other = await newEvent();
    const identities = await prisma.delegateIdentity.count();
    const run = await importFile(
      server,
      csv([
        HEADERS,
        [email('ann'), 'ANN  A', 'virtual', 'Other', 'X1', ''],
        [email('bob'), 'Robert B', 'virtual', '', 'X2', ''],
      ]),
      { mapping: MAPPING },
      other.id,
    );
    expect(run.pv.body.counts).toMatchObject({ linked: 1, conflict: 1 });
    const rows = run.pv.body.rows as Array<{
      outcome: string;
      reasonCode: string | null;
      conflict: { existing: { name: string } } | null;
    }>;
    expect(rows[1]).toMatchObject({ outcome: 'conflict', reasonCode: 'name_mismatch' });
    expect(rows[1]?.conflict?.existing.name).toBe('Bob B');
    expect(await prisma.delegateIdentity.count()).toBe(identities);
    const annHere = await prisma.delegate.findFirstOrThrow({
      where: { eventId: other.id, email: email('ann') },
    });
    const annThere = await prisma.delegate.findFirstOrThrow({
      where: { eventId, email: email('ann') },
    });
    expect(annHere.identityId).toBe(annThere.identityId);
    expect(annHere.userAccountId).toBe(annThere.userAccountId); // linked registrations share the account
    expect(
      (await prisma.delegateIdentity.findUniqueOrThrow({ where: { id: annHere.identityId! } }))
        .displayName,
    ).toBe('Ann A');
    expect(await prisma.delegate.count({ where: { eventId: other.id } })).toBe(1); // conflict row created nothing
    expect(await auditCount('identity.linked')).toBeGreaterThanOrEqual(1);
    const queue = await request(server)
      .get(`/api/v1/events/${other.id}/imports/conflicts`)
      .set('Cookie', cookies.admin ?? '');
    expect(queue.status).toBe(200);
    expect(queue.body.conflicts).toHaveLength(1);
    expect(queue.body.conflicts[0]).toMatchObject({
      reasonCode: 'name_mismatch',
      runId: run.runId,
    });
  });

  it('quarantines an external id with a different email and a historical address; valid rows still commit (criteria 7, 25)', async () => {
    const server = app();
    // A historical address of Bob's identity (as E2-12 or the backfill would record it).
    const bob = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('bob') } });
    const evidence = await prisma.auditLog.create({
      data: {
        action: 'identity.email_changed',
        entityType: 'user_account',
        entityId: randomUUID(),
        oldValue: { email: email('bob-old') },
        newValue: { email: email('bob') },
      },
    });
    await prisma.identityEmail.create({
      data: {
        identityId: bob.identityId!,
        emailNormalised: email('bob-old'),
        kind: 'historical',
        evidence: 'verified',
        auditLogId: evidence.id,
      },
    });
    const other = await newEvent();
    const run = await importFile(
      server,
      csv([
        HEADERS,
        [email('dee'), 'Dee D', 'virtual', '', 'R2', ''], // R2 exists in `eventId`, not here: no clash across events
        [email('bob-old'), 'Bob B', 'virtual', '', 'N1', ''], // previous address, no linkage in this event
      ]),
      { mapping: MAPPING },
      other.id,
    );
    expect(run.pv.body.counts).toMatchObject({ accepted: 1, conflict: 1 });
    expect(run.pv.body.rows[1]).toMatchObject({
      outcome: 'conflict',
      reasonCode: 'previous_email_of_identity',
    });
    expect(await prisma.delegate.count({ where: { eventId: other.id } })).toBe(1);
    expect(await prisma.identityEmail.count({ where: { emailNormalised: email('bob-old') } })).toBe(
      1,
    );

    // In the original event, R2 with a stranger's email is quarantined and Bob's record untouched.
    const clash = await importFile(
      server,
      csv([HEADERS, [email('stranger'), 'Stranger S', 'virtual', '', 'R2', '']]),
    );
    expect(clash.pv.body.counts).toMatchObject({ conflict: 1 });
    expect(clash.pv.body.rows[0]).toMatchObject({
      reasonCode: 'external_id_mismatch',
      conflict: { existing: { delegateId: bob.id } },
    });
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: bob.id } })).email).toBe(
      email('bob'),
    );
    expect(await prisma.delegate.count({ where: { eventId, email: email('stranger') } })).toBe(0);
  });

  it('stale preview: an edit to a matched record between preview and confirm refuses the commit; a fresh preview commits (criterion 14)', async () => {
    const server = app();
    const file = csv([HEADERS, [email('bob'), 'Bob B', 'online', 'Beta Plc', 'R2', '']]);
    const up = await upload(server, file);
    expect((await preview(server, up.body.run.id)).status).toBe(200);
    const bob = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('bob') } });
    await prisma.delegate.update({ where: { id: bob.id }, data: { country: 'NG' } });
    const stale = await confirm(server, up.body.run.id);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('preview_out_of_date');
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: bob.id } })).organisation).toBe(
      'Beta Ltd',
    );
    expect(await auditCount('import.commit_failed', up.body.run.id)).toBe(1);
    expect(await auditCount('import.committed', up.body.run.id)).toBe(0);
    expect((await preview(server, up.body.run.id)).status).toBe(200);
    const fresh = await confirm(server, up.body.run.id);
    expect(fresh.status, fresh.text).toBe(200);
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: bob.id } })).organisation).toBe(
      'Beta Plc',
    );
  });

  it('stale preview: another committed run for the event invalidates an older preview', async () => {
    const server = app();
    const a = await upload(
      server,
      csv([HEADERS, [email('eve'), 'Eve E', 'virtual', '', 'E1', '']]),
    );
    expect((await preview(server, a.body.run.id)).status).toBe(200);
    await importFile(server, csv([HEADERS, [email('fay'), 'Fay F', 'virtual', '', 'F1', '']]));
    const stale = await confirm(server, a.body.run.id);
    expect(stale.status).toBe(409);
    expect(await prisma.delegate.count({ where: { eventId, email: email('eve') } })).toBe(0);
  });

  it('expired preview is refused; confirm is idempotent on retry; concurrent confirms apply once (criterion 30)', async () => {
    const server = app();
    const up = await upload(
      server,
      csv([HEADERS, [email('gil'), 'Gil G', 'virtual', '', 'G1', '']]),
    );
    expect((await preview(server, up.body.run.id)).status).toBe(200);
    const start = clock;
    clock = new Date(start.getTime() + 31 * 60_000);
    const expired = await confirm(server, up.body.run.id);
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('preview_expired');
    clock = start;

    const [r1, r2, r3] = await Promise.all([
      confirm(server, up.body.run.id),
      confirm(server, up.body.run.id),
      confirm(server, up.body.run.id),
    ]);
    for (const r of [r1, r2, r3]) expect(r.status, r.text).toBe(200);
    expect([r1, r2, r3].filter((r) => r.body.alreadyCommitted === false)).toHaveLength(1);
    expect(await prisma.delegate.count({ where: { eventId, email: email('gil') } })).toBe(1);
    expect(await prisma.identityEmail.count({ where: { emailNormalised: email('gil') } })).toBe(1);
    expect(await auditCount('import.committed', up.body.run.id)).toBe(1);
    const again = await confirm(server, up.body.run.id);
    expect(again.body.alreadyCommitted).toBe(true);
  });

  it('two runs with the same new address confirmed together create exactly one identity (criterion 30)', async () => {
    const server = app();
    const file = csv([HEADERS, [email('hal'), 'Hal H', 'virtual', '', '', '']]);
    const a = await upload(server, file);
    const b = await upload(server, file);
    expect((await preview(server, a.body.run.id)).status).toBe(200);
    expect((await preview(server, b.body.run.id)).status).toBe(200);
    const [ra, rb] = await Promise.all([
      confirm(server, a.body.run.id),
      confirm(server, b.body.run.id),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]); // the loser sees its preview out of date
    expect(await prisma.delegate.count({ where: { eventId, email: email('hal') } })).toBe(1);
    expect(await prisma.identityEmail.count({ where: { emailNormalised: email('hal') } })).toBe(1);
  });

  it('a failure inside the commit rolls everything back, records import.commit_failed, and the retry succeeds (D9 errors)', async () => {
    let fail = true;
    const server = app({
      importHooks: {
        beforeCommitWrite: async () => {
          if (fail) throw new Error('injected failure');
        },
      },
    });
    const up = await upload(
      server,
      csv([HEADERS, [email('ivy'), 'Ivy I', 'virtual', '', 'I1', '']]),
    );
    expect((await preview(server, up.body.run.id)).status).toBe(200);
    const failed = await confirm(server, up.body.run.id);
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('import_commit_failed');
    expect(await prisma.delegate.count({ where: { eventId, email: email('ivy') } })).toBe(0);
    expect(await prisma.identityEmail.count({ where: { emailNormalised: email('ivy') } })).toBe(0);
    expect(await auditCount('import.committed', up.body.run.id)).toBe(0);
    expect(await auditCount('import.commit_failed', up.body.run.id)).toBe(1);
    expect(
      (await prisma.importRun.findUniqueOrThrow({ where: { id: up.body.run.id } })).status,
    ).toBe('previewed');
    fail = false;
    const retry = await confirm(server, up.body.run.id);
    expect(retry.status, retry.text).toBe(200);
    expect(await prisma.delegate.count({ where: { eventId, email: email('ivy') } })).toBe(1);
    expect(await auditCount('import.committed', up.body.run.id)).toBe(1);
  });

  it('saved mappings per source are reusable only with identical headers; run-wide attendance default is audited (criterion 20)', async () => {
    const server = app();
    const source = `src-${tag}`;
    const headers = ['Email', 'Name'];
    const up1 = await upload(
      server,
      csv([headers, [email('jo'), 'Jo J']]),
      'a.csv',
      eventId,
      source,
    );
    expect(up1.body.savedMapping).toBeNull();
    const pv = await preview(server, up1.body.run.id, {
      mapping: { email: 'Email', name: 'Name' },
      attendanceFormatDefault: 'physical',
      saveMapping: true,
    });
    expect(pv.status, pv.text).toBe(200);
    expect((await confirm(server, up1.body.run.id)).status).toBe(200);
    expect(
      (await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('jo') } }))
        .attendanceFormat,
    ).toBe('physical');
    const previewed = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'import.previewed', entityId: up1.body.run.id },
    });
    expect(previewed.newValue).toMatchObject({
      attendanceFormatDefault: 'physical',
      mappingSaved: true,
    });

    const up2 = await upload(
      server,
      csv([
        ['email', 'NAME'],
        [email('kim'), 'Kim K'],
      ]),
      'b.csv',
      eventId,
      source,
    );
    expect(up2.body.savedMapping).toMatchObject({
      reusable: true,
      mapping: { email: 'Email', name: 'Name' },
    });
    const up3 = await upload(
      server,
      csv([
        ['Email', 'Name', 'Extra'],
        [email('lee'), 'Lee L', ''],
      ]),
      'c.csv',
      eventId,
      source,
    );
    expect(up3.body.savedMapping).toMatchObject({ reusable: false });
    // A preview is still required and a mapping must still be confirmed, whatever was saved.
    expect((await confirm(server, up2.body.run.id)).status).toBe(409);
  });

  it('a historical address and a registration in the same event reach the record through its own imported email (criterion 24)', async () => {
    const server = app();
    // Simulate an E2-12 email change on Fay: current address moves, old one becomes historical.
    const fay = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('fay') } });
    const evidence = await prisma.auditLog.create({
      data: {
        action: 'identity.email_changed',
        entityType: 'user_account',
        entityId: randomUUID(),
        oldValue: { email: email('fay') },
        newValue: { email: email('fay-new') },
      },
    });
    await prisma.identityEmail.update({
      where: { emailNormalised: email('fay') },
      data: { kind: 'historical', evidence: 'verified', auditLogId: evidence.id },
    });
    await prisma.identityEmail.create({
      data: {
        identityId: fay.identityId!,
        emailNormalised: email('fay-new'),
        kind: 'current',
        evidence: 'admin_decision',
        auditLogId: evidence.id,
      },
    });
    const identities = await prisma.delegateIdentity.count();
    const run = await importFile(
      server,
      csv([HEADERS, [email('fay'), 'Fay F', 'virtual', 'Fay Org', 'F1', '']]),
    );
    expect(run.pv.body.counts).toMatchObject({ updated: 1 });
    const after = await prisma.delegate.findUniqueOrThrow({ where: { id: fay.id } });
    expect(after.organisation).toBe('Fay Org');
    expect(after.identityId).toBe(fay.identityId);
    expect(await prisma.delegateIdentity.count()).toBe(identities);
    expect(
      (
        await prisma.identityEmail.findUniqueOrThrow({
          where: { emailNormalised: email('fay-new') },
        })
      ).kind,
    ).toBe('current');
    expect(
      (await prisma.identityEmail.findUniqueOrThrow({ where: { emailNormalised: email('fay') } }))
        .kind,
    ).toBe('historical');
  });

  it('never infers attendance: no attendance-like data is stored from a file (criterion 16)', async () => {
    const server = app();
    const run = await importFile(
      server,
      csv([HEADERS, [email('max'), 'Max M', 'virtual', '', 'M1', 'attended']]),
    );
    expect(run.pv.body.ignoredColumns).toEqual(['Checked In']);
    const max = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('max') } });
    const stored = JSON.stringify(max);
    expect(stored).not.toContain('attended');
    expect(stored).not.toContain('Checked');
  });
});
