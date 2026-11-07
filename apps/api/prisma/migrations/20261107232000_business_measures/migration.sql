-- Business measures (spec of 2026-11-08). The choice "can you identify a measure?" moves from
-- each measure to the planned action; a measure gains a method and explicit baseline and target
-- states; actual results become dated records with their method, meaning, source and
-- influencing factors; evidence can point at a measure.

CREATE TYPE "baseline_state" AS ENUM ('known', 'not_yet_known');
CREATE TYPE "target_state" AS ENUM ('set', 'not_yet_known', 'not_applicable');
CREATE TYPE "result_source" AS ENUM ('personal_observation', 'workplace_records', 'organisational_data', 'customer_feedback', 'manager_feedback', 'colleague_feedback', 'other');
ALTER TYPE "evidence_type" ADD VALUE IF NOT EXISTS 'process';
ALTER TYPE "evidence_type" ADD VALUE IF NOT EXISTS 'customer_feedback';

-- The action's choice, derived from the measures it had.
ALTER TABLE "transfer_plan_action" ADD COLUMN "measure_status" "measure_status";
UPDATE "transfer_plan_action" a SET "measure_status" = CASE
  WHEN EXISTS (SELECT 1 FROM "transfer_plan_measure" m WHERE m."action_id" = a."id" AND m."status" = 'identified') THEN 'identified'::"measure_status"
  WHEN EXISTS (SELECT 1 FROM "transfer_plan_measure" m WHERE m."action_id" = a."id" AND m."status" = 'not_yet_known') THEN 'not_yet_known'::"measure_status"
  WHEN EXISTS (SELECT 1 FROM "transfer_plan_measure" m WHERE m."action_id" = a."id" AND m."status" = 'not_applicable') THEN 'not_applicable'::"measure_status"
  ELSE NULL END;
-- Placeholder rows ("not yet known" / "not applicable") carried no measure; the action now says it.
DELETE FROM "transfer_plan_measure" WHERE "status" <> 'identified';
ALTER TABLE "transfer_plan_measure" DROP COLUMN "status";

ALTER TABLE "transfer_plan_measure"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "baseline_state" "baseline_state" NOT NULL DEFAULT 'not_yet_known',
  ADD COLUMN "target_state" "target_state" NOT NULL DEFAULT 'not_yet_known';
UPDATE "transfer_plan_measure" SET "baseline_state" = 'known' WHERE "baseline_value" <> '';
UPDATE "transfer_plan_measure" SET "target_state" = 'set' WHERE "target_value" <> '';

-- Readings become result records.
ALTER TABLE "transfer_plan_measure_reading" RENAME TO "transfer_plan_measure_result";
ALTER TABLE "transfer_plan_measure_result" RENAME COLUMN "reading_on" TO "result_on";
ALTER INDEX IF EXISTS "transfer_plan_measure_reading_measure_id_idx" RENAME TO "transfer_plan_measure_result_measure_id_idx";
ALTER TABLE "transfer_plan_measure_result" RENAME CONSTRAINT "transfer_plan_measure_reading_pkey" TO "transfer_plan_measure_result_pkey";
ALTER TABLE "transfer_plan_measure_result" RENAME CONSTRAINT "transfer_plan_measure_reading_measure_id_fkey" TO "transfer_plan_measure_result_measure_id_fkey";
ALTER TABLE "transfer_plan_measure_result"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "meaning" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "is_final" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source_type" "result_source" NOT NULL DEFAULT 'other',
  ADD COLUMN "has_influences" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "influences" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "measure_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "measure_kind" "measure_kind" NOT NULL DEFAULT 'quantitative',
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- The latest result so far lived only on the measure; it becomes a record like the others.
INSERT INTO "transfer_plan_measure_result"
  ("measure_id", "value", "result_on", "source", "support", "has_influences", "influences", "measure_name", "measure_kind", "unit", "recorded_at", "updated_at")
SELECT m."id", m."actual_value", m."actual_on", m."source", m."support", m."influences" <> '', m."influences", m."name", m."kind", m."unit", m."updated_at", m."updated_at"
FROM "transfer_plan_measure" m WHERE m."actual_value" <> '';
UPDATE "transfer_plan_measure_result" r SET "measure_name" = m."name", "measure_kind" = m."kind", "unit" = m."unit"
FROM "transfer_plan_measure" m WHERE r."measure_id" = m."id" AND r."measure_name" = '';

-- Evidence may support one measure.
ALTER TABLE "transfer_plan_evidence" ADD COLUMN "measure_id" UUID;
ALTER TABLE "transfer_plan_evidence" ADD CONSTRAINT "transfer_plan_evidence_measure_id_fkey"
  FOREIGN KEY ("measure_id") REFERENCES "transfer_plan_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "transfer_plan_evidence_measure_id_idx" ON "transfer_plan_evidence"("measure_id");
