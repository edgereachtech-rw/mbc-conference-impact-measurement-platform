-- Whether delegates see Transfer Planning (2026-11-08): shown (the default, as before),
-- hidden, or hidden until a date and time. Plans and their data are untouched either way.
CREATE TYPE "transfer_plan_visibility" AS ENUM ('shown', 'hidden', 'scheduled');
ALTER TABLE "event"
  ADD COLUMN "transfer_plan_visibility" "transfer_plan_visibility" NOT NULL DEFAULT 'shown',
  ADD COLUMN "transfer_plan_shown_from" TIMESTAMPTZ(3);
