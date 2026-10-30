-- CreateTable
CREATE TABLE "assessment_section_submission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "response_id" UUID NOT NULL,
    "section_key" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_section_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_section_submission_response_id_section_key_key" ON "assessment_section_submission"("response_id", "section_key");

-- AddForeignKey
ALTER TABLE "assessment_section_submission" ADD CONSTRAINT "assessment_section_submission_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "assessment_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;
