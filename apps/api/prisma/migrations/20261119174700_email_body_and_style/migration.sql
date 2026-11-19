-- The organisers may write an email's whole content and set its look inside the frame
-- (decision 2026-11-19). Null keeps the platform's content and look.
ALTER TABLE "event_email_template" ADD COLUMN "body" TEXT, ADD COLUMN "style" JSONB;
