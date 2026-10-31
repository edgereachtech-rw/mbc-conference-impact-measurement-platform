import type { PrismaClient } from '../generated/prisma/client.js';

/** Audit action of the durable migration-gate report (backlog D9). */
export const IDENTITY_BACKFILL_ACTION = 'migration.identity_backfill';

const REQUIRED_INVARIANTS = ['H1', 'H2', 'H3', 'H4', 'H5'] as const;

/** The audit log plus raw SQL, which the ordinal ordering and the sequence read need. */
export type ReportReader = Pick<PrismaClient, 'auditLog' | '$queryRaw'>;

export interface StoredBackfillReport {
  id: string;
  occurredAt: Date;
  /** Run ordinal recorded in the report, or null when the row carries none. */
  runOrdinal: number | null;
  /** Stored result; anything other than the literal pass is read as fail. */
  result: 'pass' | 'fail';
  invariants: Record<string, string>;
  /**
   * True only when the stored row says pass, carries a run ordinal, was committed, was not a dry
   * run, and records every one of H1 to H5 as pass. A row that claims pass without that evidence
   * does not open the gate.
   */
  passed: boolean;
}

interface ReportRow {
  id: string;
  occurred_at: Date;
  run_ordinal: bigint | null;
  new_value: unknown;
}

/**
 * The durable report of the newest run, read from the audit log only. Nothing is ever
 * reconstructed from memory, logs or application state: if no report row exists, there is no
 * report. "Newest" means the highest run ordinal (assigned under the gate lock in run order), so a
 * report written late for an older run never supersedes a newer run's report; rows without a
 * numeric ordinal sort last, and write time and id only break ties among those.
 */
export async function latestIdentityBackfillReport(
  prisma: ReportReader,
): Promise<StoredBackfillReport | null> {
  const rows = await prisma.$queryRaw<ReportRow[]>`
    SELECT id, occurred_at, new_value,
      CASE WHEN new_value->>'runOrdinal' ~ '^[0-9]{1,18}$'
           THEN (new_value->>'runOrdinal')::bigint END AS run_ordinal
    FROM audit_log
    WHERE action = ${IDENTITY_BACKFILL_ACTION}
    ORDER BY run_ordinal DESC NULLS LAST, occurred_at DESC, id DESC
    LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  const value = (row.new_value ?? {}) as {
    result?: unknown;
    invariants?: unknown;
    committed?: unknown;
    dryRun?: unknown;
  };
  const runOrdinal = row.run_ordinal === null ? null : Number(row.run_ordinal);
  const result = value.result === 'pass' ? 'pass' : 'fail';
  const invariants =
    value.invariants && typeof value.invariants === 'object'
      ? (value.invariants as Record<string, string>)
      : {};
  const passed =
    result === 'pass' &&
    runOrdinal !== null &&
    value.committed === true &&
    value.dryRun === false &&
    REQUIRED_INVARIANTS.every((k) => invariants[k] === 'pass');
  return { id: row.id, occurredAt: row.occurred_at, runOrdinal, result, invariants, passed };
}

/** Ordinal of the last run that started (0 when none has): nextval() survives rollback and crash. */
export async function lastStartedRunOrdinal(prisma: ReportReader): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ last_value: bigint; is_called: boolean }>>`
    SELECT last_value, is_called FROM identity_backfill_run_seq`;
  const row = rows[0];
  if (!row || !row.is_called) return 0;
  return Number(row.last_value);
}

export interface ImportFeatureState {
  /**
   * True only when the newest run has a durable report, that report is a pass, and no later run
   * started without leaving a report (a crash or a failed report write keeps the gate closed).
   */
  gatePassed: boolean;
  /** Uploads are allowed unconditionally (decision of 2026-10-31). */
  uploadsEnabled: true;
  /** Kept in the shape for the admin screens; always empty now that nothing gates an upload. */
  blockers: string[];
}

/**
 * State of the import feature. The backfill report is still read and still reported through
 * `gatePassed`, because knowing whether the identity invariants ever passed is useful, but it no
 * longer holds anything back: by the decision of 2026-10-31 uploads are always allowed and the
 * blocker list is empty. The gates this used to raise (backlog D9, D6.1, OQ-22) are recorded in
 * docs/backlog.md as waived.
 */
export async function importFeatureState(prisma: ReportReader): Promise<ImportFeatureState> {
  const [latest, lastStarted] = await Promise.all([
    latestIdentityBackfillReport(prisma),
    lastStartedRunOrdinal(prisma),
  ]);
  const unreported = lastStarted > (latest?.runOrdinal ?? 0);
  // A report whose ordinal the sequence never issued cannot belong to a real run.
  const unissued = (latest?.runOrdinal ?? 0) > lastStarted;
  return {
    gatePassed: latest?.passed === true && !unreported && !unissued,
    uploadsEnabled: true,
    blockers: [],
  };
}
