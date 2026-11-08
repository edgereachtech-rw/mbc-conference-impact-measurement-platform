-- Progress is measured by the follow-ups (2026-11-08): each 30, 60, 90-day or longer-term
-- follow-up records one status per planned action, with the explanation the status asks for and
-- the date of the application or completion. The plan page no longer records progress itself.
ALTER TABLE "transfer_plan_progress"
  ADD COLUMN "follow_up_wave" INTEGER,
  ADD COLUMN "wave_label" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "occurred_on" DATE;
CREATE UNIQUE INDEX "transfer_plan_progress_action_id_follow_up_wave_key"
  ON "transfer_plan_progress"("action_id", "follow_up_wave");
