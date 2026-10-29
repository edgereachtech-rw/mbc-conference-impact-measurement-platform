-- CreateEnum
CREATE TYPE "import_run_status" AS ENUM ('uploaded', 'previewed', 'committed', 'discarded');

-- CreateEnum
CREATE TYPE "import_row_outcome" AS ENUM ('accepted', 'updated', 'unchanged', 'linked', 'duplicate_in_file', 'rejected', 'conflict');

-- AlterEnum
ALTER TYPE "identity_email_evidence" ADD VALUE 'import';

-- AlterTable
ALTER TABLE "delegate" ADD COLUMN     "external_registration_id" TEXT,
ADD COLUMN     "registration_source" TEXT;

-- CreateTable
CREATE TABLE "import_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL,
    "headers" JSONB NOT NULL,
    "mapping" JSONB,
    "attendance_format_default" "participation_code",
    "status" "import_run_status" NOT NULL DEFAULT 'uploaded',
    "fingerprint" TEXT,
    "preview_expires_at" TIMESTAMPTZ(3),
    "counts" JSONB,
    "committed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "values" JSONB,
    "outcome" "import_row_outcome",
    "reason_code" TEXT,
    "reason_detail" TEXT,
    "possible_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "conflict" JSONB,
    "delegate_id" UUID,
    "identity_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_source_mapping" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "header_signature" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_source_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_run_event_id_created_at_idx" ON "import_run"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "import_row_run_id_outcome_idx" ON "import_row"("run_id", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_run_id_row_number_key" ON "import_row"("run_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "import_source_mapping_source_key" ON "import_source_mapping"("source");

-- AddForeignKey
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written addition (backlog D4, D5): within one event and registration source the external
-- registration id identifies one registration. Expand-only; existing rows have NULLs and are unaffected.
CREATE UNIQUE INDEX "delegate_event_source_external_id_key"
    ON "delegate" ("event_id", "registration_source", "external_registration_id")
    WHERE "registration_source" IS NOT NULL AND "external_registration_id" IS NOT NULL;
