-- Transfer support (brief 11.7; backlog E13): a delegate's request for help applying their
-- learning, raised from a follow-up answer or from their plan page, tracked by the organisers
-- until it is addressed.
CREATE TYPE "support_request_source" AS ENUM ('follow_up', 'delegate');
CREATE TYPE "support_request_status" AS ENUM ('open', 'addressed');

CREATE TABLE "support_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "source" "support_request_source" NOT NULL DEFAULT 'delegate',
    "response_id" UUID,
    "question_id" UUID,
    "action_id" UUID,
    "context" TEXT NOT NULL DEFAULT '',
    "request" TEXT NOT NULL,
    "barrier" TEXT NOT NULL DEFAULT '',
    "status" "support_request_status" NOT NULL DEFAULT 'open',
    "action_taken" TEXT NOT NULL DEFAULT '',
    "addressed_at" TIMESTAMPTZ(3),
    "addressed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_request_response_id_question_id_key" ON "support_request"("response_id", "question_id");
CREATE INDEX "support_request_event_id_status_idx" ON "support_request"("event_id", "status");
CREATE INDEX "support_request_delegate_id_idx" ON "support_request"("delegate_id");

ALTER TABLE "support_request" ADD CONSTRAINT "support_request_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
