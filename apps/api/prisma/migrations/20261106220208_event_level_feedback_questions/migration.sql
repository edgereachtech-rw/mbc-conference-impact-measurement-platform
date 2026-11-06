-- Session feedback questions belong to the event (2026-11-07): one set, recorded once, that every
-- session's feedback form follows. Before, enabling feedback copied the questions onto each session.

ALTER TABLE "session_feedback_question" ALTER COLUMN "session_id" DROP NOT NULL;
CREATE INDEX "session_feedback_question_event_id_idx" ON "session_feedback_question"("event_id");

-- One event-level question per (event, order), taken from the earliest active per-session copy.
INSERT INTO "session_feedback_question"
  ("id", "session_id", "event_id", "question_key", "version", "order", "prompt", "type", "required", "retired_at", "created_at", "updated_at")
SELECT gen_random_uuid(), NULL, q."event_id", gen_random_uuid(), 1, q."order", q."prompt", q."type", q."required", NULL, now(), now()
FROM (
  SELECT DISTINCT ON ("event_id", "order") *
  FROM "session_feedback_question"
  WHERE "session_id" IS NOT NULL AND "retired_at" IS NULL
  ORDER BY "event_id", "order", "created_at"
) q;

-- Answers move to the event-level question with the same event and order, so nothing is lost.
UPDATE "session_feedback_answer" a
SET "question_id" = e."id"
FROM "session_feedback_question" s
JOIN "session_feedback_question" e
  ON e."event_id" = s."event_id" AND e."order" = s."order" AND e."session_id" IS NULL AND e."retired_at" IS NULL
WHERE a."question_id" = s."id" AND s."session_id" IS NOT NULL;

-- Per-session copies that no answer refers to any more are gone; any that remain are retired.
DELETE FROM "session_feedback_question" s
WHERE s."session_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "session_feedback_answer" a WHERE a."question_id" = s."id");
UPDATE "session_feedback_question" SET "retired_at" = now()
WHERE "session_id" IS NOT NULL AND "retired_at" IS NULL;
