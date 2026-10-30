-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('short_text', 'long_text', 'single_choice', 'multiple_choice', 'rating', 'yes_no', 'number', 'date');

-- CreateTable
CREATE TABLE "assessment_question" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stage_config_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "question_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "help_text" TEXT,
    "type" "question_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "area" TEXT,
    "options" JSONB,
    "scale" JSONB,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_response" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stage_config_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_answer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "response_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessment_question_stage_config_id_idx" ON "assessment_question"("stage_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_question_question_key_version_key" ON "assessment_question"("question_key", "version");

-- CreateIndex
CREATE INDEX "assessment_response_delegate_id_idx" ON "assessment_response"("delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_response_stage_config_id_delegate_id_key" ON "assessment_response"("stage_config_id", "delegate_id");

-- CreateIndex
CREATE INDEX "assessment_answer_question_id_idx" ON "assessment_answer"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_answer_response_id_question_id_key" ON "assessment_answer"("response_id", "question_id");

-- AddForeignKey
ALTER TABLE "assessment_question" ADD CONSTRAINT "assessment_question_stage_config_id_fkey" FOREIGN KEY ("stage_config_id") REFERENCES "assessment_stage_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_question" ADD CONSTRAINT "assessment_question_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_response" ADD CONSTRAINT "assessment_response_stage_config_id_fkey" FOREIGN KEY ("stage_config_id") REFERENCES "assessment_stage_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_response" ADD CONSTRAINT "assessment_response_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answer" ADD CONSTRAINT "assessment_answer_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "assessment_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answer" ADD CONSTRAINT "assessment_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assessment_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
