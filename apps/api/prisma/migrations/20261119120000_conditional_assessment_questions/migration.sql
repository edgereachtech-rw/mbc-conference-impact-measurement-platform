ALTER TABLE assessment_question
  ADD COLUMN conditional_question_key UUID,
  ADD COLUMN conditional_values TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX assessment_question_conditional_question_key_idx
  ON assessment_question(conditional_question_key);