-- The onboarding pack an admin sends to delegates (task of 2026-11-03): the welcome, their
-- attendance codes and their "I will be attending" card.
--
-- One row per attempt, not per delegate: a resend is a second row, so the history of what was
-- sent to whom survives, and "who has not had one yet" is a delegate with no sent row.
CREATE TABLE "onboarding_send" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delegate_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_send_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboarding_send_delegate_id_idx" ON "onboarding_send"("delegate_id");

ALTER TABLE "onboarding_send"
    ADD CONSTRAINT "onboarding_send_delegate_id_fkey"
    FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
