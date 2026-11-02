-- The privacy notice delegates are shown at first sign-in (E3-7, brief section 6.4).
--
-- The wording is data, not code: it names the organiser and the event, and M.Bryan revises it
-- without a deploy. Acceptance already had a home in consent_record; what was missing was the
-- notice itself and any version to point acceptance at.
CREATE TABLE "consent_notice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document" "consent_document" NOT NULL DEFAULT 'privacy',
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_notice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consent_notice_document_version_key" ON "consent_notice"("document", "version");
CREATE INDEX "consent_notice_document_effective_from_idx" ON "consent_notice"("document", "effective_from");

-- Version 1: the approved section 6.4 text, verbatim. Paragraphs are separated by a blank line.
INSERT INTO "consent_notice" ("document", "version", "title", "headline", "body", "effective_from")
VALUES (
    'privacy',
    'v1',
    'Privacy Information for Delegates',
    'Your Privacy Matters to Us',
    'M.Bryan Consulting Limited collects the information you provide when you sign up for the ITTEC Conference Impact Measurement Platform. This includes your contact and professional details, conference expectations, assessment responses, Individual Transfer Plan, reminder preferences and updates on your application and results.

We use this information to manage your participation, support you in applying what you learn, send your selected reminders, evaluate the value of ITTEC and improve future conferences and programmes.

We take steps to protect your information and limit access to authorised persons. Your individual account gives you access to your own information.

After the conference, we will invite you to share updates on your progress, application, support needs and any results. You can select and update your preferences for application reminders on the platform.

M.Bryan may use combined or de-identified information in conference reports. Where an organisation nominated you to attend, information about your participation and progress may be shared with that organisation in line with the arrangements communicated to you. We will seek your permission before sharing your identifiable comments, case examples or other individual information with sponsors or other parties.

If you have questions about your information, wish to update it or want to discuss how it is used, please contact conference@mbryanconsultinggroup.com.',
    '2026-11-03T00:00:00.000Z'
);
