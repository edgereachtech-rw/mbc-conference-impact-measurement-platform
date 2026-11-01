-- CreateTable
CREATE TABLE "event_report_approval" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "sections" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" UUID,

    CONSTRAINT "event_report_approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_report_approval_event_id_kind_scope_idx" ON "event_report_approval"("event_id", "kind", "scope");

-- AddForeignKey
ALTER TABLE "event_report_approval" ADD CONSTRAINT "event_report_approval_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
