-- The organisers' own submission confirmation per assessment (decision 2026-11-19): title,
-- message, closing line and styling as JSON. Null keeps the platform's fixed popup.
ALTER TABLE "assessment_stage_config" ADD COLUMN "confirmation" JSONB;
