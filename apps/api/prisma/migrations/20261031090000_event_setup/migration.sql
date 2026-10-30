-- CreateEnum
CREATE TYPE "event_type" AS ENUM ('conference', 'workshop', 'seminar', 'summit', 'training', 'other');

-- CreateEnum
CREATE TYPE "session_type" AS ENUM ('keynote', 'plenary', 'panel', 'workshop', 'breakout', 'transfer_planning', 'networking', 'other');

-- CreateEnum
CREATE TYPE "assessment_stage" AS ENUM ('pre_conference', 'during_conference', 'follow_up');

-- CreateEnum
CREATE TYPE "assessment_stage_status" AS ENUM ('draft', 'scheduled', 'open', 'closed');

-- CreateEnum
CREATE TYPE "assessment_target" AS ENUM ('all_delegates', 'group');

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "additional_info" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "event_type" "event_type" NOT NULL DEFAULT 'conference',
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "organiser" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "event_date" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_date_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "event_date_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "session_type" "session_type" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT,
    "speaker" TEXT,
    "capacity" INTEGER,
    "feedback_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_stage_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "stage" "assessment_stage" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "opens_at" TIMESTAMPTZ(3),
    "closes_at" TIMESTAMPTZ(3),
    "target" "assessment_target" NOT NULL DEFAULT 'all_delegates',
    "target_group" TEXT,
    "status" "assessment_stage_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_stage_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_date_event_id_date_key" ON "event_date"("event_id", "date");

-- CreateIndex
CREATE INDEX "event_session_event_id_idx" ON "event_session"("event_id");

-- CreateIndex
CREATE INDEX "event_session_event_date_id_idx" ON "event_session"("event_date_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_stage_config_event_id_stage_key" ON "assessment_stage_config"("event_id", "stage");

-- AddForeignKey
ALTER TABLE "event_date" ADD CONSTRAINT "event_date_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_session" ADD CONSTRAINT "event_session_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_session" ADD CONSTRAINT "event_session_event_date_id_fkey" FOREIGN KEY ("event_date_id") REFERENCES "event_date"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_stage_config" ADD CONSTRAINT "assessment_stage_config_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing events were defined by a start and end date; every day in that range becomes
-- a selected date, and each event gets its three assessment stages, disabled.
INSERT INTO "event_date" ("event_id", "date")
SELECT e."id", d::date
FROM "event" e, generate_series(e."starts_on"::timestamp, e."ends_on"::timestamp, interval '1 day') AS d;

INSERT INTO "assessment_stage_config" ("event_id", "stage", "updated_at")
SELECT e."id", s, CURRENT_TIMESTAMP
FROM "event" e CROSS JOIN unnest(enum_range(NULL::"assessment_stage")) AS s;
