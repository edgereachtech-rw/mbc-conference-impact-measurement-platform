-- Summaries of assessment results written by the writing assistant (2026-11-25). Expand-only.
CREATE TABLE "ai_summary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "stage_config_id" UUID NOT NULL,
    "batch_id" UUID,
    "scope_key" TEXT NOT NULL,
    "overview" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "based_on" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_summary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_summary_stage_config_id_scope_key_key" ON "ai_summary"("stage_config_id", "scope_key");
CREATE INDEX "ai_summary_event_id_idx" ON "ai_summary"("event_id");

ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_stage_config_id_fkey" FOREIGN KEY ("stage_config_id") REFERENCES "assessment_stage_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "event_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
