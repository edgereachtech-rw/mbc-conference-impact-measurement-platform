-- The final Transfer Planning session is no longer a setting (decision of 2026-11-02).
--
-- Submission opens with the start of the LAST Transfer Planning session in the schedule, which the
-- API works out from the sessions themselves. The per-session flag this column held could name an
-- earlier session, and nothing stopped an admin setting it on two sessions at once, in which case
-- the earlier one won and submission opened a day early. There is nothing to keep: the column was
-- false on every row unless an admin had ticked the box, and the behaviour it selected is now the
-- only behaviour.
ALTER TABLE "event_session" DROP COLUMN "transfer_planning_final";
