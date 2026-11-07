-- A planned action gets a short title (spec of 2026-11-08), used to name it in the plan, the
-- dashboards and the reports. Existing actions keep an empty title and show their action text.
ALTER TABLE "transfer_plan_action" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
