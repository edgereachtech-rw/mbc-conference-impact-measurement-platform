-- A section's description can be shown as a highlighted introduction (decision of 2026-11-04).
--
-- Some sections open with a line the delegate has to read before the questions make sense -- a
-- stem such as "How confident are you in your ability to:", or a note about what the section is
-- for. As plain grey text under the title it is easy to skip. This marks the sections whose
-- description is an introduction rather than a subtitle; the words themselves stay in the
-- existing description, so nothing has to be re-entered and a section can be switched either way.
ALTER TABLE "assessment_section"
    ADD COLUMN "highlight_description" BOOLEAN NOT NULL DEFAULT false;
