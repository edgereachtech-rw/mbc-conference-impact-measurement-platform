-- Impact assessment and sustainability after a plan is completed (2026-11-06): what the plan has
-- shown so far, and the checks that ask the delegate whether an improvement appeared or lasted.

CREATE TYPE "plan_outcome" AS ENUM ('pending', 'applied', 'impact_demonstrated', 'sustained_impact');
CREATE TYPE "impact_check_answer" AS ENUM ('not_yet', 'improved', 'sustained', 'faded');

ALTER TABLE "transfer_plan"
  ADD COLUMN "outcome" "plan_outcome" NOT NULL DEFAULT 'pending',
  ADD COLUMN "outcome_note" TEXT NOT NULL DEFAULT '';

CREATE TABLE "transfer_plan_impact_check" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "notified_at" TIMESTAMPTZ(3),
    "answered_at" TIMESTAMPTZ(3),
    "answer" "impact_check_answer",
    "note" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_plan_impact_check_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transfer_plan_impact_check_plan_id_round_key" ON "transfer_plan_impact_check"("plan_id", "round");
CREATE INDEX "transfer_plan_impact_check_due_on_idx" ON "transfer_plan_impact_check"("due_on");

ALTER TABLE "transfer_plan_impact_check" ADD CONSTRAINT "transfer_plan_impact_check_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "transfer_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
