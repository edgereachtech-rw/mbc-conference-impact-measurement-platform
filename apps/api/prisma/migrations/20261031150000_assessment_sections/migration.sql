-- CreateTable
CREATE TABLE "assessment_section" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stage_config_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_section_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "assessment_question" ADD COLUMN     "section_id" UUID;

-- CreateIndex
CREATE INDEX "assessment_section_stage_config_id_idx" ON "assessment_section"("stage_config_id");

-- CreateIndex
CREATE INDEX "assessment_question_section_id_idx" ON "assessment_question"("section_id");

-- AddForeignKey
ALTER TABLE "assessment_section" ADD CONSTRAINT "assessment_section_stage_config_id_fkey" FOREIGN KEY ("stage_config_id") REFERENCES "assessment_stage_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_section" ADD CONSTRAINT "assessment_section_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_question" ADD CONSTRAINT "assessment_question_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "assessment_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
