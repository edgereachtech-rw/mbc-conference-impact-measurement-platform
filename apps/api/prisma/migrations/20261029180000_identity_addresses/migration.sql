-- CreateEnum
CREATE TYPE "identity_email_kind" AS ENUM ('current', 'historical', 'provisional');

-- CreateEnum
CREATE TYPE "identity_email_evidence" AS ENUM ('backfill', 'verified', 'admin_decision', 'unverified');

-- AlterTable
ALTER TABLE "delegate" ADD COLUMN     "identity_id" UUID;

-- CreateTable
CREATE TABLE "delegate_identity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" TEXT NOT NULL,
    "user_account_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delegate_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_email" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identity_id" UUID NOT NULL,
    "email_normalised" TEXT NOT NULL,
    "kind" "identity_email_kind" NOT NULL,
    "evidence" "identity_email_evidence" NOT NULL,
    "audit_log_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delegate_identity_user_account_id_key" ON "delegate_identity"("user_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_email_email_normalised_key" ON "identity_email"("email_normalised");

-- CreateIndex
CREATE INDEX "identity_email_identity_id_idx" ON "identity_email"("identity_id");

-- CreateIndex
CREATE INDEX "delegate_identity_id_idx" ON "delegate"("identity_id");

-- AddForeignKey
ALTER TABLE "delegate_identity" ADD CONSTRAINT "delegate_identity_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_email" ADD CONSTRAINT "identity_email_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "delegate_identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegate" ADD CONSTRAINT "delegate_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "delegate_identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written additions (backlog D5.1, D6.1). Expand-only: nothing above or below drops, renames
-- or rewrites existing data; delegate.identity_id stays nullable until the backfill has linked
-- every registration and a later contract migration makes it required.

-- Exactly one current address per identity (H3): historical and provisional rows are unlimited.
CREATE UNIQUE INDEX "identity_email_one_current_per_identity_key"
    ON "identity_email" ("identity_id")
    WHERE "kind" = 'current';

-- The store holds normalised addresses only, so the global unique index cannot be bypassed by
-- case or whitespace variants written through another path.
ALTER TABLE "identity_email"
    ADD CONSTRAINT "identity_email_normalised_check"
    CHECK ("email_normalised" = lower(btrim("email_normalised")) AND "email_normalised" <> '');

-- Verified history must point at the audit entry that proves it (H3).
ALTER TABLE "identity_email"
    ADD CONSTRAINT "identity_email_verified_evidence_check"
    CHECK ("evidence" <> 'verified' OR "audit_log_id" IS NOT NULL);
