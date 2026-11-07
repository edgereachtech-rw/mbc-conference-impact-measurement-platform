-- Session feedback opens and closes by hand (decision 2026-11-07). Enabling a session creates
-- its link and QR code; "Start" opens the form, and only "Close" closes it. The deadline column
-- becomes the closing timestamp: a deadline already past closed the form then, a deadline still
-- ahead was never a closure and is cleared.
ALTER TABLE "event_session" RENAME COLUMN "feedback_closes_at" TO "feedback_closed_at";
UPDATE "event_session" SET "feedback_closed_at" = NULL WHERE "feedback_closed_at" > now();
