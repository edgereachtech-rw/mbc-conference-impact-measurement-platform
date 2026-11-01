-- CreateEnum
CREATE TYPE "measure_status" AS ENUM ('identified', 'not_yet_known', 'not_applicable');

-- CreateEnum
CREATE TYPE "measure_kind" AS ENUM ('quantitative', 'qualitative');

-- CreateEnum
CREATE TYPE "improvement_direction" AS ENUM ('higher', 'lower', 'target', 'unspecified');

-- CreateEnum
CREATE TYPE "evidence_support" AS ENUM ('self_reported', 'supported');

-- CreateEnum
CREATE TYPE "evidence_type" AS ENUM ('example', 'work_product', 'confirmation', 'organisational_measure', 'case_example', 'other');

-- CreateTable
CREATE TABLE "transfer_plan_measure" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "measure_status" NOT NULL DEFAULT 'identified',
    "kind" "measure_kind" NOT NULL DEFAULT 'quantitative',
    "name" TEXT NOT NULL DEFAULT '',
    "importance" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "direction" "improvement_direction" NOT NULL DEFAULT 'unspecified',
    "baseline_value" TEXT NOT NULL DEFAULT '',
    "baseline_on" DATE,
    "target_value" TEXT NOT NULL DEFAULT '',
    "target_on" DATE,
    "actual_value" TEXT NOT NULL DEFAULT '',
    "actual_on" DATE,
    "source" TEXT NOT NULL DEFAULT '',
    "influences" TEXT NOT NULL DEFAULT '',
    "support" "evidence_support" NOT NULL DEFAULT 'self_reported',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfer_plan_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_plan_measure_reading" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "measure_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "reading_on" DATE,
    "source" TEXT NOT NULL DEFAULT '',
    "support" "evidence_support" NOT NULL DEFAULT 'self_reported',
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_plan_measure_reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_plan_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "evidence_type" NOT NULL DEFAULT 'example',
    "description" TEXT NOT NULL DEFAULT '',
    "evidence_on" DATE,
    "support" "evidence_support" NOT NULL DEFAULT 'self_reported',
    "supported_by" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfer_plan_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_plan_measure_action_id_idx" ON "transfer_plan_measure"("action_id");

-- CreateIndex
CREATE INDEX "transfer_plan_measure_reading_measure_id_idx" ON "transfer_plan_measure_reading"("measure_id");

-- CreateIndex
CREATE INDEX "transfer_plan_evidence_action_id_idx" ON "transfer_plan_evidence"("action_id");

-- AddForeignKey
ALTER TABLE "transfer_plan_measure" ADD CONSTRAINT "transfer_plan_measure_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "transfer_plan_action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_plan_measure_reading" ADD CONSTRAINT "transfer_plan_measure_reading_measure_id_fkey" FOREIGN KEY ("measure_id") REFERENCES "transfer_plan_measure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_plan_evidence" ADD CONSTRAINT "transfer_plan_evidence_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "transfer_plan_action"("id") ON DELETE CASCADE ON UPDATE CASCADE;
