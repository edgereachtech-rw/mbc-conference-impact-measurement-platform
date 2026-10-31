-- The end-of-conference evaluation is an assessment stage of its own (backlog E11). Adding
-- the enum value is its own migration: PostgreSQL refuses to use a new enum value in the
-- transaction that adds it.
ALTER TYPE "assessment_stage" ADD VALUE 'end_of_conference';
