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

describe.skipIf(!hasDatabase)('conflict resolution (D5 valid actions, D5.1, D9)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  let adminId: string;
  const eventIds: string[] = [];
  const accountIds: string[] = [];
  const cookies: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const email = (local: string) => `${local}-${tag}@example.com`;

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
    return account.id;
  }
  async function newEvent() {
    const event = await createTestEvent(prisma);
    eventIds.push(event.id);
    return event.id;
  }

  const HEADERS = ['Email', 'Full Name', 'Format', 'Company', 'Registration ID'];
  const MAPPING = {
    email: 'Email',
    name: 'Full Name',
    attendanceFormat: 'Format',
    organisation: 'Company',
    externalRegistrationId: 'Registration ID',
  };
  const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');

  /** Uploads, previews and commits a file; returns the run id. */
  async function importFile(server: ReturnType<typeof app>, rows: string[][], target = eventId) {
    const up = await request(server)
      .post(`/api/v1/events/${target}/imports`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .field('source', 'eventbrite')
      .attach('file', csv([HEADERS, ...rows]), 'reg.csv');
    expect(up.status, up.text).toBe(201);
    const pv = await request(server)
      .post(`/api/v1/imports/${up.body.run.id}/preview`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ mapping: MAPPING });
    expect(pv.status, pv.text).toBe(200);
    const cf = await request(server)
      .post(`/api/v1/imports/${up.body.run.id}/confirm`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '');
    expect(cf.status, cf.text).toBe(200);
    return up.body.run.id as string;
  }
  async function conflictRows(runId: string) {
    return prisma.importRow.findMany({
      where: { runId, outcome: 'conflict' },
      orderBy: { rowNumber: 'asc' },
    });
  }
  const resolve = (
    server: ReturnType<typeof app>,
    rowId: string,
    body: object,
    cookie = cookies.admin,
  ) =>
    request(server)
      .post(`/api/v1/imports/rows/${rowId}/resolve`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie ?? '')
      .send(body);
  const auditCount = (action: string, entityId: string) =>
    prisma.auditLog.count({ where: { action, entityId } });
  const existingIdentityOf = (row: { conflict: unknown }) =>
    (row.conflict as { existing: { identityId?: string } }).existing.identityId!;

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = await newEvent();
    adminId = await signedIn('admin');
    for (const role of ['delegate', 'analyst', 'support', 'speaker'] as const) await signedIn(role);
    // Baseline people: Ann and Bob are registered in the event with identities and current addresses.
    await importFile(app(), [
      [email('ann'), 'Ann A', 'physical', 'Acme', 'R1'],
      [email('bob'), 'Bob B', 'virtual', 'Beta', 'R2'],
    ]);
  });
  afterAll(async () => {
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
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('is admin-only and validates the request shape (criterion 9)', async () => {
    const server = app();
    const runId = await importFile(
      server,
      [[email('bob'), 'Robert B', 'virtual', '', 'X1']],
      await newEvent(),
    );
    const [row] = await conflictRows(runId);
    expect(row?.reasonCode).toBe('name_mismatch');
    expect((await resolve(server, row!.id, { action: 'reject' }, '')).status).toBe(401);
    for (const role of ['delegate', 'analyst', 'support', 'speaker'] as const) {
      expect(
        (await resolve(server, row!.id, { action: 'reject' }, cookies[role])).status,
        role,
      ).toBe(role === 'analyst' || role === 'support' ? 401 : 403);
    }
    expect((await resolve(server, row!.id, { action: 'merge' })).status).toBe(422);
    expect((await resolve(server, row!.id, { action: 'link_existing' })).status).toBe(422);
    expect((await resolve(server, randomUUID(), { action: 'reject' })).status).toBe(404);
    expect(
      (await prisma.importRow.findUniqueOrThrow({ where: { id: row!.id } })).resolution,
    ).toBeNull();
  });

  it('name mismatch: link with the same-person confirmation attaches a registration, keeps the identity name; without it the action is refused and audited', async () => {
    const server = app();
    const other = await newEvent();
    const runId = await importFile(
      server,
      [[email('bob'), 'Robert B', 'virtual', 'Gamma', 'X2']],
      other,
    );
    const [row] = await conflictRows(runId);
    const identityId = existingIdentityOf(row!);

    const refused = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId,
      samePerson: false,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('resolution_refused');
    expect(JSON.stringify(refused.body)).not.toContain('Bob B');
    expect(await auditCount('import.resolution_refused', row!.id)).toBe(1);
    expect(await auditCount('import.conflict_resolved', row!.id)).toBe(0);
    expect(await prisma.delegate.count({ where: { eventId: other } })).toBe(0);

    const ok = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId,
      samePerson: true,
      note: 'confirmed by phone',
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.alreadyResolved).toBe(false);
    expect(ok.body.row).toMatchObject({ resolution: 'link_existing', identityId });
    const delegate = await prisma.delegate.findFirstOrThrow({
      where: { eventId: other, email: email('bob') },
    });
    expect(delegate.identityId).toBe(identityId);
    expect(delegate.name).toBe('Robert B'); // registration keeps the row's name
    expect(
      (await prisma.delegateIdentity.findUniqueOrThrow({ where: { id: identityId } })).displayName,
    ).toBe('Bob B'); // identity name preserved
    expect(await prisma.identityEmail.count({ where: { emailNormalised: email('bob') } })).toBe(1); // current address untouched
    const resolved = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'import.conflict_resolved', entityId: row!.id },
    });
    expect(resolved.newValue).toMatchObject({
      action: 'link_existing',
      samePerson: true,
      identityId,
      delegateId: delegate.id,
      reason: 'name_mismatch',
    });
    expect(resolved.actorUserId).toBe(adminId);
    expect(await auditCount('identity.linked', identityId)).toBeGreaterThanOrEqual(1);
    // create is never valid for an owned address (rule 3).
    const run2 = await importFile(
      server,
      [[email('bob'), 'Bobby B', 'virtual', '', 'X3']],
      await newEvent(),
    );
    const [row2] = await conflictRows(run2);
    const create = await resolve(server, row2!.id, {
      action: 'create_identity',
      differentPerson: true,
    });
    expect(create.status).toBe(409);
    expect(await auditCount('import.resolution_refused', row2!.id)).toBe(1);
  });

  it('retries are idempotent, a different decision is refused, and concurrent decisions apply once', async () => {
    const server = app();
    const other = await newEvent();
    const runId = await importFile(server, [[email('ann'), 'Annie A', 'virtual', '', 'Y1']], other);
    const [row] = await conflictRows(runId);
    const identityId = existingIdentityOf(row!);
    const body = { action: 'link_existing', identityId, samePerson: true };
    const results = await Promise.all([
      resolve(server, row!.id, body),
      resolve(server, row!.id, body),
      resolve(server, row!.id, body),
    ]);
    for (const r of results) expect(r.status, r.text).toBe(200);
    expect(results.filter((r) => r.body.alreadyResolved === false)).toHaveLength(1);
    expect(await prisma.delegate.count({ where: { eventId: other, email: email('ann') } })).toBe(1);
    expect(await auditCount('import.conflict_resolved', row!.id)).toBe(1);
    const again = await resolve(server, row!.id, body);
    expect(again.body.alreadyResolved).toBe(true);
    const different = await resolve(server, row!.id, { action: 'reject' });
    expect(different.status).toBe(409);
    expect(different.body.error.message).toMatch(/already been resolved/);
  });

  it('rule 1: create a new identity for an unowned address with the different-person confirmation; reserved addresses are refused', async () => {
    const server = app();
    // R1 exists in the event for Ann; a stranger's unowned address with R1 is a rule-1 conflict.
    const runId = await importFile(server, [
      [email('stranger'), 'Stranger S', 'virtual', 'Zeta', 'R1'],
    ]);
    const [row] = await conflictRows(runId);
    expect(row?.reasonCode).toBe('external_id_mismatch');
    expect(
      (await resolve(server, row!.id, { action: 'create_identity', differentPerson: false }))
        .status,
    ).toBe(409);
    expect(
      (
        await resolve(server, row!.id, {
          action: 'link_existing',
          identityId: existingIdentityOf(row!),
          samePerson: true,
        })
      ).status,
    ).toBe(409); // link not valid for rule 1
    // The external id is still held by Ann's registration, so a new registration cannot carry it.
    const clash = await resolve(server, row!.id, {
      action: 'create_identity',
      differentPerson: true,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/already exists in the event/);
    // Same stranger, no external id: created as a new person with a current address by admin decision.
    const run2 = await importFile(server, [
      [email('bob'), 'Bob B', 'virtual', 'Beta', 'R2'],
      [email('bob'), 'Bobby Two', 'virtual', 'Beta', 'R2'],
    ]); // in-file conflict for bob
    const rows2 = await conflictRows(run2);
    expect(rows2.map((r) => r.reasonCode)).toEqual([
      'shared_email_in_file',
      'shared_email_in_file',
    ]);
    // Unowned address through the in-file path: a fresh pair that shares a brand-new email.
    const run3 = await importFile(server, [
      [email('new'), 'New One', 'virtual', '', ''],
      [email('new'), 'New Two', 'virtual', '', ''],
    ]);
    const [first, second] = await conflictRows(run3);
    const early = await resolve(server, first!.id, {
      action: 'create_identity',
      differentPerson: true,
    });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/Resolve the other rows/);
    expect((await resolve(server, second!.id, { action: 'reject', note: 'typo' })).status).toBe(
      200,
    );
    const created = await resolve(server, first!.id, {
      action: 'create_identity',
      differentPerson: true,
    });
    expect(created.status, created.text).toBe(200);
    const address = await prisma.identityEmail.findUniqueOrThrow({
      where: { emailNormalised: email('new') },
    });
    expect(address).toMatchObject({
      kind: 'current',
      evidence: 'admin_decision',
      identityId: created.body.row.identityId,
    });
    expect(address.auditLogId).toBeTruthy();
    expect(await prisma.delegate.count({ where: { eventId, email: email('new') } })).toBe(1);
    expect(await auditCount('identity.created', created.body.row.identityId)).toBe(1);
  });

  it('rule 6: a previous address links only to its own identity and stays historical; creating is refused; another identity is refused without disclosure', async () => {
    const server = app();
    const bob = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('bob') } });
    const ann = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('ann') } });
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
    const runId = await importFile(
      server,
      [[email('bob-old'), 'Bob B', 'virtual', '', 'Z1']],
      other,
    );
    const [row] = await conflictRows(runId);
    expect(row?.reasonCode).toBe('previous_email_of_identity');

    const create = await resolve(server, row!.id, {
      action: 'create_identity',
      differentPerson: true,
    });
    expect(create.status).toBe(409);
    const wrong = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId: ann.identityId,
      samePerson: true,
    });
    expect(wrong.status).toBe(409);
    expect(JSON.stringify(wrong.body)).not.toMatch(/Bob|bob-/);
    expect(await auditCount('import.resolution_refused', row!.id)).toBe(2);
    const missing = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId: randomUUID(),
      samePerson: true,
    });
    expect(missing.status).toBe(409);

    const ok = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId: bob.identityId,
      samePerson: true,
    });
    expect(ok.status, ok.text).toBe(200);
    const linked = await prisma.delegate.findFirstOrThrow({
      where: { eventId: other, email: email('bob-old') },
    });
    expect(linked.identityId).toBe(bob.identityId);
    expect(
      (
        await prisma.identityEmail.findUniqueOrThrow({
          where: { emailNormalised: email('bob-old') },
        })
      ).kind,
    ).toBe('historical');
    expect(
      (await prisma.identityEmail.findUniqueOrThrow({ where: { emailNormalised: email('bob') } }))
        .kind,
    ).toBe('current');
    expect(await prisma.delegateIdentity.count({ where: { id: bob.identityId! } })).toBe(1);
  });

  it('inactive account and migration-review reservations refuse link and create; reject and correct-the-source always work', async () => {
    const server = app();
    const bob = await prisma.delegate.findFirstOrThrow({ where: { eventId, email: email('bob') } });
    const account = await prisma.userAccount.create({
      data: { email: email('bob'), role: 'delegate', status: 'inactive' },
    });
    accountIds.push(account.id);
    await prisma.delegateIdentity.update({
      where: { id: bob.identityId! },
      data: { userAccountId: account.id },
    });
    const other = await newEvent();
    const runId = await importFile(server, [[email('bob'), 'Bob B', 'virtual', '', 'Q1']], other);
    const [row] = await conflictRows(runId);
    expect(row?.reasonCode).toBe('inactive_account');
    const link = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId: bob.identityId,
      samePerson: true,
    });
    expect(link.status).toBe(409);
    expect(link.body.error.message).toMatch(/inactive/);
    expect(
      (
        await resolve(server, row!.id, {
          action: 'correct_source',
          note: 'ask M.Bryan to reactivate',
        })
      ).status,
    ).toBe(200);
    expect((await prisma.importRow.findUniqueOrThrow({ where: { id: row!.id } })).resolution).toBe(
      'correct_source',
    );
    await prisma.delegateIdentity.update({
      where: { id: bob.identityId! },
      data: { userAccountId: null },
    });

    // Provisional reservation (Case A): nothing may claim it through resolution.
    const reserved = await prisma.delegateIdentity.create({
      data: {
        displayName: 'Reserved R',
        emails: {
          create: {
            emailNormalised: email('reserved'),
            kind: 'provisional',
            evidence: 'unverified',
          },
        },
      },
    });
    const run2 = await importFile(
      server,
      [[email('reserved'), 'Reserved R', 'virtual', '', 'Q2']],
      other,
    );
    const [row2] = await conflictRows(run2);
    expect(row2?.reasonCode).toBe('address_under_migration_review');
    expect(
      (
        await resolve(server, row2!.id, {
          action: 'link_existing',
          identityId: reserved.id,
          samePerson: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (await resolve(server, row2!.id, { action: 'create_identity', differentPerson: true }))
        .status,
    ).toBe(409);
    expect(
      (
        await prisma.identityEmail.findUniqueOrThrow({
          where: { emailNormalised: email('reserved') },
        })
      ).kind,
    ).toBe('provisional');
    expect((await resolve(server, row2!.id, { action: 'reject' })).status).toBe(200);
    await prisma.identityEmail.deleteMany({ where: { identityId: reserved.id } });
    await prisma.delegateIdentity.delete({ where: { id: reserved.id } });
  });

  it('stale conflicts are refused: a registration that appeared meanwhile, or a row of a non-committed run', async () => {
    const server = app();
    const other = await newEvent();
    const runId = await importFile(
      server,
      [[email('ann'), 'Annie Again', 'virtual', '', 'S1']],
      other,
    );
    const [row] = await conflictRows(runId);
    const identityId = existingIdentityOf(row!);
    // Ann gets registered in the event by a later, corrected import before the admin decides.
    await importFile(server, [[email('ann'), 'Ann A', 'virtual', '', 'S1']], other);
    const stale = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId,
      samePerson: true,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/already exists in the event/);
    expect(await prisma.delegate.count({ where: { eventId: other, email: email('ann') } })).toBe(1);

    // Rows of a previewed (uncommitted) run cannot be resolved; neither can non-conflict rows.
    const up = await request(server)
      .post(`/api/v1/events/${other}/imports`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .field('source', 'eventbrite')
      .attach('file', csv([HEADERS, [email('bob'), 'Robert B', 'virtual', '', 'S2']]), 'reg.csv');
    await request(server)
      .post(`/api/v1/imports/${up.body.run.id}/preview`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookies.admin ?? '')
      .send({ mapping: MAPPING });
    const [previewRow] = await conflictRows(up.body.run.id);
    expect((await resolve(server, previewRow!.id, { action: 'reject' })).status).toBe(409);
    const accepted = await prisma.importRow
      .findFirstOrThrow({ where: { runId, outcome: { not: 'conflict' } } })
      .catch(() => null);
    if (accepted)
      expect((await resolve(server, accepted.id, { action: 'reject' })).status).toBe(409);
  });

  it('a failure after acceptance rolls everything back and writes only import.resolution_failed; the retry succeeds', async () => {
    let fail = true;
    const server = app({
      resolutionHooks: {
        beforeResolutionWrite: async () => {
          if (fail) throw new Error('injected');
        },
      },
    });
    const other = await newEvent();
    const runId = await importFile(
      server,
      [[email('bob'), 'Bobby Fail', 'virtual', '', 'F1']],
      other,
    );
    const [row] = await conflictRows(runId);
    const identityId = existingIdentityOf(row!);
    const failed = await resolve(server, row!.id, {
      action: 'link_existing',
      identityId,
      samePerson: true,
    });
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('resolution_failed');
    expect(await prisma.delegate.count({ where: { eventId: other } })).toBe(0);
    expect(
      (await prisma.importRow.findUniqueOrThrow({ where: { id: row!.id } })).resolution,
    ).toBeNull();
    expect(await auditCount('import.resolution_failed', row!.id)).toBe(1);
    expect(await auditCount('import.conflict_resolved', row!.id)).toBe(0);
    fail = false;
    expect(
      (await resolve(server, row!.id, { action: 'link_existing', identityId, samePerson: true }))
        .status,
    ).toBe(200);
    expect(await prisma.delegate.count({ where: { eventId: other } })).toBe(1);
    // The open-conflict queue no longer lists the row; history shows the decision.
    const queue = await request(server)
      .get(`/api/v1/events/${other}/imports/conflicts`)
      .set('Cookie', cookies.admin ?? '');
    expect(queue.body.conflicts.map((c: { id: string }) => c.id)).not.toContain(row!.id);
    const detail = await request(server)
      .get(`/api/v1/imports/${runId}`)
      .set('Cookie', cookies.admin ?? '');
    expect(detail.body.rows[0]).toMatchObject({ resolution: 'link_existing' });
  });

  it('resolution audit entries carry ids and reason categories, never addresses or names', async () => {
    const rows = await prisma.auditLog.findMany({
      where: {
        action: {
          in: ['import.conflict_resolved', 'import.resolution_refused', 'import.resolution_failed'],
        },
        eventId: { in: eventIds },
      },
    });
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      const text = JSON.stringify([r.oldValue, r.newValue]);
      expect(text).not.toContain('@example.com');
      expect(text).not.toMatch(/Bob B|Ann A|Robert/);
      expect(r.actorUserId).toBe(adminId);
    }
  });
});
