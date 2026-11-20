-- The checklist-and-commitment plan mode (2026-11-20): an event chooses the full Transfer Plan
-- or a checklist with one commitment, where Transfer Planning sits in the journey, and the
-- checklist's wording; a plan keeps the training named and the actions ticked; a reminder can
-- go once, on a chosen date.
CREATE TYPE "transfer_plan_mode" AS ENUM ('full', 'commitment');
CREATE TYPE "transfer_plan_position" AS ENUM ('last', 'before_closing');
ALTER TYPE "reminder_frequency" ADD VALUE 'once';

ALTER TABLE "event"
  ADD COLUMN "transfer_plan_mode" "transfer_plan_mode" NOT NULL DEFAULT 'full',
  ADD COLUMN "transfer_plan_position" "transfer_plan_position" NOT NULL DEFAULT 'last',
  ADD COLUMN "transfer_plan_template" JSONB;

ALTER TABLE "transfer_plan"
  ADD COLUMN "training_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "checklist" JSONB;
