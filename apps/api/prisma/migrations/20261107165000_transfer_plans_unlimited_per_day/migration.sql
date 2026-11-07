-- As many transfer plans per day as a delegate needs (decision 2026-11-07): the one-per-day rule
-- goes, the day a plan belongs to stays.
DROP INDEX "transfer_plan_event_id_delegate_id_event_date_id_key";
CREATE INDEX "transfer_plan_event_date_id_idx" ON "transfer_plan"("event_date_id");
