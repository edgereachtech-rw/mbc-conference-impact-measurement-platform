import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { normaliseEmail } from '../lib/email.js';
import type { Logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';
import { IDENTITY_BACKFILL_ACTION } from './report.js';

/**
 * Identity backfill and migration gate (backlog D6.1 steps 2 to 7, D5.1).
 *
 * One run, inside one transaction serialised by an advisory lock:
 *   1. snapshot the ownership-relevant data (H5 baseline);
 *   2. classify every delegate registration and delegate account into an identity, a current,
 *      historical or provisional address, or a finding (Case A, Case B1, orphan, ambiguous);
 *   3. stop before writing anything when a Case B1 collision exists (H1 cannot hold);
 *   4. write identities, addresses and links;
 *   5. verify H1 to H5; any failure or a dry run rolls the transaction back.
 * Afterwards, outside that transaction, the durable report is written (D9): exactly one
 * `migration.identity_backfill` audit row with result pass or fail. A pass needs every invariant to
 * pass and the transaction to have committed; if the report cannot be written the run is reported
 * to the caller as failed and the error is logged and captured, and nothing is reconstructed later.
 *
 * Names are never used to merge identities. Registration ownership (user_account_id) is never
 * changed. Addresses are never discarded to satisfy uniqueness: a collision fails the gate.
 */

export const INVARIANTS = ['H1', 'H2', 'H3', 'H4', 'H5'] as const;
export type Invariant = (typeof INVARIANTS)[number];
export type InvariantResult = 'pass' | 'fail' | 'skipped';

/** Advisory lock key so two gate runs never interleave (D5.1 invariant 9). */
export const BACKFILL_LOCK_KEY = 'identity:backfill';

export interface BackfillOptions {
  /** Classify and verify, then roll back and print; writes no audit report (D6.1 step 2). */
  dryRun?: boolean;
  /** The M.Bryan admin that must still be active and able to sign in after the run. */
  adminEmail?: string;
  now?: () => Date;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Test hook: runs inside the transaction after the writes and before verification. */
  beforeVerify?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Test hook: simulates a stored violation of one invariant during verification. */
  forceInvariantFailure?: Invariant;
  /** Test hook: replaces the durable report writer. Returns the audit row id. */
  writeReport?: (prisma: PrismaClient, report: BackfillReport) => Promise<string>;
}

export interface BackfillFindings {
  /** Delegate ids whose stale address was reserved provisionally for their account's identity. */
  caseA: string[];
  /** Addresses claimed by more than one identity in stored data: the gate fails (H1). */
  caseB1: Array<{ addressHash: string; claimants: string[]; delegateIds: string[] }>;
  /** Delegate-role accounts with no registration: reported, never linked. */
  orphanAccounts: string[];
  /** Delegate-role accounts whose email matches more than one identity candidate. */
  ambiguousAccounts: string[];
  /** Registrations whose owner could not be established (H2). */
  unlinkableDelegates: string[];
  /** Accounts still holding a retired role and active; reported for D8 item 7, not an invariant here. */
  retiredRoleAccountsActive: number;
}

export interface BackfillCounts {
  delegates: number;
  delegateAccounts: number;
  identitiesCreated: number;
  identitiesReused: number;
  addressesCurrent: number;
  addressesHistoricalVerified: number;
  addressesProvisional: number;
  delegatesLinked: number;
  accountsLinked: number;
  sessionsRevoked: number;
}

export interface BackfillReport {
  result: 'pass' | 'fail';
  dryRun: boolean;
  committed: boolean;
  /**
   * Position of this run in the serialised run order, taken from identity_backfill_run_seq while
   * holding the gate lock. Null for dry runs and for runs stopped before the lock was taken. The
   * report reader orders by this value, never by write time, so a delayed report of an older run
   * can never supersede a newer run's report.
   */
  runOrdinal: number | null;
  startedAt: string;
  finishedAt: string;
  invariants: Record<Invariant, InvariantResult>;
  adminCheck: 'pass' | 'fail' | 'skipped';
  counts: BackfillCounts;
  findings: BackfillFindings;
  failure?: { stage: string; message: string };
}

export interface BackfillOutcome {
  report: BackfillReport;
  /** Audit row id of the durable report, or null when none was written (dry run or write failure). */
  reportId: string | null;
  /** False when the report could not be written: the run must be treated as failed. */
  reported: boolean;
  reportError?: string;
}

class GateStop extends Error {
  constructor(
    public readonly stage: string,
    message: string,
    public readonly partial?: Partial<BackfillReport>,
  ) {
    super(message);
    this.name = 'GateStop';
  }
}

const RETIRED_ROLES = ['analyst', 'support'] as const;
const EMAIL_CHANGE_ACTION = 'identity.email_changed';

function emptyCounts(): BackfillCounts {
  return {
    delegates: 0,
    delegateAccounts: 0,
    identitiesCreated: 0,
    identitiesReused: 0,
    addressesCurrent: 0,
    addressesHistoricalVerified: 0,
    addressesProvisional: 0,
    delegatesLinked: 0,
    accountsLinked: 0,
    sessionsRevoked: 0,
  };
}

function emptyFindings(): BackfillFindings {
  return {
    caseA: [],
    caseB1: [],
    orphanAccounts: [],
    ambiguousAccounts: [],
    unlinkableDelegates: [],
    retiredRoleAccountsActive: 0,
  };
}

function skippedInvariants(): Record<Invariant, InvariantResult> {
  return { H1: 'skipped', H2: 'skipped', H3: 'skipped', H4: 'skipped', H5: 'skipped' };
}

/** Addresses never appear in the report; a short hash identifies a collision for investigation. */
function addressHash(email: string): string {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * Preservation checksum for H5. Registrations and accounts are hashed over the columns that say
 * which person a record belongs to (the run itself writes delegate.identity_id, which is therefore
 * left out). Consents, invitations and audit rows are hashed over their complete row contents, so
 * any insert, update or delete in those tables during the run, not only a change in row count, is
 * detected. The hash is computed inside the transaction before and after the writes.
 */
export async function preservationChecksum(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ h: string }>>`
    SELECT md5(
      coalesce((SELECT string_agg(
        id::text || '|' || event_id::text || '|' || email || '|' || coalesce(user_account_id::text, '') || '|'
          || registration_status::text || '|' || coalesce(duplicate_of_id::text, ''),
        ',' ORDER BY id) FROM delegate), '')
      || '#' || coalesce((SELECT string_agg(id::text || '|' || email || '|' || role::text || '|' || status::text, ',' ORDER BY id) FROM user_account), '')
      || '#' || coalesce((SELECT string_agg(c::text, ',' ORDER BY id) FROM consent_record c), '')
      || '#' || coalesce((SELECT string_agg(i::text, ',' ORDER BY id) FROM invitation i), '')
      || '#' || coalesce((SELECT string_agg(a::text, ',' ORDER BY id) FROM audit_log a), '')
    ) AS h`;
  return rows[0]?.h ?? '';
}

/**
 * H4: the database itself enforces one owner per address. True only when a valid, ready, unique,
 * non-partial, non-expression index exists on exactly the given column of the given table in the
 * current schema. The index name is irrelevant: a renamed, partial or invalid index does not count.
 */
export async function uniqueIndexEnforces(
  tx: Prisma.TransactionClient,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
    WHERE ns.nspname = current_schema()
      AND t.relname = ${table}
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND a.attname = ${column}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Default durable writer: one audit row, outside the backfill transaction (D9). */
export async function writeAuditReport(
  prisma: PrismaClient,
  report: BackfillReport,
): Promise<string> {
  const row = await prisma.auditLog.create({
    data: {
      action: IDENTITY_BACKFILL_ACTION,
      entityType: 'migration',
      entityId: 'identity_backfill',
      actorUserId: null,
      newValue: report as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return row.id;
}

export async function runIdentityBackfill(
  prisma: PrismaClient,
  options: BackfillOptions = {},
): Promise<BackfillOutcome> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const dryRun = options.dryRun ?? false;
  const logger = options.logger;

  let committed = false;
  let invariants = skippedInvariants();
  let counts = emptyCounts();
  let findings = emptyFindings();
  let adminCheck: BackfillReport['adminCheck'] = 'skipped';
  let failure: BackfillReport['failure'];
  let runOrdinal: number | null = null;

  try {
    // Pre-check: the intended admin must exist and be active before anything else happens.
    if (options.adminEmail) {
      const admin = await prisma.userAccount.findFirst({
        where: { email: normaliseEmail(options.adminEmail), role: 'admin', status: 'active' },
        select: { id: true },
      });
      adminCheck = admin ? 'pass' : 'fail';
      if (!admin)
        throw new GateStop('admin_precheck', 'intended admin account is missing or inactive');
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BACKFILL_LOCK_KEY}))`;
        if (!dryRun) {
          // Under the lock, so ordinals follow run order; nextval() survives the rollback below.
          const seq = await tx.$queryRaw<Array<{ n: bigint }>>`
            SELECT nextval('identity_backfill_run_seq')::bigint AS n`;
          runOrdinal = Number(seq[0]?.n);
          if (!Number.isSafeInteger(runOrdinal)) {
            throw new GateStop('run_ordinal', 'run ordinal could not be assigned');
          }
        }
        const baseline = await preservationChecksum(tx);

        const work = await classifyAndWrite(tx, now());
        counts = work.counts;
        findings = work.findings;
        if (findings.caseB1.length > 0) {
          throw new GateStop('classification', 'stored cross-identity collision (Case B1)', {
            invariants: { ...skippedInvariants(), H1: 'fail' },
          });
        }
        if (findings.unlinkableDelegates.length > 0) {
          throw new GateStop('classification', 'registration ownership cannot be established', {
            invariants: { ...skippedInvariants(), H2: 'fail' },
          });
        }

        await options.beforeVerify?.(tx);

        invariants = await verify(tx, baseline, options.forceInvariantFailure);
        if (INVARIANTS.some((k) => invariants[k] !== 'pass')) {
          throw new GateStop('verification', 'hard invariant failed');
        }
        if (dryRun) throw new GateStop('dry_run', 'dry run: rolled back by design');
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    committed = true;
  } catch (error) {
    if (error instanceof GateStop) {
      if (error.partial?.invariants) invariants = error.partial.invariants;
      if (error.stage !== 'dry_run') failure = { stage: error.stage, message: error.message };
    } else {
      // A constraint violation or infrastructure error: the transaction is already rolled back.
      failure = {
        stage: 'transaction',
        message: error instanceof Error ? error.name : 'unknown error',
      };
      logger?.error({ stage: 'transaction', name: failure.message }, 'identity backfill failed');
    }
  }

  const allPass = INVARIANTS.every((k) => invariants[k] === 'pass');
  const report: BackfillReport = {
    result: committed && allPass && !dryRun ? 'pass' : 'fail',
    dryRun,
    committed,
    runOrdinal,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    invariants,
    adminCheck,
    counts,
    findings,
    ...(failure ? { failure } : {}),
  };

  if (dryRun) {
    logger?.info({ report: summarise(report) }, 'identity backfill dry run (no report written)');
    return { report, reportId: null, reported: false };
  }

  // Durable report, outside the (possibly rolled back) transaction, from the in-memory result.
  const writeReport = options.writeReport ?? writeAuditReport;
  try {
    const reportId = await writeReport(prisma, report);
    logger?.info({ reportId, result: report.result, invariants }, 'identity backfill reported');
    return { report, reportId, reported: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    logger?.error(
      { result: report.result, invariants, reason: message },
      'identity backfill report could not be written; run must be treated as failed',
    );
    captureException(error, { requestId: 'identity-backfill' });
    return { report, reportId: null, reported: false, reportError: message };
  }
}

function summarise(report: BackfillReport) {
  return { result: report.result, invariants: report.invariants, counts: report.counts };
}

// ---------------------------------------------------------------------------------------------
// Classification and writes (inside the transaction)

interface Claim {
  identityKey: string;
  kind: 'current' | 'historical' | 'provisional';
  evidence: 'backfill' | 'verified' | 'unverified';
  auditLogId: string | null;
  delegateId?: string;
}

async function classifyAndWrite(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<{ counts: BackfillCounts; findings: BackfillFindings }> {
  const counts = emptyCounts();
  const findings = emptyFindings();

  const delegates = await tx.delegate.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      userAccountId: true,
      identityId: true,
      registrationStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const accounts = await tx.userAccount.findMany({
    select: { id: true, email: true, role: true, status: true, identity: { select: { id: true } } },
  });
  const existingAddresses = await tx.identityEmail.findMany({
    select: { identityId: true, emailNormalised: true, kind: true },
  });
  const evidenceRows = await tx.auditLog.findMany({
    where: { action: EMAIL_CHANGE_ACTION, entityType: 'user_account' },
    select: { id: true, entityId: true, oldValue: true, newValue: true },
  });

  counts.delegates = delegates.length;
  const delegateAccounts = accounts.filter((a) => a.role === 'delegate');
  counts.delegateAccounts = delegateAccounts.length;
  findings.retiredRoleAccountsActive = accounts.filter(
    (a) => (RETIRED_ROLES as readonly string[]).includes(a.role) && a.status === 'active',
  ).length;

  // Verified evidence (H3): an identity.email_changed entry counts only for the account it names
  // (entity_type user_account, entity_id = that account) and only for the exact old -> new pair it
  // records, compared after normalisation. Another account's identical change proves nothing here.
  const verified = new Map<string, { to: string; auditLogId: string }>();
  const evidenceKey = (accountId: string, oldEmail: string) => `${accountId}|${oldEmail}`;
  for (const row of evidenceRows) {
    const oldEmail = (row.oldValue as { email?: unknown } | null)?.email;
    const newEmail = (row.newValue as { email?: unknown } | null)?.email;
    if (!row.entityId || typeof oldEmail !== 'string' || typeof newEmail !== 'string') continue;
    verified.set(evidenceKey(row.entityId, normaliseEmail(oldEmail)), {
      to: normaliseEmail(newEmail),
      auditLogId: row.id,
    });
  }

  // Identity candidates: one per delegate-role account (keyed "acct:<id>") and one per address
  // that no account owns (keyed "addr:<email>"). Existing identities are reused, never duplicated.
  const accountById = new Map(delegateAccounts.map((a) => [a.id, a]));
  const accountByEmail = new Map<string, (typeof delegateAccounts)[number]>();
  for (const a of delegateAccounts) accountByEmail.set(normaliseEmail(a.email), a);

  const claims = new Map<string, Claim[]>();
  const addClaim = (email: string, claim: Claim) => {
    const list = claims.get(email) ?? [];
    list.push(claim);
    claims.set(email, list);
  };
  const identityDisplayName = new Map<string, string>();
  const delegateOwner = new Map<string, string>(); // delegate id -> identity key

  // Existing address rows are claims by their identity (idempotent reruns, prior admin decisions).
  for (const row of existingAddresses) {
    addClaim(row.emailNormalised, {
      identityKey: `id:${row.identityId}`,
      kind: row.kind,
      evidence: 'backfill',
      auditLogId: null,
    });
  }

  for (const a of delegateAccounts) {
    const key = a.identity ? `id:${a.identity.id}` : `acct:${a.id}`;
    addClaim(normaliseEmail(a.email), {
      identityKey: key,
      kind: 'current',
      evidence: 'backfill',
      auditLogId: null,
    });
  }

  for (const d of delegates) {
    const email = normaliseEmail(d.email);
    if (d.identityId) {
      // Already linked by an earlier run: its identity owns the address it was imported with.
      delegateOwner.set(d.id, `id:${d.identityId}`);
      continue;
    }
    const linkedAccount = d.userAccountId ? accountById.get(d.userAccountId) : undefined;
    if (linkedAccount) {
      const key = linkedAccount.identity
        ? `id:${linkedAccount.identity.id}`
        : `acct:${linkedAccount.id}`;
      delegateOwner.set(d.id, key);
      if (!identityDisplayName.has(key)) identityDisplayName.set(key, d.name);
      const accountEmail = normaliseEmail(linkedAccount.email);
      if (email !== accountEmail) {
        const proof = verified.get(evidenceKey(linkedAccount.id, email));
        if (proof && proof.to === accountEmail) {
          addClaim(email, {
            identityKey: key,
            kind: 'historical',
            evidence: 'verified',
            auditLogId: proof.auditLogId,
            delegateId: d.id,
          });
        } else {
          // Case A: evidence incomplete, stored state consistent; reserve, never treat as verified.
          addClaim(email, {
            identityKey: key,
            kind: 'provisional',
            evidence: 'unverified',
            auditLogId: null,
            delegateId: d.id,
          });
          findings.caseA.push(d.id);
        }
      }
      continue;
    }
    // No account link: the address itself identifies the person (one identity per address).
    const owningAccount = accountByEmail.get(email);
    const key = owningAccount
      ? owningAccount.identity
        ? `id:${owningAccount.identity.id}`
        : `acct:${owningAccount.id}`
      : `addr:${email}`;
    delegateOwner.set(d.id, key);
    if (!identityDisplayName.has(key)) identityDisplayName.set(key, d.name);
    if (!owningAccount) {
      addClaim(email, {
        identityKey: key,
        kind: 'current',
        evidence: 'backfill',
        auditLogId: null,
        delegateId: d.id,
      });
    }
  }

  // Case B1: one address claimed by two identities in stored data. Nothing is written.
  for (const [email, list] of claims) {
    const claimants = [...new Set(list.map((c) => c.identityKey))];
    if (claimants.length > 1) {
      findings.caseB1.push({
        addressHash: addressHash(email),
        claimants,
        delegateIds: list.map((c) => c.delegateId).filter((x): x is string => Boolean(x)),
      });
    }
  }
  for (const d of delegates) if (!delegateOwner.has(d.id)) findings.unlinkableDelegates.push(d.id);
  // Orphan accounts: delegate-role accounts that own no registration and claim nothing else.
  for (const a of delegateAccounts) {
    const key = a.identity ? `id:${a.identity.id}` : `acct:${a.id}`;
    const ownsSomething = [...delegateOwner.values()].includes(key);
    if (!ownsSomething && !a.identity) findings.orphanAccounts.push(a.id);
  }
  if (findings.caseB1.length > 0 || findings.unlinkableDelegates.length > 0) {
    return { counts, findings };
  }

  // Writes: identities (reuse existing), addresses (skip existing), links.
  const identityIdByKey = new Map<string, string>();
  for (const a of delegateAccounts)
    if (a.identity) identityIdByKey.set(`id:${a.identity.id}`, a.identity.id);
  for (const row of existingAddresses) identityIdByKey.set(`id:${row.identityId}`, row.identityId);

  const keysNeeded = new Set<string>([
    ...delegateOwner.values(),
    ...[...claims.values()].flat().map((c) => c.identityKey),
  ]);
  for (const key of keysNeeded) {
    if (identityIdByKey.has(key)) {
      counts.identitiesReused += 1;
      continue;
    }
    if (key.startsWith('id:')) {
      identityIdByKey.set(key, key.slice(3));
      counts.identitiesReused += 1;
      continue;
    }
    const accountId = key.startsWith('acct:') ? key.slice(5) : null;
    // Orphan accounts get no identity: they own nothing and are reported instead (step 4).
    if (accountId && findings.orphanAccounts.includes(accountId)) continue;
    const displayName =
      identityDisplayName.get(key) ??
      (accountId ? (accountById.get(accountId)?.email ?? 'delegate') : 'delegate');
    const created = await tx.delegateIdentity.create({
      data: { displayName, userAccountId: accountId },
      select: { id: true },
    });
    identityIdByKey.set(key, created.id);
    counts.identitiesCreated += 1;
    if (accountId) counts.accountsLinked += 1;
  }

  const existingSet = new Set(existingAddresses.map((r) => r.emailNormalised));
  for (const [email, list] of claims) {
    if (existingSet.has(email)) continue;
    const claim = list[0]!;
    const identityId = identityIdByKey.get(claim.identityKey);
    if (!identityId) continue; // orphan account: nothing created, nothing reserved
    await tx.identityEmail.create({
      data: {
        identityId,
        emailNormalised: email,
        kind: claim.kind,
        evidence: claim.evidence,
        auditLogId: claim.auditLogId,
      },
    });
    if (claim.kind === 'current') counts.addressesCurrent += 1;
    else if (claim.kind === 'historical') counts.addressesHistoricalVerified += 1;
    else counts.addressesProvisional += 1;
  }

  for (const d of delegates) {
    if (d.identityId) continue;
    const identityId = identityIdByKey.get(delegateOwner.get(d.id)!);
    if (!identityId) {
      findings.unlinkableDelegates.push(d.id);
      continue;
    }
    await tx.delegate.update({ where: { id: d.id }, data: { identityId } });
    counts.delegatesLinked += 1;
  }

  // Unlinked delegate accounts cannot sign in; their sessions must not outlive that (step 6).
  if (findings.orphanAccounts.length > 0) {
    const revoked = await tx.authSession.updateMany({
      where: { userAccountId: { in: findings.orphanAccounts }, revokedAt: null },
      data: { revokedAt: now },
    });
    counts.sessionsRevoked = revoked.count;
  }

  return { counts, findings };
}

// ---------------------------------------------------------------------------------------------
// Verification (inside the transaction)

async function verify(
  tx: Prisma.TransactionClient,
  baseline: string,
  force?: Invariant,
): Promise<Record<Invariant, InvariantResult>> {
  const out = skippedInvariants();

  const dup = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM (
      SELECT email_normalised FROM identity_email GROUP BY email_normalised HAVING count(DISTINCT identity_id) > 1
    ) d`;
  out.H1 = Number(dup[0]?.n ?? 0) === 0 ? 'pass' : 'fail';

  const unlinked = await tx.delegate.count({ where: { identityId: null } });
  out.H2 = unlinked === 0 ? 'pass' : 'fail';

  const unproven = await tx.identityEmail.count({
    where: { kind: 'historical', evidence: { notIn: ['verified', 'admin_decision'] } },
  });
  // Exactly one current address per identity: neither several nor none.
  const multiCurrent = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM (
      SELECT identity_id FROM identity_email WHERE kind = 'current' GROUP BY identity_id HAVING count(*) > 1
    ) d`;
  const noCurrent = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM delegate_identity di
    WHERE NOT EXISTS (
      SELECT 1 FROM identity_email e WHERE e.identity_id = di.id AND e.kind = 'current'
    )`;
  out.H3 =
    unproven === 0 && Number(multiCurrent[0]?.n ?? 0) === 0 && Number(noCurrent[0]?.n ?? 0) === 0
      ? 'pass'
      : 'fail';

  out.H4 = (await uniqueIndexEnforces(tx, 'identity_email', 'email_normalised')) ? 'pass' : 'fail';

  out.H5 = (await preservationChecksum(tx)) === baseline ? 'pass' : 'fail';

  if (force) out[force] = 'fail';
  return out;
}
