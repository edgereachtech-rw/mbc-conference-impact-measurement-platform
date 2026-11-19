-- A text question may carry a word limit (decision 2026-11-19): the delegate form counts the
-- words and the server refuses an answer over it. Null keeps the character limit alone.
ALTER TABLE "assessment_question" ADD COLUMN "max_words" INTEGER;
