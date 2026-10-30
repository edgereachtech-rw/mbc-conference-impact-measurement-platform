-- CreateEnum
CREATE TYPE "section_marking" AS ENUM ('none', 'scored', 'knowledge');

-- AlterTable
ALTER TABLE "assessment_section" ADD COLUMN     "marking" "section_marking" NOT NULL DEFAULT 'none';
