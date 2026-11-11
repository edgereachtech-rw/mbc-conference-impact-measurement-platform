-- Reminders belong to each planned action (decision 2026-11-11), not to the plan. A plan's
-- preference is carried over to its written actions, so nobody's reminders stop on deploy; a
-- finished action (completed, applied, applied consistently) gets none, as the job would skip it.
ALTER TABLE "transfer_plan_action"
  ADD COLUMN "reminder_frequency" "reminder_frequency" NOT NULL DEFAULT 'none',
  ADD COLUMN "reminder_start_on" DATE,
  ADD COLUMN "reminder_end_on" DATE,
  ADD COLUMN "reminder_time" TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN "reminder_days" SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN "next_reminder_at" TIMESTAMPTZ(3);
UPDATE "transfer_plan_action" a
SET "reminder_frequency" = p."reminder_frequency",
    "reminder_start_on" = p."reminder_start_on",
    "reminder_end_on" = p."reminder_end_on",
    "reminder_time" = p."reminder_time",
    "reminder_days" = p."reminder_days",
    "next_reminder_at" = p."next_reminder_at"
FROM "transfer_plan" p
WHERE a."plan_id" = p."id"
  AND p."status" <> 'completed'
  AND btrim(a."action") <> ''
  AND a."progress_status" NOT IN ('completed', 'applied', 'applied_consistently');
CREATE INDEX "transfer_plan_action_next_reminder_at_idx" ON "transfer_plan_action"("next_reminder_at");

ALTER TABLE "transfer_plan_reminder_log" ADD COLUMN "action_id" UUID;
ALTER TABLE "transfer_plan_reminder_log"
  ADD CONSTRAINT "transfer_plan_reminder_log_action_id_fkey"
  FOREIGN KEY ("action_id") REFERENCES "transfer_plan_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "transfer_plan_reminder_log_action_id_idx" ON "transfer_plan_reminder_log"("action_id");

DROP INDEX IF EXISTS "transfer_plan_next_reminder_at_idx";
ALTER TABLE "transfer_plan"
  DROP COLUMN "reminder_frequency",
  DROP COLUMN "reminder_start_on",
  DROP COLUMN "reminder_end_on",
  DROP COLUMN "reminder_time",
  DROP COLUMN "reminder_days",
  DROP COLUMN "next_reminder_at";
