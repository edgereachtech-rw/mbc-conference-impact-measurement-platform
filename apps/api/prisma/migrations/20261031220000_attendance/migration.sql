-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('attended', 'partial', 'absent');

-- CreateEnum
CREATE TYPE "attendance_mode" AS ENUM ('physical', 'virtual');

-- CreateEnum
CREATE TYPE "attendance_method" AS ENUM ('qr', 'manual', 'bulk', 'closure', 'correction');

-- AlterTable
ALTER TABLE "event_date" ADD COLUMN     "attendance_closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "attendance_closed_by_user_id" UUID;

-- CreateTable
CREATE TABLE "attendance_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "event_date_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "attendance_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "event_date_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "mode" "attendance_mode" NOT NULL,
    "method" "attendance_method" NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "note" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "method" "attendance_method" NOT NULL DEFAULT 'manual',
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_token_token_hash_key" ON "attendance_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_token_delegate_id_event_date_id_key" ON "attendance_token"("delegate_id", "event_date_id");

-- CreateIndex
CREATE INDEX "attendance_record_event_id_event_date_id_idx" ON "attendance_record"("event_id", "event_date_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_delegate_id_event_date_id_key" ON "attendance_record"("delegate_id", "event_date_id");

-- CreateIndex
CREATE INDEX "session_attendance_session_id_idx" ON "session_attendance"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_attendance_delegate_id_session_id_key" ON "session_attendance"("delegate_id", "session_id");

-- AddForeignKey
ALTER TABLE "attendance_token" ADD CONSTRAINT "attendance_token_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_token" ADD CONSTRAINT "attendance_token_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_token" ADD CONSTRAINT "attendance_token_event_date_id_fkey" FOREIGN KEY ("event_date_id") REFERENCES "event_date"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_event_date_id_fkey" FOREIGN KEY ("event_date_id") REFERENCES "event_date"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
