-- CreateEnum
CREATE TYPE "import_resolution" AS ENUM ('link_existing', 'create_identity', 'reject', 'correct_source');

-- AlterTable
ALTER TABLE "import_row" ADD COLUMN     "resolution" "import_resolution",
ADD COLUMN     "resolution_note" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMPTZ(3),
ADD COLUMN     "resolved_by_user_id" UUID;

