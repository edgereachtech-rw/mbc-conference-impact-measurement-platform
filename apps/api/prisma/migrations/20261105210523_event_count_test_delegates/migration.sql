-- Test delegates (decision of 2026-11-05).
--
-- A test delegate is a registration an admin marks as such after a normal import, so that staff
-- can walk the platform from the delegate's side without their answers polluting the event's
-- figures. Whether those registrations count in reports, dashboards and summaries is the event's
-- own choice, off by default; whether they may sign in at all stays an environment rule.
ALTER TABLE "event"
    ADD COLUMN "count_test_delegates" BOOLEAN NOT NULL DEFAULT false;
