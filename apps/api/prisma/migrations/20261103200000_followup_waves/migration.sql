-- Follow-up waves and their invitations (backlog E12-1, E12-4 to E12-6, E12-14).
--
-- The follow-up assessment ran as one round per event, because assessment_stage_config was unique
-- on (event, stage). The workplan wants three: 30, 60 and 90 days after the conference, each with
-- its own dates, its own questions and its own invitations, and a longer-term one later. A wave
-- number on the stage gives all of that without a second question engine: sections, versioning,
-- drafts, section-by-section submission, reports and the delegate journey all keep working.
ALTER TABLE "assessment_stage_config"
    ADD COLUMN "wave" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "due_after_days" INTEGER,
    ADD COLUMN "reminder_after_days" INTEGER,
    ADD COLUMN "reminder_limit" INTEGER NOT NULL DEFAULT 0;

-- Existing rows are wave 1 by the default above, so the key widens without touching any data.
DROP INDEX "assessment_stage_config_event_id_stage_key";
CREATE UNIQUE INDEX "assessment_stage_config_event_id_stage_wave_key"
    ON "assessment_stage_config"("event_id", "stage", "wave");

-- One row per delegate per wave per kind of send. The unique key is what makes sending
-- idempotent: the worker writes the row and never sends that kind and sequence again, so a crash
-- part-way through a batch cannot email anyone twice.
CREATE TABLE "assessment_invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stage_config_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_invitation_stage_delegate_kind_sequence_key"
    ON "assessment_invitation"("stage_config_id", "delegate_id", "kind", "sequence");
CREATE INDEX "assessment_invitation_stage_config_id_idx" ON "assessment_invitation"("stage_config_id");
CREATE INDEX "assessment_invitation_delegate_id_idx" ON "assessment_invitation"("delegate_id");

ALTER TABLE "assessment_invitation"
    ADD CONSTRAINT "assessment_invitation_stage_config_id_fkey"
    FOREIGN KEY ("stage_config_id") REFERENCES "assessment_stage_config"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_invitation"
    ADD CONSTRAINT "assessment_invitation_delegate_id_fkey"
    FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
