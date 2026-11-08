-- Evidence types are exactly the five the brief names (decision 2026-11-08):
--   an example of what they did differently, a completed work product or process, a manager's or
--   stakeholder's confirmation, a relevant organisational measure, a case example.
-- The three other values leave. Existing rows move to the nearest brief type and keep their
-- description, which says what the evidence was in the delegate's words.
UPDATE "transfer_plan_evidence" SET "type" = 'work_product' WHERE "type" = 'process';
UPDATE "transfer_plan_evidence" SET "type" = 'confirmation' WHERE "type" = 'customer_feedback';
UPDATE "transfer_plan_evidence" SET "type" = 'example' WHERE "type" = 'other';

ALTER TYPE "evidence_type" RENAME TO "evidence_type_old";
CREATE TYPE "evidence_type" AS ENUM ('example', 'work_product', 'confirmation', 'organisational_measure', 'case_example');
ALTER TABLE "transfer_plan_evidence"
  ALTER COLUMN "type" DROP DEFAULT,
  ALTER COLUMN "type" TYPE "evidence_type" USING ("type"::text::"evidence_type"),
  ALTER COLUMN "type" SET DEFAULT 'example';
DROP TYPE "evidence_type_old";
