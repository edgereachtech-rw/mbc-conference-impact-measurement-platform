-- The sign-in attempt ledger stores a keyed hash of the email instead of the address itself.
-- Existing rows (at most one hour of transient rate-limit data) are re-keyed with a plain hash so
-- no plaintext address survives the migration.
ALTER TABLE "auth_attempt" ADD COLUMN "email_hash" TEXT;

UPDATE "auth_attempt"
SET "email_hash" = left(encode(sha256(convert_to("email", 'UTF8')), 'hex'), 32)
WHERE "email" IS NOT NULL;

DROP INDEX IF EXISTS "auth_attempt_email_attempted_at_idx";

ALTER TABLE "auth_attempt" DROP COLUMN "email";

CREATE INDEX "auth_attempt_email_hash_attempted_at_idx" ON "auth_attempt"("email_hash", "attempted_at");
