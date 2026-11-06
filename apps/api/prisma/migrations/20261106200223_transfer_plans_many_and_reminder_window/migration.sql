-- Several Transfer Plans per delegate, a completed state, and reminder preferences with a
-- window, a time of day and chosen weekdays (2026-11-06).

-- New states and frequencies. ADD VALUE is safe inside the migration: nothing here uses them.
ALTER TYPE "transfer_plan_status" ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE "reminder_frequency" ADD VALUE IF NOT EXISTS 'daily';
ALTER TYPE "reminder_frequency" ADD VALUE IF NOT EXISTS 'every_other_day';
ALTER TYPE "reminder_frequency" ADD VALUE IF NOT EXISTS 'twice_weekly';

-- A delegate may now hold several plans for one event, numbered in the order they were made.
-- Every existing plan is that delegate's first.
ALTER TABLE "transfer_plan"
  ADD COLUMN "reminder_end_on" DATE,
  ADD COLUMN "reminder_time" TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN "reminder_days" SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "completed_at" TIMESTAMPTZ(3);

DROP INDEX "transfer_plan_event_id_delegate_id_key";
CREATE UNIQUE INDEX "transfer_plan_event_id_delegate_id_sequence_key" ON "transfer_plan"("event_id", "delegate_id", "sequence");
CREATE INDEX "transfer_plan_event_id_delegate_id_idx" ON "transfer_plan"("event_id", "delegate_id");

-- Which kind of reminder each log row records: the regular one, or the last-days notice.
ALTER TABLE "transfer_plan_reminder_log" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'reminder';
