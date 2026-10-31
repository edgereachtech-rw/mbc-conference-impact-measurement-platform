-- CreateEnum
CREATE TYPE "reflection_status" AS ENUM ('draft', 'published', 'closed');

-- CreateEnum
CREATE TYPE "reflection_question_type" AS ENUM ('short_text', 'long_text');

-- CreateTable
CREATE TABLE "reflection_activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "event_date_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "reflection_status" NOT NULL DEFAULT 'draft',
    "opens_at" TIMESTAMPTZ(3),
    "closes_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reflection_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflection_question" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "question_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "reflection_question_type" NOT NULL DEFAULT 'long_text',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "concern" BOOLEAN NOT NULL DEFAULT false,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reflection_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflection_response" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reflection_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflection_answer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "response_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reflection_answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reflection_activity_event_date_id_key" ON "reflection_activity"("event_date_id");

-- CreateIndex
CREATE INDEX "reflection_activity_event_id_idx" ON "reflection_activity"("event_id");

-- CreateIndex
CREATE INDEX "reflection_question_activity_id_idx" ON "reflection_question"("activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "reflection_question_question_key_version_key" ON "reflection_question"("question_key", "version");

-- CreateIndex
CREATE INDEX "reflection_response_delegate_id_idx" ON "reflection_response"("delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "reflection_response_activity_id_delegate_id_key" ON "reflection_response"("activity_id", "delegate_id");

-- CreateIndex
CREATE INDEX "reflection_answer_question_id_idx" ON "reflection_answer"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "reflection_answer_response_id_question_id_key" ON "reflection_answer"("response_id", "question_id");

-- AddForeignKey
ALTER TABLE "reflection_activity" ADD CONSTRAINT "reflection_activity_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_activity" ADD CONSTRAINT "reflection_activity_event_date_id_fkey" FOREIGN KEY ("event_date_id") REFERENCES "event_date"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_question" ADD CONSTRAINT "reflection_question_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "reflection_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_question" ADD CONSTRAINT "reflection_question_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_response" ADD CONSTRAINT "reflection_response_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "reflection_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_response" ADD CONSTRAINT "reflection_response_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_response" ADD CONSTRAINT "reflection_response_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_answer" ADD CONSTRAINT "reflection_answer_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "reflection_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection_answer" ADD CONSTRAINT "reflection_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "reflection_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
