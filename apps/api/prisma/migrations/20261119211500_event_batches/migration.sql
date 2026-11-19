-- Batches (decision 2026-11-19): the delegates who come on one of the event's days. A delegate
-- in a batch has that day alone for check-in, attendance and reflection. Expand-only: existing
-- delegates have no batch and keep every day.
CREATE TABLE "event_batch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "event_date_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_batch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_batch_event_id_name_key" ON "event_batch"("event_id", "name");
CREATE INDEX "event_batch_event_id_event_date_id_idx" ON "event_batch"("event_id", "event_date_id");

ALTER TABLE "event_batch" ADD CONSTRAINT "event_batch_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_batch" ADD CONSTRAINT "event_batch_event_date_id_fkey"
    FOREIGN KEY ("event_date_id") REFERENCES "event_date"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delegate" ADD COLUMN "batch_id" UUID;
CREATE INDEX "delegate_batch_id_idx" ON "delegate"("batch_id");
ALTER TABLE "delegate" ADD CONSTRAINT "delegate_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "event_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_run" ADD COLUMN "batch_id" UUID;
