-- Emailing the session feedback form to the delegates who attended (task of 2026-11-03).
--
-- The form already had a code, a link and a QR code; what was missing was a way to put it in
-- front of people without them hunting for it. One row per attempt, so a chaser is history and
-- "who has not been asked" is an attendee with no sent row.
CREATE TABLE "session_feedback_invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_feedback_invitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "session_feedback_invitation_session_id_idx" ON "session_feedback_invitation"("session_id");
CREATE INDEX "session_feedback_invitation_delegate_id_idx" ON "session_feedback_invitation"("delegate_id");

ALTER TABLE "session_feedback_invitation"
    ADD CONSTRAINT "session_feedback_invitation_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "event_session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_feedback_invitation"
    ADD CONSTRAINT "session_feedback_invitation_delegate_id_fkey"
    FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
