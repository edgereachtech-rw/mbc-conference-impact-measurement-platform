-- Run ordinal for the identity backfill gate (backlog D6.1, D9). Expand-only: adds one sequence.
--
-- Each non-dry run takes nextval() while holding the gate's advisory lock, so ordinals follow the
-- order in which runs actually executed. nextval() is never rolled back, so a run that fails, is
-- rolled back or crashes still consumed its ordinal. The report reader selects the report with the
-- highest ordinal (never by write time, which can be delayed) and treats an ordinal that has no
-- durable report as an unreported run that keeps the import gate closed until a later run reports.
CREATE SEQUENCE IF NOT EXISTS "identity_backfill_run_seq" AS bigint START WITH 1 INCREMENT BY 1;
