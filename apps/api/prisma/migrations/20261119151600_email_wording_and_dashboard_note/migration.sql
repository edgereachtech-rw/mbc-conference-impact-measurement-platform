-- The organisers' own wording per kind of email per event (decision 2026-11-19), and when a
-- delegate closed the dashboard's "How this works" note.
CREATE TABLE "event_email_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT,
    "title" TEXT,
    "intro" TEXT,
    "closing" TEXT,
    "button_label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_email_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_email_template_event_id_kind_key" ON "event_email_template"("event_id", "kind");

ALTER TABLE "event_email_template" ADD CONSTRAINT "event_email_template_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_account" ADD COLUMN "dashboard_note_dismissed_at" TIMESTAMPTZ(3);
