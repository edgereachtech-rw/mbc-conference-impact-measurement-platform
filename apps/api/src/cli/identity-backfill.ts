/**
 * Identity backfill and migration gate (backlog D6.1).
 *
 *   pnpm --filter @mbc/api identity:backfill -- --dry-run   # classify, verify, roll back, print
 *   pnpm --filter @mbc/api identity:backfill                # run, verify, write the durable report
 *
 * Exit code 0 only when a durable report with result pass was written. A dry run exits 0 when every
 * invariant would pass. Nothing in the printed report is personal data: counts and ids only.
 */
import 'dotenv/config';

import { getPrisma } from '../db.js';
import { getLogger } from '../lib/logger.js';
import { runIdentityBackfill } from '../identity/backfill.js';

const dryRun = process.argv.includes('--dry-run');
const logger = getLogger();
const prisma = getPrisma();

const outcome = await runIdentityBackfill(prisma, {
  dryRun,
  adminEmail: process.env.ADMIN_EMAIL,
  logger,
});

const { report } = outcome;
console.log(
  JSON.stringify(
    {
      result: report.result,
      dryRun: report.dryRun,
      committed: report.committed,
      runOrdinal: report.runOrdinal,
      invariants: report.invariants,
      adminCheck: report.adminCheck,
      counts: report.counts,
      findings: {
        caseA: report.findings.caseA.length,
        caseB1: report.findings.caseB1.length,
        orphanAccounts: report.findings.orphanAccounts.length,
        ambiguousAccounts: report.findings.ambiguousAccounts.length,
        unlinkableDelegates: report.findings.unlinkableDelegates.length,
        retiredRoleAccountsActive: report.findings.retiredRoleAccountsActive,
      },
      failure: report.failure ?? null,
      reported: outcome.reported,
      reportId: outcome.reportId,
      reportError: outcome.reportError ?? null,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
const ok = dryRun
  ? Object.values(report.invariants).every((v) => v === 'pass')
  : outcome.reported && report.result === 'pass';
process.exit(ok ? 0 : 1);
