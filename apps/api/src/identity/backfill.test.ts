import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, isUniqueViolation, testPrisma } from '../db/test-helpers.js';
import { normaliseEmail } from '../lib/email.js';
import {
  preservationChecksum,
  runIdentityBackfill,
  uniqueIndexEnforces,
  writeAuditReport,
  type BackfillReport,
} from './backfill.js';
import {
  IDENTITY_BACKFILL_ACTION,
  importFeatureState,
  lastStartedRunOrdinal,
  latestIdentityBackfillReport,
} from './report.js';

describe('email normalisation', () => {
  it('is NFC, trimmed and lower-cased, and is the one function every path shares', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    // e + combining acute (NFD) and precomposed é (NFC) are the same address.
    expect(normaliseEmail('réna@example.com')).toBe(normaliseEmail('réna@example.com'));
  });
});

describe.skipIf(!hasDatabase)('identity schema and migration gate (backlog D5.1, D6.1)', () => {
  let prisma: PrismaClient;
  let eventId: string;
  const unique = () => randomUUID().slice(0, 8);
  const email = (tag: string) => `${tag}-${unique()}@example.com`;

  /** Rows created by this file, removed after each test so the shared test database stays clean. */
  const created = { delegates: [] as string[], accounts: [] as string[] };

  async function account(addr: string, role: 'delegate' | 'admin' | 'support' = 'delegate') {
    const a = await prisma.userAccount.create({
      data: { email: normaliseEmail(addr), role, status: 'active' },
      select: { id: true },
    });
    created.accounts.push(a.id);
    return a.id;
  }
  async function delegate(addr: string, userAccountId?: string | null, name = 'Test Person') {
    const d = await prisma.delegate.create({
      data: {
        eventId,
        email: addr,
        name,
        attendanceFormat: 'physical',
        userAccountId: userAccountId ?? null,
      },
      select: { id: true },
    });
    created.delegates.push(d.id);
    return d.id;
  }
  async function reportRows() {
    return prisma.auditLog.count({ where: { action: IDENTITY_BACKFILL_ACTION } });
  }

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
  });
  /** The gate runs over the whole database, so every test starts and ends with no identities. */
  async function resetIdentities() {
    await prisma.identityEmail.deleteMany();
    await prisma.delegate.updateMany({ data: { identityId: null } });
    await prisma.delegateIdentity.deleteMany();
  }
  beforeEach(resetIdentities);
  afterEach(async () => {
    await resetIdentities();
    await prisma.delegate.deleteMany({ where: { id: { in: created.delegates } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: created.accounts } } });
    created.delegates = [];
    created.accounts = [];
  });
  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.$disconnect();
  });

  it('enforces one owner per address across current, historical and provisional kinds (H1, H4)', async () => {
    const a = await prisma.delegateIdentity.create({ data: { displayName: 'A' } });
    const b = await prisma.delegateIdentity.create({ data: { displayName: 'B' } });
    const addr = email('unique');
    await prisma.identityEmail.create({
      data: { identityId: a.id, emailNormalised: addr, kind: 'current', evidence: 'backfill' },
    });
    for (const kind of ['historical', 'provisional', 'current'] as const) {
      await expect(
        prisma.identityEmail.create({
          data: { identityId: b.id, emailNormalised: addr, kind, evidence: 'unverified' },
        }),
      ).rejects.toSatisfy(isUniqueViolation);
    }
    // One current address per identity (partial unique index from the migration).
    await expect(
      prisma.identityEmail.create({
        data: {
          identityId: a.id,
          emailNormalised: email('second'),
          kind: 'current',
          evidence: 'backfill',
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
    // The same identity may hold the address again only once: never twice in any kind.
    expect(await prisma.identityEmail.count({ where: { emailNormalised: addr } })).toBe(1);
  });

  it('backfills consistent data: one identity per person, links kept, durable pass report', async () => {
    const addrA = email('alice');
    const acctA = await account(addrA);
    const d1 = await delegate(addrA, acctA, 'Alice A');
    const other = await createTestEvent(prisma);
    const d2 = await prisma.delegate.create({
      data: {
        eventId: other.id,
        email: addrA.toUpperCase(),
        name: 'Alice A',
        attendanceFormat: 'virtual',
      },
      select: { id: true },
    });
    created.delegates.push(d2.id);
    const d3 = await delegate(email('bob'), null, 'Bob B');
    const before = await reportRows();

    const outcome = await runIdentityBackfill(prisma, {});
    expect(outcome.reported).toBe(true);
    expect(outcome.report.result).toBe('pass');
    expect(outcome.report.committed).toBe(true);
    expect(outcome.report.invariants).toEqual({
      H1: 'pass',
      H2: 'pass',
      H3: 'pass',
      H4: 'pass',
      H5: 'pass',
    });

    const rows = await prisma.delegate.findMany({
      where: { id: { in: [d1, d2.id, d3] } },
      select: { id: true, identityId: true, userAccountId: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(d1)?.identityId).toBeTruthy();
    expect(byId.get(d2.id)?.identityId).toBe(byId.get(d1)?.identityId);
    expect(byId.get(d3)?.identityId).toBeTruthy();
    expect(byId.get(d3)?.identityId).not.toBe(byId.get(d1)?.identityId);
    expect(byId.get(d1)?.userAccountId).toBe(acctA); // ownership untouched
    const identity = await prisma.delegateIdentity.findUnique({ where: { userAccountId: acctA } });
    expect(identity?.displayName).toBe('Alice A');

    expect(await reportRows()).toBe(before + 1);
    const latest = await latestIdentityBackfillReport(prisma);
    expect(latest?.result).toBe('pass');
    const state = await importFeatureState(prisma);
    expect(state.gatePassed).toBe(true);
    expect(state.uploadsEnabled).toBe(false);
    expect(state.blockers.join(' ')).toMatch(/not implemented|OQ-22/);

    // Idempotent rerun: nothing new, still pass.
    const again = await runIdentityBackfill(prisma, {});
    expect(again.report.result).toBe('pass');
    expect(again.report.counts.identitiesCreated).toBe(0);
    await prisma.event.delete({ where: { id: other.id } });
  });

  it('Case A: a stale registration address is reserved provisionally and the run can pass', async () => {
    const current = email('carol-new');
    const stale = email('carol-old');
    const acct = await account(current);
    const d = await delegate(stale, acct, 'Carol C');

    const outcome = await runIdentityBackfill(prisma, {});
    expect(outcome.report.result).toBe('pass');
    expect(outcome.report.findings.caseA).toEqual([d]);
    expect(outcome.report.counts.addressesProvisional).toBe(1);
    const identity = await prisma.delegateIdentity.findUniqueOrThrow({
      where: { userAccountId: acct },
    });
    const addresses = await prisma.identityEmail.findMany({ where: { identityId: identity.id } });
    expect(addresses.map((a) => [a.kind, a.evidence]).sort()).toEqual([
      ['current', 'backfill'],
      ['provisional', 'unverified'],
    ]);
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: d } })).identityId).toBe(
      identity.id,
    );
    // The reserved address cannot be claimed by another identity, in any kind.
    const b = await prisma.delegateIdentity.create({ data: { displayName: 'B' } });
    await expect(
      prisma.identityEmail.create({
        data: {
          identityId: b.id,
          emailNormalised: normaliseEmail(stale),
          kind: 'current',
          evidence: 'backfill',
        },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
    // No report entry or address row contains the address.
    const latest = await prisma.auditLog.findFirst({
      where: { action: IDENTITY_BACKFILL_ACTION },
      orderBy: { occurredAt: 'desc' },
    });
    expect(JSON.stringify(latest?.newValue)).not.toContain(stale.split('@')[0]);
  });

  it('seeds verified history only from an audit entry recording the exact change (H3)', async () => {
    const current = email('dan-new');
    const old = email('dan-old');
    const acct = await account(current);
    const d = await delegate(old, acct, 'Dan D');
    await prisma.auditLog.create({
      data: {
        action: 'identity.email_changed',
        entityType: 'user_account',
        entityId: acct,
        oldValue: { email: old },
        newValue: { email: current },
      },
    });
    const outcome = await runIdentityBackfill(prisma, {});
    expect(outcome.report.result).toBe('pass');
    expect(outcome.report.findings.caseA).toEqual([]);
    expect(outcome.report.counts.addressesHistoricalVerified).toBe(1);
    const row = await prisma.identityEmail.findUniqueOrThrow({
      where: { emailNormalised: normaliseEmail(old) },
    });
    expect(row.kind).toBe('historical');
    expect(row.evidence).toBe('verified');
    expect(row.auditLogId).toBeTruthy();
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: d } })).identityId).toBe(
      row.identityId,
    );
  });

  it('another account’s matching old-to-new entry never verifies this account’s history (H3)', async () => {
    const current = email('eve-new');
    const old = email('eve-old');
    const acct = await account(current);
    const other = await account(email('other'));
    const d = await delegate(old, acct, 'Eve E');
    // Same old -> new pair, but recorded for a different account, plus entries with the wrong
    // entity type or no entity at all: none of them is evidence for `acct`.
    for (const data of [
      { entityType: 'user_account', entityId: other },
      { entityType: 'delegate', entityId: acct },
      { entityType: 'user_account', entityId: null },
    ]) {
      await prisma.auditLog.create({
        data: {
          action: 'identity.email_changed',
          ...data,
          oldValue: { email: old },
          newValue: { email: current },
        },
      });
    }
    const first = await runIdentityBackfill(prisma, {});
    expect(first.report.result).toBe('pass');
    expect(first.report.findings.caseA).toEqual([d]); // Case A: reserved, unverified
    expect(first.report.counts.addressesHistoricalVerified).toBe(0);
    const reserved = await prisma.identityEmail.findUniqueOrThrow({
      where: { emailNormalised: normaliseEmail(old) },
    });
    expect(reserved.kind).toBe('provisional');
    expect(reserved.evidence).toBe('unverified');
    expect(reserved.auditLogId).toBeNull();

    // The account's own exact entry, with case and whitespace noise, is accepted on a fresh run.
    await resetIdentities();
    const own = await prisma.auditLog.create({
      data: {
        action: 'identity.email_changed',
        entityType: 'user_account',
        entityId: acct,
        oldValue: { email: ` ${old.toUpperCase()} ` },
        newValue: { email: current.toUpperCase() },
      },
      select: { id: true },
    });
    const second = await runIdentityBackfill(prisma, {});
    expect(second.report.result).toBe('pass');
    expect(second.report.findings.caseA).toEqual([]);
    const proven = await prisma.identityEmail.findUniqueOrThrow({
      where: { emailNormalised: normaliseEmail(old) },
    });
    expect(proven.kind).toBe('historical');
    expect(proven.evidence).toBe('verified');
    expect(proven.auditLogId).toBe(own.id);
  });

  it('H3 fails when an identity has no current address, and rolls back', async () => {
    const addr = email('finn');
    const acct = await account(addr);
    const d = await delegate(addr, acct, 'Finn F');
    const outcome = await runIdentityBackfill(prisma, {
      beforeVerify: async (tx) => {
        // An identity that owns no current address, as a bad prior state or a lost row would leave.
        await tx.delegateIdentity.create({ data: { displayName: 'No current address' } });
      },
    });
    expect(outcome.report.result).toBe('fail');
    expect(outcome.report.committed).toBe(false);
    expect(outcome.report.invariants.H3).toBe('fail');
    expect(await prisma.delegateIdentity.count()).toBe(0);
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: d } })).identityId).toBeNull();
    expect((await latestIdentityBackfillReport(prisma))?.passed).toBe(false);

    // Removing the only current address of a real identity fails the same way.
    const removed = await runIdentityBackfill(prisma, {
      beforeVerify: async (tx) => {
        await tx.identityEmail.deleteMany({ where: { kind: 'current' } });
      },
    });
    expect(removed.report.invariants.H3).toBe('fail');
    expect(removed.report.committed).toBe(false);
    expect(await prisma.delegateIdentity.count()).toBe(0);
  });

  it('Case B1: a stored cross-identity collision fails the gate, writes nothing and reports fail durably', async () => {
    // Erin's registration at one event (linked to Erin's account) carries Frank's current address,
    // and Frank registered with it at another event: two identities claim one address.
    const erin = email('erin');
    const frank = email('frank');
    const acctErin = await account(erin);
    const acctFrank = await account(frank);
    const dErin = await delegate(frank, acctErin, 'Erin E'); // stale address == another identity's current
    const other = await createTestEvent(prisma);
    const dFrank = (
      await prisma.delegate.create({
        data: {
          eventId: other.id,
          email: frank,
          name: 'Frank F',
          attendanceFormat: 'virtual',
          userAccountId: acctFrank,
        },
        select: { id: true },
      })
    ).id;
    created.delegates.push(dFrank);
    const before = await reportRows();

    const outcome = await runIdentityBackfill(prisma, {});
    expect(outcome.reported).toBe(true);
    expect(outcome.report.result).toBe('fail');
    expect(outcome.report.committed).toBe(false);
    expect(outcome.report.invariants.H1).toBe('fail');
    expect(outcome.report.findings.caseB1).toHaveLength(1);
    expect(outcome.report.findings.caseB1[0]?.claimants).toHaveLength(2);
    expect(outcome.report.failure?.stage).toBe('classification');
    // Prior usable state preserved: no identities, no addresses, links and ownership unchanged.
    expect(await prisma.delegateIdentity.count()).toBe(0);
    expect(await prisma.identityEmail.count()).toBe(0);
    const rows = await prisma.delegate.findMany({ where: { id: { in: [dErin, dFrank] } } });
    expect(rows.every((r) => r.identityId === null)).toBe(true);
    expect(rows.find((r) => r.id === dErin)?.userAccountId).toBe(acctErin);
    // Durable fail report exists although the transaction rolled back; imports stay closed.
    expect(await reportRows()).toBe(before + 1);
    expect((await latestIdentityBackfillReport(prisma))?.result).toBe('fail');
    expect((await importFeatureState(prisma)).gatePassed).toBe(false);
    // The report names no address.
    const latest = await prisma.auditLog.findFirst({
      where: { action: IDENTITY_BACKFILL_ACTION },
      orderBy: { occurredAt: 'desc' },
    });
    expect(JSON.stringify(latest?.newValue)).not.toContain(frank.split('@')[0]);
    await prisma.delegate.delete({ where: { id: dFrank } });
    await prisma.event.delete({ where: { id: other.id } });
  });

  it('each hard invariant blocks a pass and rolls the transaction back', async () => {
    const addr = email('gina');
    const acct = await account(addr);
    const d = await delegate(addr, acct, 'Gina G');
    for (const invariant of ['H1', 'H2', 'H3', 'H4', 'H5'] as const) {
      const outcome = await runIdentityBackfill(prisma, { forceInvariantFailure: invariant });
      expect(outcome.report.result, invariant).toBe('fail');
      expect(outcome.report.committed, invariant).toBe(false);
      expect(outcome.report.invariants[invariant], invariant).toBe('fail');
      expect(await prisma.delegateIdentity.count(), invariant).toBe(0);
      expect(
        (await prisma.delegate.findUniqueOrThrow({ where: { id: d } })).identityId,
        invariant,
      ).toBeNull();
      expect((await latestIdentityBackfillReport(prisma))?.result, invariant).toBe('fail');
    }
  });

  it('H5 detects a changed registration owner during the run and rolls back', async () => {
    const addr = email('hugo');
    const acct = await account(addr);
    const d = await delegate(addr, acct, 'Hugo H');
    const outcome = await runIdentityBackfill(prisma, {
      beforeVerify: async (tx) => {
        await tx.delegate.update({ where: { id: d }, data: { userAccountId: null } });
      },
    });
    expect(outcome.report.result).toBe('fail');
    expect(outcome.report.invariants.H5).toBe('fail');
    const row = await prisma.delegate.findUniqueOrThrow({ where: { id: d } });
    expect(row.userAccountId).toBe(acct); // rollback restored ownership
    expect(row.identityId).toBeNull();
  });

  it('a report-write failure never yields a pass report or an open gate, and nothing is reconstructed', async () => {
    const addr = email('ivy');
    const acct = await account(addr);
    await delegate(addr, acct, 'Ivy I');
    const before = await reportRows();
    const latestBefore = await latestIdentityBackfillReport(prisma); // append-only: earlier tests' rows remain
    const logged: string[] = [];
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: (_obj: unknown, msg?: string) => {
        logged.push(String(msg));
      },
    };

    const outcome = await runIdentityBackfill(prisma, {
      logger: logger as never,
      writeReport: async () => {
        throw new Error('audit store unavailable');
      },
    });
    expect(outcome.reported).toBe(false);
    expect(outcome.reportId).toBeNull();
    expect(outcome.report.result).toBe('pass'); // in memory only: the backfill itself committed
    expect(outcome.report.committed).toBe(true);
    expect(logged.join(' ')).toMatch(/could not be written/);
    // No report row was written for this run and nothing is reconstructed later: the newest
    // durable report is exactly the one that existed before the run (or none at all).
    expect(await reportRows()).toBe(before);
    const latestAfter = await latestIdentityBackfillReport(prisma);
    expect(latestAfter?.id ?? null).toBe(latestBefore?.id ?? null);
    // The unreported run consumed a run ordinal, so an older pass report is not proof for the
    // current state: the gate stays closed until a later run writes a fresh report (criterion 45c).
    expect(outcome.report.runOrdinal).not.toBeNull();
    expect(await lastStartedRunOrdinal(prisma)).toBe(outcome.report.runOrdinal);
    expect(await lastStartedRunOrdinal(prisma)).toBeGreaterThan(latestBefore?.runOrdinal ?? 0);
    const closed = await importFeatureState(prisma);
    expect(closed.gatePassed).toBe(false);
    expect(closed.uploadsEnabled).toBe(false);
    expect(closed.blockers.join(' ')).toMatch(/has no durable report/);

    const rerun = await runIdentityBackfill(prisma, {});
    expect(rerun.reported).toBe(true);
    expect(rerun.report.result).toBe('pass');
    expect((await latestIdentityBackfillReport(prisma))?.id).toBe(rerun.reportId);
    expect((await importFeatureState(prisma)).gatePassed).toBe(true);
    expect((await importFeatureState(prisma)).uploadsEnabled).toBe(false);
  });

  it('a delayed report of an older run never supersedes a newer run, whatever the write order or timestamps', async () => {
    const addr = email('nina');
    const acct = await account(addr);
    await delegate(addr, acct, 'Nina N');

    // Run A passes but its report write is held back until run B has finished and reported.
    let aInsideTransaction!: () => void;
    const aStarted = new Promise<void>((resolve) => (aInsideTransaction = resolve));
    let releaseA!: () => void;
    const aMayWrite = new Promise<void>((resolve) => (releaseA = resolve));
    const runA = runIdentityBackfill(prisma, {
      beforeVerify: async () => aInsideTransaction(),
      writeReport: async (p, r) => {
        await aMayWrite;
        return writeAuditReport(p, r);
      },
    });
    await aStarted;
    // B waits on the advisory lock until A commits, then fails H1 and reports immediately.
    const outcomeB = await runIdentityBackfill(prisma, { forceInvariantFailure: 'H1' });
    expect(outcomeB.reported).toBe(true);
    expect(outcomeB.report.result).toBe('fail');
    releaseA();
    const outcomeA = await runA;
    expect(outcomeA.reported).toBe(true);
    expect(outcomeA.report.result).toBe('pass');
    expect(outcomeA.report.runOrdinal).toBeLessThan(outcomeB.report.runOrdinal!);

    // A's row was written after B's (later occurred_at), yet B is the newer run and wins.
    const rowA = await prisma.auditLog.findUniqueOrThrow({ where: { id: outcomeA.reportId! } });
    const rowB = await prisma.auditLog.findUniqueOrThrow({ where: { id: outcomeB.reportId! } });
    expect(rowA.occurredAt.getTime()).toBeGreaterThanOrEqual(rowB.occurredAt.getTime());
    const latest = await latestIdentityBackfillReport(prisma);
    expect(latest?.id).toBe(outcomeB.reportId);
    expect(latest?.passed).toBe(false);
    expect((await importFeatureState(prisma)).gatePassed).toBe(false);

    // Timestamp ties: identical occurred_at, the higher ordinal wins regardless of id order.
    const tie = new Date(Date.now() + 60_000);
    const ids: string[] = [];
    for (const ordinal of [outcomeB.report.runOrdinal! + 2, outcomeB.report.runOrdinal! + 1]) {
      const row = await prisma.auditLog.create({
        data: {
          action: IDENTITY_BACKFILL_ACTION,
          entityType: 'migration',
          entityId: 'identity_backfill',
          occurredAt: tie,
          newValue: { result: 'fail', committed: false, dryRun: false, runOrdinal: ordinal },
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    expect((await latestIdentityBackfillReport(prisma))?.id).toBe(ids[0]);
    // Those synthetic rows carry ordinals the sequence never issued, so they can never open the gate.
    expect((await importFeatureState(prisma)).gatePassed).toBe(false);
  });

  it('H5 detects content changes to consents, invitations and audit rows, not only row counts', async () => {
    const addr = email('liam');
    const acct = await account(addr);
    const d = await delegate(addr, acct, 'Liam L');
    const consent = await prisma.consentRecord.create({
      data: { delegateId: d, document: 'privacy', version: 'v1' },
      select: { id: true },
    });
    const invitation = await prisma.invitation.create({
      data: { delegateId: d, tokenHash: randomUUID().replace(/-/g, '') },
      select: { id: true },
    });

    // Same-count updates that the old count-based check could not see.
    const mutations: Array<
      [string, (tx: Parameters<typeof preservationChecksum>[0]) => Promise<unknown>]
    > = [
      [
        'consent version',
        (tx) => tx.consentRecord.update({ where: { id: consent.id }, data: { version: 'v2' } }),
      ],
      [
        'invitation status',
        (tx) =>
          tx.invitation.update({ where: { id: invitation.id }, data: { status: 'accepted' } }),
      ],
      [
        'account status',
        (tx) => tx.userAccount.update({ where: { id: acct }, data: { status: 'inactive' } }),
      ],
    ];
    for (const [label, mutate] of mutations) {
      const outcome = await runIdentityBackfill(prisma, {
        beforeVerify: async (tx) => {
          await mutate(tx);
        },
      });
      expect(outcome.report.invariants.H5, label).toBe('fail');
      expect(outcome.report.committed, label).toBe(false);
    }
    // Rolled back every time: the original contents survive.
    expect(
      (await prisma.consentRecord.findUniqueOrThrow({ where: { id: consent.id } })).version,
    ).toBe('v1');
    expect(
      (await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status,
    ).toBe('pending');
    expect((await prisma.userAccount.findUniqueOrThrow({ where: { id: acct } })).status).toBe(
      'active',
    );

    // The checksum itself: an audit row written inside the transaction changes it.
    await prisma
      .$transaction(async (tx) => {
        const before = await preservationChecksum(tx);
        await tx.auditLog.create({ data: { action: 'test.noise', entityType: 'test' } });
        expect(await preservationChecksum(tx)).not.toBe(before);
        throw new Error('rollback');
      })
      .catch(() => undefined);
  });

  it('H4 accepts only a valid unique non-partial index on exactly the address column', async () => {
    await prisma.$transaction(async (tx) => {
      expect(await uniqueIndexEnforces(tx, 'identity_email', 'email_normalised')).toBe(true);
      // identity_id carries a plain index and a partial unique index: neither enforces global uniqueness.
      expect(await uniqueIndexEnforces(tx, 'identity_email', 'identity_id')).toBe(false);
      expect(await uniqueIndexEnforces(tx, 'identity_email', 'kind')).toBe(false);
      expect(await uniqueIndexEnforces(tx, 'no_such_table', 'email_normalised')).toBe(false);
      // Sanity check on the method itself against a known single-column unique index.
      expect(await uniqueIndexEnforces(tx, 'delegate_identity', 'user_account_id')).toBe(true);
    });
  });

  it('a fail report written after a pass closes the gate, and a pass row without full evidence never opens it', async () => {
    const addr = email('mia');
    const acct = await account(addr);
    await delegate(addr, acct, 'Mia M');

    const pass = await runIdentityBackfill(prisma, {});
    expect(pass.report.result).toBe('pass');
    expect((await latestIdentityBackfillReport(prisma))?.passed).toBe(true);
    expect((await importFeatureState(prisma)).gatePassed).toBe(true);

    // A later run that fails an invariant writes a durable fail report: newest row wins.
    const fail = await runIdentityBackfill(prisma, { forceInvariantFailure: 'H3' });
    expect(fail.reported).toBe(true);
    expect(fail.report.result).toBe('fail');
    const latest = await latestIdentityBackfillReport(prisma);
    expect(latest?.id).toBe(fail.reportId);
    expect(latest?.passed).toBe(false);
    const state = await importFeatureState(prisma);
    expect(state.gatePassed).toBe(false);
    expect(state.uploadsEnabled).toBe(false);
    expect(state.blockers[0]).toMatch(/not a pass/);

    // Rows that claim pass without the required evidence do not open the gate either.
    const bogus = [
      {
        result: 'pass',
        committed: true,
        dryRun: true,
        invariants: { H1: 'pass', H2: 'pass', H3: 'pass', H4: 'pass', H5: 'pass' },
      },
      {
        result: 'pass',
        committed: false,
        dryRun: false,
        invariants: { H1: 'pass', H2: 'pass', H3: 'pass', H4: 'pass', H5: 'pass' },
      },
      {
        result: 'pass',
        committed: true,
        dryRun: false,
        invariants: { H1: 'pass', H2: 'pass', H3: 'pass', H4: 'pass' },
      },
      {
        result: 'pass',
        committed: true,
        dryRun: false,
        invariants: { H1: 'pass', H2: 'skipped', H3: 'pass', H4: 'pass', H5: 'pass' },
      },
      {
        result: 'PASS',
        committed: true,
        dryRun: false,
        invariants: { H1: 'pass', H2: 'pass', H3: 'pass', H4: 'pass', H5: 'pass' },
      },
      {},
    ];
    for (const value of bogus) {
      await prisma.auditLog.create({
        data: {
          action: IDENTITY_BACKFILL_ACTION,
          entityType: 'migration',
          entityId: 'identity_backfill',
          newValue: value,
        },
      });
      expect((await latestIdentityBackfillReport(prisma))?.passed, JSON.stringify(value)).toBe(
        false,
      );
      expect((await importFeatureState(prisma)).gatePassed, JSON.stringify(value)).toBe(false);
    }
    // A genuine pass written after them opens the gate again (and uploads stay disabled regardless).
    const again = await runIdentityBackfill(prisma, {});
    expect(again.report.result).toBe('pass');
    expect((await importFeatureState(prisma)).gatePassed).toBe(true);
    expect((await importFeatureState(prisma)).uploadsEnabled).toBe(false);
  });

  it('a dry run rolls back, writes no report and reports what would happen', async () => {
    const addr = email('jules');
    const acct = await account(addr);
    const d = await delegate(addr, acct, 'Jules J');
    const before = await reportRows();
    const ordinalBefore = await lastStartedRunOrdinal(prisma);
    const outcome = await runIdentityBackfill(prisma, { dryRun: true });
    expect(outcome.reported).toBe(false);
    expect(outcome.report.dryRun).toBe(true);
    expect(outcome.report.committed).toBe(false);
    expect(outcome.report.runOrdinal).toBeNull(); // a dry run is not a run: it never closes the gate
    expect(await lastStartedRunOrdinal(prisma)).toBe(ordinalBefore);
    expect(outcome.report.result).toBe('fail'); // never pass: nothing was committed
    expect(outcome.report.invariants).toEqual({
      H1: 'pass',
      H2: 'pass',
      H3: 'pass',
      H4: 'pass',
      H5: 'pass',
    });
    expect(outcome.report.counts.delegatesLinked).toBeGreaterThanOrEqual(1);
    expect(await prisma.delegateIdentity.count()).toBe(0);
    expect((await prisma.delegate.findUniqueOrThrow({ where: { id: d } })).identityId).toBeNull();
    expect(await reportRows()).toBe(before);
  });

  it('orphan delegate accounts are reported, not linked, and lose their sessions; the admin pre-check fails closed', async () => {
    const orphanAddr = email('orphan');
    const orphan = await account(orphanAddr);
    await prisma.authSession.create({
      data: {
        userAccountId: orphan,
        tokenHash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const outcome = await runIdentityBackfill(prisma, {});
    expect(outcome.report.result).toBe('pass');
    expect(outcome.report.findings.orphanAccounts).toContain(orphan);
    expect(await prisma.delegateIdentity.count({ where: { userAccountId: orphan } })).toBe(0);
    const sessions = await prisma.authSession.findMany({ where: { userAccountId: orphan } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    const missingAdmin = await runIdentityBackfill(prisma, { adminEmail: email('no-such-admin') });
    expect(missingAdmin.report.result).toBe('fail');
    expect(missingAdmin.report.adminCheck).toBe('fail');
    expect(missingAdmin.report.failure?.stage).toBe('admin_precheck');
  });

  it('reports hold counts and ids only (no addresses, no names)', async () => {
    const addr = email('kate');
    const acct = await account(addr);
    await delegate(addr, acct, 'Kate Unusual-Name');
    const outcome = await runIdentityBackfill(prisma, {});
    const text = JSON.stringify(outcome.report satisfies BackfillReport);
    expect(text).not.toContain('kate-');
    expect(text).not.toContain('Unusual-Name');
  });
});
