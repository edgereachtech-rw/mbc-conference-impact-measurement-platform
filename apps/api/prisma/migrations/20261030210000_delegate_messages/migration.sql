-- CreateEnum
CREATE TYPE "delegate_message_status" AS ENUM ('sending', 'sent', 'partially_failed', 'failed');

-- CreateEnum
CREATE TYPE "delegate_message_recipient_status" AS ENUM ('queued', 'sent', 'failed');

-- CreateTable
CREATE TABLE "delegate_message" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipient_selection" JSONB NOT NULL,
    "status" "delegate_message_status" NOT NULL DEFAULT 'sending',
    "recipient_count" INTEGER NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "delegate_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegate_message_recipient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "status" "delegate_message_recipient_status" NOT NULL DEFAULT 'queued',
    "sent_at" TIMESTAMPTZ(3),
    "provider_message_id" TEXT,
    "failure_reason" TEXT,

    CONSTRAINT "delegate_message_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delegate_message_event_id_created_at_idx" ON "delegate_message"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "delegate_message_recipient_delegate_id_idx" ON "delegate_message_recipient"("delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "delegate_message_recipient_message_id_delegate_id_key" ON "delegate_message_recipient"("message_id", "delegate_id");

-- AddForeignKey
ALTER TABLE "delegate_message" ADD CONSTRAINT "delegate_message_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegate_message_recipient" ADD CONSTRAINT "delegate_message_recipient_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "delegate_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegate_message_recipient" ADD CONSTRAINT "delegate_message_recipient_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
