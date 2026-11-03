-- Renames the unique index on assessment_invitation to the name Prisma derives from the schema.
--
-- This migration's timestamp is earlier than 20261103200000_followup_waves, the migration that
-- creates the index, so on a database built from scratch it runs first and there is nothing to
-- rename. IF EXISTS makes that a no-op: followup_waves now creates the index under its final
-- name, and this file only has work to do on a database that applied followup_waves before the
-- two were reconciled. Renaming the folder would orphan the row already recorded for it in
-- _prisma_migrations, so the name stays as it was generated.
ALTER INDEX IF EXISTS "assessment_invitation_stage_delegate_kind_sequence_key"
    RENAME TO "assessment_invitation_stage_config_id_delegate_id_kind_sequ_key";
