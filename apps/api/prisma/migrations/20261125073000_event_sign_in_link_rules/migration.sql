-- Per-event sign-in link rules (2026-11-25): expiry and reuse. Expand-only; defaults keep
-- today's behaviour (platform expiry, single use).
ALTER TABLE "event" ADD COLUMN "sign_in_link_ttl_minutes" INTEGER,
ADD COLUMN "sign_in_link_reusable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sign_in_token" ADD COLUMN "reusable" BOOLEAN NOT NULL DEFAULT false;
