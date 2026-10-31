-- Reference questions become one ordered list the admin picks pre-event questions into,
-- instead of two named slots. Existing rows keep their place.
ALTER TABLE "event_reference_question" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 1;
UPDATE "event_reference_question"
SET "order" = CASE "key" WHEN 'expectation_learn' THEN 1 WHEN 'expectation_do_differently' THEN 2 ELSE 3 END;
DROP INDEX IF EXISTS "event_reference_question_event_id_key_key";
ALTER TABLE "event_reference_question" DROP COLUMN "key";
ALTER TABLE "event_reference_question" ALTER COLUMN "order" DROP DEFAULT;
CREATE UNIQUE INDEX "event_reference_question_event_id_question_key_key"
  ON "event_reference_question"("event_id", "question_key");
