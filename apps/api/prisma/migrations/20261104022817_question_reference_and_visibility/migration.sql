-- Per-question references and conditional display (decision of 2026-11-04, requirement 10.5).
--
-- Section 10.5 asks for two things the question builder could not express: show a delegate their
-- own earlier answer while they answer a later question, and ask a different question of the
-- delegates who have no earlier answer. Both were previously hard-coded in the "expectations"
-- built-in block, which fixed the wording for every event. These four columns make the same
-- behaviour ordinary question configuration, so each event writes its own words.
--
-- reference_question_key names an earlier question of the same event, by question_key, so it
-- survives the versioning that replaces a question's row when its wording changes.

CREATE TYPE "question_visibility" AS ENUM ('always', 'reference_answered', 'reference_unanswered');

ALTER TABLE "assessment_question"
    ADD COLUMN "reference_question_key" UUID,
    ADD COLUMN "show_reference_answer" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "visible_when" "question_visibility" NOT NULL DEFAULT 'always',
    ADD COLUMN "allow_decline" BOOLEAN NOT NULL DEFAULT false;

-- The delegate form resolves one reference answer per question; this keeps that lookup cheap on
-- stages that use it and costs nothing on stages that do not.
CREATE INDEX "assessment_question_reference_question_key_idx"
    ON "assessment_question"("reference_question_key")
    WHERE "reference_question_key" IS NOT NULL;
