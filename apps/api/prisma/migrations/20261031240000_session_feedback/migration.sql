-- CreateEnum
CREATE TYPE "feedback_question_type" AS ENUM ('rating', 'long_text');

-- AlterTable
ALTER TABLE "event_session" ADD COLUMN     "feedback_code" TEXT,
ADD COLUMN     "feedback_opened_at" TIMESTAMPTZ(3),
ADD COLUMN     "feedback_closes_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "session_feedback_question" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "question_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "feedback_question_type" NOT NULL DEFAULT 'rating',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_feedback_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_feedback_response" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_feedback_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_feedback_answer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "response_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_feedback_answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_feedback_revision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "response_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_feedback_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_session_feedback_code_key" ON "event_session"("feedback_code");

-- CreateIndex
CREATE INDEX "session_feedback_question_session_id_idx" ON "session_feedback_question"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_feedback_question_question_key_version_key" ON "session_feedback_question"("question_key", "version");

-- CreateIndex
CREATE INDEX "session_feedback_response_delegate_id_idx" ON "session_feedback_response"("delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_feedback_response_session_id_delegate_id_key" ON "session_feedback_response"("session_id", "delegate_id");

-- CreateIndex
CREATE INDEX "session_feedback_answer_question_id_idx" ON "session_feedback_answer"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_feedback_answer_response_id_question_id_key" ON "session_feedback_answer"("response_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_feedback_revision_response_id_revision_key" ON "session_feedback_revision"("response_id", "revision");

-- AddForeignKey
ALTER TABLE "session_feedback_question" ADD CONSTRAINT "session_feedback_question_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_question" ADD CONSTRAINT "session_feedback_question_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_response" ADD CONSTRAINT "session_feedback_response_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_response" ADD CONSTRAINT "session_feedback_response_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_response" ADD CONSTRAINT "session_feedback_response_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_answer" ADD CONSTRAINT "session_feedback_answer_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "session_feedback_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_answer" ADD CONSTRAINT "session_feedback_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "session_feedback_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_feedback_revision" ADD CONSTRAINT "session_feedback_revision_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "session_feedback_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;
