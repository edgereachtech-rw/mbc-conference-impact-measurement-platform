-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "event_format" AS ENUM ('physical', 'virtual', 'hybrid');

-- CreateEnum
CREATE TYPE "participation_code" AS ENUM ('physical', 'virtual');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('delegate', 'admin', 'analyst', 'support', 'speaker');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "delegate_capacity" AS ENUM ('individual', 'nominee', 'other');

-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('valid', 'cancelled', 'duplicate', 'test');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'sent', 'bounced', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "consent_document" AS ENUM ('privacy');

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "location" TEXT,
    "format" "event_format" NOT NULL DEFAULT 'hybrid',
    "status" "event_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participation_category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "code" "participation_code" NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participation_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "last_sign_in_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "user_account_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organisation" TEXT,
    "job_title" TEXT,
    "country" TEXT,
    "attendance_format" "participation_code" NOT NULL,
    "capacity" "delegate_capacity" NOT NULL DEFAULT 'individual',
    "nominating_organisation" TEXT,
    "registration_status" "registration_status" NOT NULL DEFAULT 'valid',
    "duplicate_of_id" UUID,
    "imported_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delegate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delegate_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "bounced_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delegate_id" UUID NOT NULL,
    "document" "consent_document" NOT NULL DEFAULT 'privacy',
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_slug_key" ON "event"("slug");

-- CreateIndex
CREATE INDEX "participation_category_event_id_idx" ON "participation_category"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "participation_category_event_id_code_key" ON "participation_category"("event_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_email_key" ON "user_account"("email");

-- CreateIndex
CREATE INDEX "delegate_event_id_idx" ON "delegate"("event_id");

-- CreateIndex
CREATE INDEX "delegate_email_idx" ON "delegate"("email");

-- CreateIndex
CREATE INDEX "delegate_user_account_id_idx" ON "delegate"("user_account_id");

-- CreateIndex
CREATE INDEX "delegate_event_id_registration_status_idx" ON "delegate"("event_id", "registration_status");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_delegate_id_idx" ON "invitation"("delegate_id");

-- CreateIndex
CREATE INDEX "consent_record_delegate_id_idx" ON "consent_record"("delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_record_delegate_id_document_version_key" ON "consent_record"("delegate_id", "document", "version");

-- CreateIndex
CREATE INDEX "audit_log_event_id_idx" ON "audit_log"("event_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- AddForeignKey
ALTER TABLE "participation_category" ADD CONSTRAINT "participation_category_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegate" ADD CONSTRAINT "delegate_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegate" ADD CONSTRAINT "delegate_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegate" ADD CONSTRAINT "delegate_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "delegate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ---------------------------------------------------------------------------------------------
-- Hand-written additions (not expressible in the Prisma schema language)
-- ---------------------------------------------------------------------------------------------

-- Emails are unique regardless of case. The application stores them lower-cased; the index makes
-- the database enforce it even for rows written by hand.
CREATE UNIQUE INDEX "user_account_email_lower_key" ON "user_account" (lower("email"));

-- One registration per email per event, except rows already confirmed as duplicates
-- (registration_status = 'duplicate'), which keep their original email for the audit trail.
CREATE UNIQUE INDEX "delegate_event_email_lower_key"
  ON "delegate" ("event_id", lower("email"))
  WHERE "registration_status" <> 'duplicate';

-- audit_log is append-only: rows can be inserted and read, never changed, deleted or truncated.
CREATE OR REPLACE FUNCTION audit_log_block_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modification();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_modification();
