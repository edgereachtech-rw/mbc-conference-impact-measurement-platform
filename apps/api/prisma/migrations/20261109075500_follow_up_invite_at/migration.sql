-- A follow-up's invitation can be scheduled (decision 2026-11-09): the organisers set when it
-- goes out and the worker sends it then, instead of pressing "Send the invitation" by hand.
ALTER TABLE "assessment_stage_config"
  ADD COLUMN "invite_at" TIMESTAMPTZ(3),
  ADD COLUMN "invites_sent_at" TIMESTAMPTZ(3);
