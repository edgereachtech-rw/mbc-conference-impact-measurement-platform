-- Follow-up questions carry an explicit flag for the Support page (decision 2026-11-09): none,
-- support requested, or barrier. Until now a question fed the Support page when its measurement
-- area happened to contain the word "support" (and a barrier was read from an area containing
-- "barrier"), so existing follow-up questions get the flag their area implied.
CREATE TYPE "support_flag" AS ENUM ('none', 'support_requested', 'barrier');
ALTER TABLE "assessment_question" ADD COLUMN "support_flag" "support_flag" NOT NULL DEFAULT 'none';
UPDATE "assessment_question" q
SET "support_flag" = 'support_requested'
FROM "assessment_stage_config" s
WHERE q."stage_config_id" = s."id" AND s."stage" = 'follow_up' AND q."area" ILIKE '%support%';
UPDATE "assessment_question" q
SET "support_flag" = 'barrier'
FROM "assessment_stage_config" s
WHERE q."stage_config_id" = s."id" AND s."stage" = 'follow_up'
  AND q."area" ILIKE '%barrier%' AND q."area" NOT ILIKE '%support%';

-- The Support page lists barriers as items of their own, alongside support requests, and both
-- can be marked addressed.
CREATE TYPE "support_request_kind" AS ENUM ('support', 'barrier');
ALTER TABLE "support_request" ADD COLUMN "kind" "support_request_kind" NOT NULL DEFAULT 'support';
CREATE INDEX "support_request_event_id_kind_idx" ON "support_request"("event_id", "kind");
