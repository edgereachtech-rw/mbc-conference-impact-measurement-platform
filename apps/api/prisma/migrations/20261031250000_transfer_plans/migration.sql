-- CreateEnum
CREATE TYPE "transfer_plan_status" AS ENUM ('draft', 'submitted');

-- CreateEnum
CREATE TYPE "action_progress_status" AS ENUM ('not_started', 'started', 'in_progress', 'applied', 'applied_consistently', 'completed', 'changed', 'no_longer_applicable');

-- CreateEnum
CREATE TYPE "reminder_frequency" AS ENUM ('none', 'weekly', 'fortnightly', 'monthly');

-- AlterTable
ALTER TABLE "event_session" ADD COLUMN     "transfer_planning_final" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "transfer_plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "status" "transfer_plan_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_snapshot" JSONB,
    "reminder_frequency" "reminder_frequency" NOT NULL DEFAULT 'none',
    "reminder_start_on" DATE,
    "next_reminder_at" TIMESTAMPTZ(3),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfer_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_plan_action" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "is_priority" BOOLEAN NOT NULL DEFAULT false,
    "priority_learning" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL DEFAULT '',
    "opportunity" TEXT NOT NULL DEFAULT '',
    "first_step" TEXT NOT NULL DEFAULT '',
    "start_on" DATE,
    "target_on" DATE,
    "stakeholders" TEXT NOT NULL DEFAULT '',
    "support" TEXT NOT NULL DEFAULT '',
    "barriers" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "expected_result" TEXT NOT NULL DEFAULT '',
    "measure" TEXT NOT NULL DEFAULT '',
    "baseline" TEXT NOT NULL DEFAULT '',
    "review_on" DATE,
    "progress_status" "action_progress_status" NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfer_plan_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_plan_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action_id" UUID NOT NULL,
    "status" "action_progress_status" NOT NULL,
    "note" TEXT,
    "evidence" TEXT,
    "results" TEXT,
    "challenges" TEXT,
    "new_target_on" DATE,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_user_id" UUID NOT NULL,

    CONSTRAINT "transfer_plan_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_plan_reminder_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_plan_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_reference_question" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "question_key" UUID NOT NULL,

    CONSTRAINT "event_reference_question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_plan_next_reminder_at_idx" ON "transfer_plan"("next_reminder_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_plan_event_id_delegate_id_key" ON "transfer_plan"("event_id", "delegate_id");

-- CreateIndex
CREATE INDEX "transfer_plan_action_plan_id_idx" ON "transfer_plan_action"("plan_id");

-- CreateIndex
CREATE INDEX "transfer_plan_progress_action_id_idx" ON "transfer_plan_progress"("action_id");

-- CreateIndex
CREATE INDEX "transfer_plan_reminder_log_plan_id_idx" ON "transfer_plan_reminder_log"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_reference_question_event_id_key_key" ON "event_reference_question"("event_id", "key");

-- AddForeignKey
ALTER TABLE "transfer_plan" ADD CONSTRAINT "transfer_plan_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_plan" ADD CONSTRAINT "transfer_plan_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_plan_action" ADD CONSTRAINT "transfer_plan_action_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "transfer_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_plan_progress" ADD CONSTRAINT "transfer_plan_progress_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "transfer_plan_action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_plan_reminder_log" ADD CONSTRAINT "transfer_plan_reminder_log_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "transfer_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reference_question" ADD CONSTRAINT "event_reference_question_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
