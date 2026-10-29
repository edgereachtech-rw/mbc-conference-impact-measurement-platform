-- CreateEnum
CREATE TYPE "sign_in_purpose" AS ENUM ('signin', 'invite_accept');

-- CreateEnum
CREATE TYPE "auth_attempt_kind" AS ENUM ('request_link', 'verify');

-- AlterTable
ALTER TABLE "delegate" ADD COLUMN     "signed_up_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "ip_hash" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_in_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "user_account_id" UUID,
    "purpose" "sign_in_purpose" NOT NULL DEFAULT 'signin',
    "token_hash" TEXT NOT NULL,
    "code_hash" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "target_path" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_in_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_attempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "auth_attempt_kind" NOT NULL,
    "email" TEXT,
    "ip_hash" TEXT,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_token_hash_key" ON "auth_session"("token_hash");

-- CreateIndex
CREATE INDEX "auth_session_user_account_id_idx" ON "auth_session"("user_account_id");

-- CreateIndex
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sign_in_token_token_hash_key" ON "sign_in_token"("token_hash");

-- CreateIndex
CREATE INDEX "sign_in_token_email_created_at_idx" ON "sign_in_token"("email", "created_at");

-- CreateIndex
CREATE INDEX "sign_in_token_expires_at_idx" ON "sign_in_token"("expires_at");

-- CreateIndex
CREATE INDEX "auth_attempt_email_attempted_at_idx" ON "auth_attempt"("email", "attempted_at");

-- CreateIndex
CREATE INDEX "auth_attempt_ip_hash_attempted_at_idx" ON "auth_attempt"("ip_hash", "attempted_at");

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_token" ADD CONSTRAINT "sign_in_token_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

