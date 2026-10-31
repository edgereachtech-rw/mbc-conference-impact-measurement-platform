-- CreateEnum
CREATE TYPE "section_audience" AS ENUM ('all', 'physical', 'virtual');

-- AlterTable: who sees a section, and which section of another stage it repeats
ALTER TABLE "assessment_section"
  ADD COLUMN "audience" "section_audience" NOT NULL DEFAULT 'all',
  ADD COLUMN "source_section_id" UUID;

-- AlterTable: which question of another stage a question repeats; built-in block questions
ALTER TABLE "assessment_question"
  ADD COLUMN "source_question_key" UUID,
  ADD COLUMN "builtin" TEXT;

-- CreateIndex
CREATE INDEX "assessment_section_source_section_id_idx" ON "assessment_section"("source_section_id");

-- AddForeignKey
ALTER TABLE "assessment_section"
  ADD CONSTRAINT "assessment_section_source_section_id_fkey"
  FOREIGN KEY ("source_section_id") REFERENCES "assessment_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing event gets the new stage, disabled, like the stages created with the event.
INSERT INTO "assessment_stage_config" ("event_id", "stage", "updated_at")
SELECT e."id", 'end_of_conference', now()
FROM "event" e
WHERE NOT EXISTS (
  SELECT 1 FROM "assessment_stage_config" c
  WHERE c."event_id" = e."id" AND c."stage" = 'end_of_conference'
);
