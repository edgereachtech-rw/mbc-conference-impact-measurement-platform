-- One transfer plan per delegate per conference day (decision 2026-11-07). A plan is created on
-- the day itself, saved as a draft or submitted at will, and on the last day the delegate submits
-- every plan and names one as their priority. No plan can be created after the event.
ALTER TABLE "transfer_plan"
  ADD COLUMN "event_date_id" UUID,
  ADD COLUMN "is_priority" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "transfer_plan"
  ADD CONSTRAINT "transfer_plan_event_date_id_fkey"
  FOREIGN KEY ("event_date_id") REFERENCES "event_date"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "transfer_plan_event_id_delegate_id_event_date_id_key"
  ON "transfer_plan"("event_id", "delegate_id", "event_date_id");

-- Plans from before the rule: the n-th plan of a delegate takes the n-th day of its event, when
-- the event has that many days; the rest keep no day.
WITH days AS (
  SELECT id, event_id, row_number() OVER (PARTITION BY event_id ORDER BY date) AS n
  FROM "event_date"
)
UPDATE "transfer_plan" p
SET "event_date_id" = d.id
FROM days d
WHERE d.event_id = p.event_id AND d.n = p.sequence AND p.event_date_id IS NULL;
