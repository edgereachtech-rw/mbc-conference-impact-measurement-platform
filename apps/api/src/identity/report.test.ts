import { describe, expect, it } from 'vitest';

import { importFeatureState, latestIdentityBackfillReport, type ReportReader } from './report.js';

/**
 * The gate's reading of the audit log, exercised with a fake reader: the audit log is append-only,
 * so rows that must never open the gate cannot be staged in a shared test database without
 * leaving them there for every later run.
 */
function reader(reportRows: unknown[], sequence: { last_value: bigint; is_called: boolean }) {
  const queryRaw = async (strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('identity_backfill_run_seq')) return [sequence];
    return reportRows;
  };
  return { $queryRaw: queryRaw, auditLog: {} } as unknown as ReportReader;
}

const fullPass = {
  result: 'pass',
  committed: true,
  dryRun: false,
  invariants: { H1: 'pass', H2: 'pass', H3: 'pass', H4: 'pass', H5: 'pass' },
};

describe('migration gate reading (D9, fail closed)', () => {
  it('opens only for a complete pass whose ordinal is the last one the sequence issued', async () => {
    const row = (ordinal: number | null, value: object = fullPass) => ({
      id: 'r1',
      occurred_at: new Date('2026-10-30T00:00:00Z'),
      run_ordinal: ordinal === null ? null : BigInt(ordinal),
      new_value: { ...value, runOrdinal: ordinal },
    });
    expect(
      (await importFeatureState(reader([row(5)], { last_value: 5n, is_called: true }))).gatePassed,
    ).toBe(true);
    // No report at all.
    expect(
      (await importFeatureState(reader([], { last_value: 0n, is_called: false }))).gatePassed,
    ).toBe(false);
    // A newer run started but never reported.
    const unreported = await importFeatureState(
      reader([row(5)], { last_value: 6n, is_called: true }),
    );
    expect(unreported.gatePassed).toBe(false);
    // A row claiming an ordinal the sequence never issued cannot belong to a real run.
    const unissued = await importFeatureState(
      reader([row(9_000_000)], { last_value: 5n, is_called: true }),
    );
    expect(unissued.gatePassed).toBe(false);
    // Pass rows without full evidence, or without an ordinal, never count as passed.
    for (const value of [
      { ...fullPass, dryRun: true },
      { ...fullPass, committed: false },
      { ...fullPass, invariants: { H1: 'pass', H2: 'pass', H3: 'pass', H4: 'pass' } },
      { ...fullPass, result: 'fail' },
    ]) {
      const latest = await latestIdentityBackfillReport(
        reader([row(5, value)], { last_value: 5n, is_called: true }),
      );
      expect(latest?.passed, JSON.stringify(value)).toBe(false);
    }
    const noOrdinal = await latestIdentityBackfillReport(
      reader([row(null)], { last_value: 5n, is_called: true }),
    );
    expect(noOrdinal?.passed).toBe(false);
    // Decision of 2026-10-31: uploads are always on and nothing is reported as blocking, even
    // when the gate itself has not passed.
    const failing = await importFeatureState(reader([], { last_value: 0n, is_called: false }));
    expect(failing.gatePassed).toBe(false);
    expect(failing.uploadsEnabled).toBe(true);
    expect(failing.blockers).toEqual([]);
  });
});
