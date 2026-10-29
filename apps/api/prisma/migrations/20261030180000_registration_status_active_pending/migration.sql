-- Registration status (backlog E2-5, decided 2026-10-30): "valid" becomes "active" and "pending" is
-- added. Expand-only: the rename keeps every existing row's value (now spelled active); nothing is
-- dropped. The partial unique index on (event_id, lower(email)) excludes only 'duplicate' and is
-- unaffected.
ALTER TYPE "registration_status" RENAME VALUE 'valid' TO 'active';
ALTER TYPE "registration_status" ADD VALUE 'pending' AFTER 'active';
ALTER TABLE "delegate" ALTER COLUMN "registration_status" SET DEFAULT 'active';
