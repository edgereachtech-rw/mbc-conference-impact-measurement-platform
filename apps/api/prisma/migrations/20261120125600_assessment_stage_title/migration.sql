-- The organisers' own name and purpose line per assessment stage (2026-11-20). Expand-only;
-- null keeps the platform's wording.
ALTER TABLE "assessment_stage_config" ADD COLUMN "title" TEXT, ADD COLUMN "description" TEXT;
