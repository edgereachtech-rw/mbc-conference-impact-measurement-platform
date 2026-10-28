# M.Bryan Conference Impact Measurement Platform: Product Backlog

**First pilot:** ITTEC 2026 (November 12-13, 2026, physical and virtual)
**Production go-live:** Saturday, November 7, 2026
**Source:** *M.Bryan ITTEC Measurement Impact Platform: Development Workplan and Requirements* (section numbers below refer to that document)
**Stack:** Next.js (TypeScript) + Express.js API + PostgreSQL 16, Docker Compose on a VPS, Garage (S3-compatible object storage, AGPL-3.0; replaces MinIO, whose Docker repository is no longer available) storage, SMTP relay for email, pg-boss worker for jobs
**Backlog date:** October 27, 2026

---

## 1. How to read this backlog

**Priority**
- **P0:** Must be live on November 7 (conference-critical or required by Section 19).
- **P1:** Required by the workplan for November 7, but the first thing to cut if the go/no-go check on Nov 4 fails.
- **P2:** Required by the workplan but can follow go-live (post-launch release before the first 30-day follow-up).

**Increments (a testable unit every two days)**

| Inc | Delivered by | Theme |
|---|---|---|
| **1** | Thu Oct 29 | Foundation, delegate import, sign-in and access control |
| **2** | Sat Oct 31 | Form engine and pre-conference assessment |
| **3** | Mon Nov 2 | Conference-day tools: attendance, check-ins, session feedback, support requests |
| **4** | Wed Nov 4 | Transfer Plan, reminder preferences, final evaluation |
| **5** | Fri Nov 6 | Follow-ups, reminder engine, dashboard and indicators, exports; load/restore/access tests |
| **6** | Sat Nov 7 | Production go-live |
| Post | After Nov 7 | 180-day automation, PDF/DOCX reports, extra channels, Phase 5 review |

**Gates**
- **Oct 30:** content freeze (question wording, options, scoring, form logic).
- **Nov 4 (evening):** go/no-go check. If Inc 4 tests are not passing, cut P1 items before moving the date.
- **Nov 6:** code freeze after staging tests pass.

**Definition of done (every story)**
1. Works on a common mobile phone (Section 6.2, Phase 2 "Mobile use").
2. Validation enforced on the server as well as the client.
3. Role/access checks covered by automated tests.
4. Migration applies cleanly on a copy of staging data.
5. Deployed to staging, test checklist signed off by M.Bryan.
6. No blocking or major defects open.

---

## 2. Roles

| Role | Description | Sees |
|---|---|---|
| **Delegate** | Registered participant with one unique account | Only their own information (S3.1, S13.2, S16) |
| **M.Bryan admin** | Manages conference, reviews data, generates reports | All conference data for ITTEC |
| **M.Bryan analyst** | Reviews responses and reports | Read-only data and exports (no corrections) |
| **Development team** | Builds, tests, operates, supports | Technical access; response content only where needed for support |
| **Speaker/Facilitator** | Receives feedback on their own session | Only their own session's feedback, anonymised unless permission given (S8.4) |

---

## 3. Epics overview

| ID | Epic | Priority | Inc |
|---|---|---|---|
| E0 | Foundation, DevOps and operations | P0 | 1, 5, 6 |
| E1 | Conference setup (reusable event model) | P0 | 1-2 |
| E2 | Delegate records and registration import | P0 | 1 |
| E3 | Sign-up, sign-in and access control | P0 | 1 |
| E4 | Question and form engine | P0 | 2 |
| E5 | Pre-conference assessment | P0 | 2 |
| E6 | Attendance | P0 | 3 |
| E7 | Day 1 and Day 2 check-ins | P0 | 3 |
| E8 | Session feedback | P0 | 3 |
| E9 | Individual Transfer Plan | P0 | 4 |
| E10 | Reminder preferences and reminder engine | P0 / P1 | 4-5 |
| E11 | End-of-conference evaluation | P0 | 4 |
| E12 | Post-conference follow-ups and action status | P1 | 5 |
| E13 | Transfer support | P1 | 3, 5 |
| E14 | Business measures and evidence | P1 | 4 |
| E15 | M.Bryan dashboard and core indicators | P1 | 5 |
| E16 | Reports and exports | P1 / P2 | 5, Post |
| E17 | Security, privacy, audit, backup | P0 | 1-6 |
| E18 | Testing and acceptance (Phase 2) | P0 | 1-6 |
| E19 | Live operation, handover, review (Phases 3-5, S18) | P0 / P2 | 6, Post |

---

## E0. Foundation, DevOps and operations

**Goal:** a repeatable, monitored, recoverable environment (S16, S17 Phase 0).

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E0-1 | As the dev team, I want a monorepo with `apps/web`, `apps/api`, `packages/shared` so rules are written once | Shared Zod schemas, types and scoring rules imported by both apps; lint, type-check and tests run in CI | P0 | 1 |
| E0-2 | As the dev team, I want Docker Compose deployment | Services: caddy, web, api, worker, db, garage (S3-compatible, replaces MinIO), backup. Only Caddy publishes ports. Healthchecks on api and db. Images pinned to exact versions. Named volumes never removed in production | P0 | 1 |
| E0-3 | As the dev team, I want CI/CD | Push to main builds images tagged with the commit, deploys to staging, runs migrations as a one-off command. Rollback = redeploy previous tag | P0 | 1 |
| E0-4 | As the dev team, I want HTTPS on a dedicated subdomain | Valid certificate, HTTP redirects to HTTPS, one domain for web and `/api` (no CORS) | P0 | 1 |
| E0-5 | As the dev team, I want a staging environment mirroring production | Separate database, subdomain and credentials. Seeded with test data flagged `is_test` | P0 | 1 |
| E0-6 | As the dev team, I want error tracking and structured logs | Sentry in web and api; JSON logs (pino) with rotation limits; no personal data in logs | P0 | 1 |
| E0-7 | As the dev team, I want daily backups | `pg_dump` encrypted and sent off-site; object storage (Garage) files synced off-site; heartbeat to Healthchecks.io; hourly dumps on Nov 12-13 | P0 | 1, 6 |
| E0-8 | As the dev team, I want uptime and server alerts | Uptime check on sign-in page and a form URL; CPU/memory/disk alerts at 80-85%; failed-job alert; SSL expiry alert | P0 | 5 |
| E0-9 | As the dev team, I want a worker heartbeat | Worker pings Healthchecks.io every few minutes; alert if missed for 5 minutes | P0 | 5 |
| E0-10 | As the dev team, I want server hardening | SSH key only, firewall 22/80/443, Fail2ban, automatic security updates, separate sudo users | P0 | 1 |
| E0-11 | As M.Bryan, I want a runbook | One page each: site down, queue/scheduler stopped, data problem and restore, named primary and backup contact with phone numbers | P0 | 6 |
| E0-12 | As the dev team, I want email domain authentication | SPF, DKIM, DMARC configured for the sending domain; magic-link delivery tested to Gmail, Outlook and a corporate mailbox | P0 | 1 |

---

## E1. Conference setup (S5)

**Goal:** ITTEC 2026 configured, and the structure reusable for other events (S1, S5).

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E1-1 | As M.Bryan, I want to define an event | Name, theme, dates, location, format, status. Every record belongs to an event (`event_id`) so a new event is configuration, not code | P0 | 1 |
| E1-2 | As M.Bryan, I want participation categories | Physical and virtual categories linked to registrations | P0 | 1 |
| E1-3 | As M.Bryan, I want conference sessions | Session title, date, start/end time, speakers/facilitators, day (1 or 2), type (including Transfer Planning), objectives and intended learning outcomes | P0 | 2 |
| E1-4 | As M.Bryan, I want a stage schedule | Stages: Before ITTEC, Day 1, Day 2, Closing Transfer Planning, End of conference, 30/60/90/180-day follow-ups. Each with open/close dates and editable follow-up dates (S4: "must allow M.Bryan to adjust follow-up dates") | P0 | 2, 5 |
| E1-5 | As M.Bryan, I want reporting periods | Named periods with start/end dates used by reports and the dashboard | P1 | 5 |
| E1-6 | As M.Bryan, I want to copy an event's setup for a future conference | Duplicate event with sessions, forms, stages; no delegate data copied | P2 | Post |
| E1-7 | As the dev team, I want ITTEC 2026 seeded | All sessions, objectives and dates entered once confirmed by M.Bryan. **Dependency: M.Bryan supplies the session list and speakers** | P0 | 2 |

---

## E2. Delegate records and registration import (S6.1)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E2-1 | As the dev team, I want to import registered delegates from CSV/XLSX | Maps columns; validates required fields; dry-run report before commit; row-level error report (row number, reason); import is repeatable without creating duplicates | P0 | 1 |
| E2-2 | As the platform, I assign each delegate a unique participant record | Stable participant ID; linked to ITTEC 2026; stores attendance format (physical/virtual) | P0 | 1 |
| E2-3 | As M.Bryan, I want possible duplicates detected | Flags records with the same email, or same normalised name + organisation. Admin can confirm as duplicate (excluded from counts) or dismiss. Confirmed duplicates keep history | P0 | 1 |
| E2-4 | As an authorised user, I want to correct delegate records | Edit name, email, organisation, role, country, format, status. Every change recorded (who, when, old and new value) | P0 | 1 |
| E2-5 | As M.Bryan, I want registration status | Valid, cancelled, duplicate, test. Cancelled and test records excluded from valid-registration counts (S14.1) | P0 | 1 |
| E2-6 | As M.Bryan, I want registration, attendance and assessment status per delegate | List/filter delegates by sign-up, pre-assessment, attendance by day, plan, final evaluation, follow-up status | P0 | 3 |
| E2-7 | As M.Bryan, I want the nominating organisation recorded | Delegate capacity (individual / nominee of an organisation / other) and organisation name stored for organisation reports (S7.2, S13.3) | P1 | 2 |

---

## E3. Sign-up, sign-in and access control (S3, S6.2, S16)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E3-1 | As a delegate, I want an invitation to join | Invitation email with single-use link tied to my registration. Resend and bulk-send from admin. Invitation status tracked (sent, bounced, accepted) | P0 | 1 |
| E3-2 | As a delegate, I want to sign up with my registered email | Account linked to my existing registration so all records stay connected. Unregistered emails are refused with a helpful message and a contact address | P0 | 1 |
| E3-3 | As a delegate, I want simple passwordless sign-in | Email magic link or one-time code; code expires quickly; rate-limited; session via `httpOnly`, `Secure`, `SameSite` cookie; works after the conference | P0 | 1 |
| E3-4 | As a delegate, I want to recover access | Same flow as sign-in; support contact (`conference@mbryanconsultinggroup.com`) shown; admin can change the email on record (audited) | P0 | 1 |
| E3-5 | As a delegate, I want to stay signed in on my phone during the conference | Session lasts the conference week; deep links (e.g. session QR) sign me in then return me to the target page | P0 | 1 |
| E3-6 | As the platform, I enforce role-based access on the server | Delegates access only their own records; admin/analyst/support/speaker permissions as in section 2. Every API route has an authorisation check and test | P0 | 1 |
| E3-7 | As a delegate, I want to see privacy information at sign-up | Section 6.4 text displayed and acceptance recorded with timestamp and version | P0 | 1 |
| E3-8 | As a delegate, I want to be told about both reminders and evaluation follow-ups | Sign-up and reminder screens explain the difference (S4 note: reminders are chosen by me; evaluation follow-ups are scheduled by M.Bryan) | P0 | 4 |
| E3-9 | As an M.Bryan admin, I want to manage user accounts for staff | Create admin/analyst/support/speaker users; deactivate; audit | P0 | 1 |

---

## E4. Question and form engine (S15.3)

**Goal:** all questions entered as data, versioned, reusable.

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E4-1 | As the dev team, I want forms and questions stored as data | Form per stage (pre-conference, session feedback, Day 1, Day 2, Transfer Plan, end-of-conference, follow-ups). Question has type, wording, options, required/optional, scoring, display conditions | P0 | 2 |
| E4-2 | As M.Bryan, I want the supported answer types | Single select, multi-select, rating scales, short text, long text, date, number (S15.3) | P0 | 2 |
| E4-3 | As M.Bryan, I want required and optional questions | A form can be submitted once all required questions are answered | P0 | 2 |
| E4-4 | As M.Bryan, I want exclusivity rules | "None of the above" and "Not applicable to my role" cannot be selected with another option, enforced client and server (S7.7) | P0 | 2 |
| E4-5 | As M.Bryan, I want conditional display | Show questions by attendance format (physical/virtual), by whether a pre-conference answer exists, and by earlier answers (status-driven follow-ups) | P0 | 2 |
| E4-6 | As the platform, I preserve question history | Editing a question after responses exist creates a new version. Each response stores the question version answered. Original and revised wording and scoring retained (S15.3) | P0 | 2 |
| E4-7 | As the platform, I keep identical wording for repeated questions | Pre and post knowledge questions and confidence statements share one question identity so wording, options and scoring cannot diverge | P0 | 2 |
| E4-8 | As a delegate, I want to save a draft and resume | Autosave; partial submissions retained; resume on another device | P0 | 2 |
| E4-9 | As a delegate, I want one submission per form per stage | Duplicate submissions prevented by a database constraint; an allowed update replaces the answer set and records history | P0 | 2 |
| E4-10 | As M.Bryan, I want to view and update questions for future conferences | Admin screen to list, edit (creating versions) and reorder questions per form; changes never alter earlier responses | P1 | 5 |
| E4-11 | As a delegate, I want to see the form in clear, mobile-first layout | Large touch targets, progress indicator, works with narrow screens | P0 | 2 |
| E4-12 | As a delegate, I want to see my pre-conference answers while completing later forms | Reusable "show earlier answer" component (used by Transfer Plan, final evaluation, follow-ups) | P0 | 2 |

---

## E5. Pre-conference assessment (S7)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E5-1 | As a delegate, I want to confirm my details | Name, email, organisation, job title/role, country, attendance format, capacity (individual / nominee of an organisation / other). Prefilled from my registration and editable where allowed (S7.2) | P0 | 2 |
| E5-2 | As a delegate, I want to state expectations and challenges | Five questions in S7.3, stored as separate answers (see Appendix A, Q-EXP-1 to 5) | P0 | 2 |
| E5-3 | As a delegate, I want to rate my current practices | Seven statements; scale Always, Often, Sometimes, Rarely, Never, Not applicable to my role. Each statement stored separately. "Not applicable" is **not** scored as a low rating (S7.4) | P0 | 2 |
| E5-4 | As a delegate, I want to answer five baseline knowledge questions | Introduction text exactly as in S7.5. Options A-E with "I am not so sure" as E. Correct answers: Q1 B, Q2 C, Q3 D, Q4 A, Q5 C. Each answer stored | P0 | 2 |
| E5-5 | As a delegate, I want to see immediately whether each knowledge answer is correct | Result shown after each answer (S7.5 note). **See open question OQ-2** | P0 | 2 |
| E5-6 | As the platform, I calculate the knowledge score | 1 point per correct answer; incorrect or "not sure" = 0; total 5; percentage = correct / 5 x 100; total score stored with each answer | P0 | 2 |
| E5-7 | As a delegate, I want to rate my confidence | Seven statements, scale 1-5 plus "Not applicable to my role" (S7.6). Same statements and scale reused in the final assessment | P0 | 2 |
| E5-8 | As a delegate, I want to say which tools and practices I use | Multi-select list from S7.7 with "None of the above", "Not applicable to my role" and "Other: please specify" (text required when Other selected). Exclusivity enforced | P0 | 2 |
| E5-9 | As M.Bryan, I want the pre-conference completion count | Number of invited delegates, started, submitted; list of non-completers for reminders | P0 | 2 |
| E5-10 | As M.Bryan, I want a summary of delegate expectations and needs before the conference | Export/printable summary of S7.3 answers and baseline results (S17 Phase 3) | P1 | 5 |

---

## E6. Attendance (S8.1)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E6-1 | As event staff, I want to check in physical delegates | Search by name/email, mark day 1 and/or day 2 presence; timestamp and user recorded; usable on a phone or tablet | P0 | 3 |
| E6-2 | As the dev team, I want to record or import virtual attendance | CSV import of virtual platform attendance reports; match by email; unmatched rows reported | P0 | 3 |
| E6-3 | As an authorised user, I want to manually correct attendance | Change recorded with reason; audited | P0 | 3 |
| E6-4 | As staff, I want session-level attendance where practical | Mark presence per session; session feedback eligibility uses it where captured | P1 | 3 |
| E6-5 | As M.Bryan, I want registered and attended kept separate | Registered, attended day 1, attended day 2, attended any part. **Attendee = registered delegate attending at least part of one conference day, physically or virtually** (S8.1) | P0 | 3 |
| E6-6 | As M.Bryan, I want attendance by day, shown in reports | Counts and percentages per day, by format | P0 | 5 |

---

## E7. Day 1 and Day 2 check-ins (S8.2, S8.3)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E7-1 | As a delegate, I want a brief Day 1 check-in at the end of Day 1 | Three questions (Appendix A, Q-D1-1 to 3), open only from Day 1 end | P0 | 3 |
| E7-2 | As M.Bryan, I want Day 1 Question 3 available promptly | Answers to Q-D1-3 appear in an admin "issues for attention" view within seconds of submission, with a notification email to a configured M.Bryan address. Shows delegate and time (S8.2) | P0 | 3 |
| E7-3 | As a delegate, I want a separate Day 2 check-in | Four questions (Appendix A, Q-D2-1 to 4); separate form from the Transfer Planning session and the final evaluation; does not replace either (S8.3) | P0 | 3 |
| E7-4 | As M.Bryan, I want to review check-in responses | Table with filters, export to CSV, counts of submissions | P0 | 3 |

---

## E8. Session feedback (S8.4)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E8-1 | As M.Bryan, I want a link and QR code per session | Stable deep link per session; QR image generated and downloadable for display | P0 | 3 |
| E8-2 | As a delegate, I want the right form to open directly | After signing in (if needed), the form opens with **session title and speaker/facilitator already displayed**; no session picker | P0 | 3 |
| E8-3 | As a delegate, I want to rate the session | Q1-Q3 required; scale Excellent / Good / Fair / Poor. Q4-Q5 optional text (Appendix A, Q-SF-1 to 5) | P0 | 3 |
| E8-4 | As a delegate, I want confirmation after submitting | Clear confirmation message | P0 | 3 |
| E8-5 | As a delegate, I want only sessions I attended to be evaluated | Form limited to delegates recorded as attending the session (or the day, if session attendance not captured). Clear message otherwise | P0 | 3 |
| E8-6 | As a delegate, I want the form to stay open after the five minutes | Available for the rest of the conference and follow-up period; no hard close at five minutes | P0 | 3 |
| E8-7 | As the platform, I prevent duplicate session feedback | One response per delegate per session (database constraint). Delegate may update; **dashboard counts only the latest response** | P0 | 3 |
| E8-8 | As M.Bryan, I want per-session results | Title and speaker; number who submitted; for Q1-Q3 number and percentage per rating, using responses to that question as the denominator and displayed as "15 of 20 responses (75%)"; written responses to Q4-Q5 | P0 | 3 |
| E8-9 | As M.Bryan, I want to view and export session feedback | Filter by session and day; CSV export | P0 | 3 |
| E8-10 | As a speaker/facilitator, I want feedback on my own session only | Role-limited view; delegates not identified unless permission is recorded; written comments anonymised | P1 | 5 |
| E8-11 | As both physical and virtual delegates, I want equal access | Same link and QR/link on a virtual platform chat; tested on both | P0 | 3 |

---

## E9. Individual Transfer Plan (S9)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E9-1 | As a delegate, I want to start my plan on Day 1 and save a draft | Draft can be saved with any fields incomplete; autosave | P0 | 4 |
| E9-2 | As a delegate, I want to open the **same plan** on Day 2 | One continuous plan per delegate across both Transfer Planning sessions; same record reopened (S9.1, S9.3) | P0 | 4 |
| E9-3 | As a delegate, I want to record the 14 plan fields | Priority learning, action, workplace opportunity, first step, start date, target date, stakeholders, support, potential barriers, evidence of application, expected result, measure and baseline, review date, reminder preferences (S9.2; Appendix A, Q-TP-1 to 14) | P0 | 4 |
| E9-4 | As a delegate, I want more than one action | Multiple actions per plan; one marked **first priority**; each action has its own status (E12) | P0 | 4 |
| E9-5 | As a delegate, I want "Not yet known" / "Not applicable" for measure and baseline | Allowed values accepted in place of a measure | P0 | 4 |
| E9-6 | As a delegate, I want to see my pre-conference answers beside the plan | Display "What would you like to learn or gain from the conference?" and "What would you like to do differently after the conference?" without re-entry (S9.2 developer instruction) | P0 | 4 |
| E9-7 | As a delegate, I want to submit my plan at the end of the Day 2 session | Submit action validates required fields, freezes **version 1**, records time | P0 | 4 |
| E9-8 | As a delegate, I want to revise my plan after the conference | Edit actions, dates and details; each submitted change creates a new version; the **original submitted plan and every later change retained** and viewable by delegate and M.Bryan (S9.3) | P0 | 4 |
| E9-9 | As M.Bryan, I want plan counts | Number started, submitted; list by delegate; "completed" meaning a submitted plan (S14.1) | P0 | 4 |
| E9-10 | As both physical and virtual delegates, I want access during the scheduled sessions | Tested on both formats | P0 | 4 |
| E9-11 | As a delegate, I want to access my plan after the conference | Plan page from the account home; read and update | P0 | 4 |
| E9-12 | As M.Bryan, I want to review Transfer Plans | Searchable list, view versions, export, filter by status and by action | P0 | 4 |

---

## E10. Reminder preferences and reminder engine (S6.3)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E10-1 | As a delegate, I want to set when reminders begin | Start date | P0 | 4 |
| E10-2 | As a delegate, I want to choose frequency | Once; every other day; twice a week (choose days); weekly; every two weeks; monthly | P0 | 4 |
| E10-3 | As a delegate, I want a preferred day and time | Day/time (where applicable) with my timezone; stored in UTC | P0 | 4 |
| E10-4 | As a delegate, I want to choose the channel | Email at launch; model supports further channels (SMS, WhatsApp) later | P0 | 4 |
| E10-5 | As a delegate, I want to set an end date or stop reminders | Optional end date; "stop reminders" action; resume possible | P0 | 4 |
| E10-6 | As a delegate, I want to change my preferences from my account | Includes setting reminders at the end-of-conference stage (S4) and as part of follow-ups | P0 | 4 |
| E10-7 | As the platform, I record preferences and each reminder sent | `reminder_preference` (with history) and `reminder_log` (time, channel, status, provider message ID) | P0 | 5 |
| E10-8 | As the platform, I send reminders on schedule | Worker sends due reminders; **idempotent** (never sent twice, even if the worker restarts or overlaps); retries on failure; stops at end date or when stopped | P0 | 5 |
| E10-9 | As a delegate, I want reminders to refer to my Transfer Plan | Email shows my first-priority action and next step and links to my plan; encourages progress (S6.3) | P0 | 5 |
| E10-10 | As M.Bryan, I want to see reminder preferences | Counts and breakdown by frequency and channel in the dashboard | P1 | 5 |
| E10-11 | As the platform, I handle email bounces | Provider webhook marks bounced/complained addresses; admin sees affected delegates | P1 | 5 |
| E10-12 | As a delegate, I want unsubscribe in every reminder | One-click link that pauses reminders | P0 | 5 |

---

## E11. End-of-conference evaluation (S10)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E11-1 | As a delegate, I want to rate the conference experience | Six items, scale Excellent / Good / Fair / Poor / Not applicable (S10.2); plus "What did ITTEC do well?" and "What should be improved?" | P0 | 4 |
| E11-2 | As a physical delegate, I want physical-experience questions | Registration and check-in; venue and facilities; accessibility and comfort; on-site support. Shown only to delegates whose record says physical (S10.3) | P0 | 4 |
| E11-3 | As a virtual delegate, I want virtual-experience questions | Ease of joining; audio and visual quality; access to sessions; ability to participate and engage; technical support. Shown only to virtual delegates | P0 | 4 |
| E11-4 | As a delegate, I want to repeat the five knowledge questions | Same wording, options and scoring as S7.5. Calculates pre score, post score and difference, in percentage points (S10.4A). **See OQ-2 on feedback** | P0 | 4 |
| E11-5 | As M.Bryan, I want paired knowledge results | Number of delegates who completed all five at both stages; average pre and post for **those same delegates**; change in percentage points. Never compare different groups as individual change | P0 | 5 |
| E11-6 | As a delegate, I want to repeat the confidence statements | Same seven statements and scale as S7.6 | P0 | 4 |
| E11-7 | As M.Bryan, I want paired confidence results | Per statement: number answering both times, average before, average after, change. Excludes "Not applicable" and unanswered. Labelled **self-reported confidence** | P0 | 5 |
| E11-8 | As a delegate, I want to describe learning gained | Three open questions (S10.4C; Q-FE-C1 to 3) | P0 | 4 |
| E11-9 | As a delegate, I want to describe unresolved needs | Three open questions (S10.4D) | P0 | 4 |
| E11-10 | As a delegate, I want to indicate readiness to apply | Readiness (Ready to begin now / Ready, but support is needed / Not yet ready / Not applicable); plan completed (Yes / Started but not completed / No); support that would help | P0 | 4 |
| E11-11 | As a delegate, I want the plan status prefilled | Uses the existing Transfer Plan record to show whether a plan was submitted, so I do not re-enter it (S10.4E) | P0 | 4 |
| E11-12 | As a delegate with a recorded expectation, I want to assess it | Display the pre-conference answer to "What would you like to learn or gain...?". Ask "To what extent did ITTEC provide what you hoped to gain?" (Fully / Partly / Not yet sure / Not at all / No longer applicable) then "Please explain your response. What did you gain, and what is still missing?" (S10.5) | P0 | 4 |
| E11-13 | As a delegate with **no** pre-conference expectation, I want to add one | Message: "You did not record this before ITTEC. Looking back, what did you hope to gain from attending?"; text box and "Prefer not to answer". Answers labelled **"Recorded after the conference"** and reported separately. Then asks "To what extent was this expectation met?" (Met / Partly met / Not yet met / Not met / No longer applicable). **See OQ-4 on the two scales** | P0 | 4 |
| E11-14 | As a delegate, I want the other expectation questions asked once | Which expectation was met most effectively; which remains partly met or unmet; what made ITTEC valuable; what would have made it more valuable. Duplicate "extent met" question removed per the developer instruction | P0 | 4 |
| E11-15 | As M.Bryan, I want the final evaluation completion rate | Attendees invited, submitted, rate (S14.1) | P0 | 5 |

---

## E12. Post-conference follow-ups and action status (S11)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E12-1 | As M.Bryan, I want to schedule 30/60/90-day follow-ups | Dates default to about 30/60/90 days after the conference and are **editable by M.Bryan**; invitations tracked per delegate | P0 | 5 |
| E12-2 | As a delegate, I want each follow-up to show my Transfer Plan | Plan displayed or linked in every follow-up; I do not re-enter it (S11.1) | P0 | 5 |
| E12-3 | As a delegate, I want my pre-conference "do differently" answer shown | Displayed alongside the plan in each follow-up (S11.1 developer instruction) | P0 | 5 |
| E12-4 | As a delegate, I want a 30-day follow-up | Seven questions (Appendix A, Q-F30-1 to 7), including whether to change reminder preferences | P0 | 5 |
| E12-5 | As a delegate, I want a 60-day follow-up | Seven questions (Q-F60-1 to 7) | P0 | 5 |
| E12-6 | As a delegate, I want a 90-day follow-up | Seven questions (Q-F90-1 to 7), including expectations met | P0 | 5 |
| E12-7 | As M.Bryan, I want a longer-term (about 180 days or later) follow-up to selected delegates or organisations | Form and selection model built now; scheduling and sending configured after go-live | P2 | Post |
| E12-8 | As a delegate, I want to set one current status per action | Statuses: Not yet started, Started, In progress, Applied, Applied consistently, Completed, Changed, No longer applicable (S11.6; definitions in Appendix B) | P0 | 5 |
| E12-9 | As the platform, I ask for status-specific details | Changed / No longer applicable: brief explanation. Applied / Applied consistently: an example and when it occurred. Completed: what was completed and when | P0 | 5 |
| E12-10 | As the platform, I retain status history | Every status change stored with explanation and time. A one-time action may be completed without being used consistently | P0 | 5 |
| E12-11 | As M.Bryan, I want application kept separate from progress | "Started", "In progress" and "Completed" do not count as application; application reported or evidenced separately (S11.6) | P0 | 5 |
| E12-12 | As M.Bryan, I want the number of actions in each current status | Each action counted once, in its latest status | P0 | 5 |
| E12-13 | As M.Bryan, I want follow-up response rates | Per stage: submitted / invited (S14.1) | P0 | 5 |
| E12-14 | As the platform, I send follow-up invitations | Worker sends invitation emails at the scheduled date; reminder emails for non-responders at configurable intervals; idempotent | P0 | 5 |
| E12-15 | As a delegate, I want to record progress between follow-ups | Update action status and progress notes anytime from my account (S3.1, S9.3) | P1 | 5 |

---

## E13. Transfer support (S11.7)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E13-1 | As a delegate, I want to request support | Support request form (what support, related action); available from the account home, the plan and follow-ups | P0 | 3 |
| E13-2 | As M.Bryan, I want to see who requested support and what | List with delegate, support requested, date, linked action | P1 | 5 |
| E13-3 | As M.Bryan, I want to record the action taken | Free-text response and who handled it | P1 | 5 |
| E13-4 | As M.Bryan, I want request status | Open or addressed; filter and counts | P1 | 5 |
| E13-5 | As M.Bryan, I want common barriers summarised | Count of barriers by category (tagging of free-text barriers by M.Bryan) | P1 | 5 |
| E13-6 | As a delegate, I want to see my support requests | Part of delegate view (S13.2) | P1 | 5 |

---

## E14. Business measures and evidence (S12)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E14-1 | As a delegate, I want to record a measure for an action | Measure, why it matters, baseline, target, baseline date, target date, actual result and date, source, other influencing factors | P1 | 4 |
| E14-2 | As a delegate, I want "Not yet known" / "Not applicable" | Accepted wherever a measure cannot be given | P1 | 4 |
| E14-3 | As a delegate, I want to describe or provide evidence | Types: example of what I did differently, completed work product or process, manager/stakeholder confirmation, organisational measure, case example. Description text required; **file upload optional** to MinIO with type/size limits and virus scanning | P1 | 4 |
| E14-4 | As M.Bryan, I want evidence labelled | Each item labelled **self-reported** or **supported by another source**; reports keep the distinction (S12.2, S13.3) | P1 | 5 |
| E14-5 | As a delegate, I do not have to disclose confidential organisational information | Notice on every evidence form; all fields optional | P0 | 4 |

---

## E15. M.Bryan dashboard and core indicators (S13.1, S14)

**Rule for every figure:** show **number and percentage** plus the group measured and the number of respondents. Never describe respondents as all attendees (e.g. "24 of 40 respondents reported application", not "60% of attendees"). Exclude test records, confirmed duplicates, cancelled registrations from the valid count, unanswered questions from that question's denominator, and "Not applicable" from scored confidence.

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E15-1 | Platform sign-up rate | Registered delegates who created an account / valid registered delegates x 100 | P1 | 5 |
| E15-2 | Attendance rate | Registered delegates recorded attending at least part of one day / valid registered x 100; by day and format | P1 | 5 |
| E15-3 | Pre-conference response rate | Submitted / registered delegates invited x 100 | P1 | 5 |
| E15-4 | End-of-conference response rate | Attendees who submitted / attendees invited x 100 | P1 | 5 |
| E15-5 | Transfer Plan completion rate | Attendees with a submitted completed plan / attendees x 100 | P1 | 5 |
| E15-6 | Follow-up response rate | Submitted / invited, separately for 30, 60, 90 and later | P1 | 5 |
| E15-7 | Reported application rate | Respondents who reported applying learning at least once / respondents who answered the application question x 100; shown as "X of Y respondents" | P1 | 5 |
| E15-8 | Knowledge score | Correct answers / 5 x 100 | P0 | 5 |
| E15-9 | Knowledge scores before and after | Paired delegates only; average post minus average pre in percentage points; number of paired delegates shown | P0 | 5 |
| E15-10 | Confidence change | Per statement; paired; "Not applicable" excluded | P0 | 5 |
| E15-11 | Expectation status | Count and percentage per status among expectations assessed at that stage, shown separately; "Recorded after the conference" reported separately | P1 | 5 |
| E15-12 | Participation panel | Registered, signed up, physical vs virtual, number completing each assessment, response rates at each stage | P1 | 5 |
| E15-13 | Expectations and baseline panel | Expectations and priority challenges (text list/themes), current practices, baseline knowledge and confidence | P1 | 5 |
| E15-14 | Experience and learning panel | Experience ratings, physical vs virtual feedback, Day 1 and Day 2 learning, knowledge results, self-reported confidence, expectations at the end | P1 | 5 |
| E15-15 | Transfer and application panel | Plans started and completed, priority actions, reminder preferences, application status counts, support needs and barriers, follow-up responses, reported changes and evidence | P1 | 5 |
| E15-16 | Expectations and results panel | Progress against delegate expectations; nominating organisation expectations where collected; reported measures; examples | P1 | 5 |
| E15-17 | Interpretation labels | Self-reported information labelled; respondent numbers beside every percentage; knowledge, confidence and satisfaction shown separately; intended vs actual application distinguished; missing-response limitations shown (S15.2) | P0 | 5 |
| E15-18 | Indicator logic as database views with a test dataset | SQL views implement each rule; a seeded dataset with known results is used by automated tests; the dashboard matches it exactly | P0 | 5 |

---

## E16. Reports and exports (S13.3, S16)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E16-1 | As M.Bryan, I want CSV/XLSX export of every data set | Delegates, registrations, responses by form, session feedback, plans (all versions), action status history, reminders, support requests, attendance. Each export audited | P0 | 5 |
| E16-2 | As M.Bryan, I want an immediate conference report | Participation, experience, learning, expectations, Transfer Plans; shows reporting date, response numbers and limitations | P1 | 5 |
| E16-3 | As M.Bryan, I want a follow-up report | Application, support, barriers, expectations and available results | P1 | 5 |
| E16-4 | As M.Bryan, I want an organisation report where agreed | Nominated delegates and organisational expectations; only delegates who are nominees of that organisation | P2 | Post |
| E16-5 | As M.Bryan, I want a sponsor/partner report | Approved findings only; external reports require an **approved** state before they can be downloaded or shared | P2 | Post |
| E16-6 | As M.Bryan, I want reports to distinguish self-reported from evidenced information | Labels in every table/section | P1 | 5 |
| E16-7 | As M.Bryan, I want PDF/DOCX report generation | Worker renders report templates to PDF/DOCX | P2 | Post |
| E16-8 | As M.Bryan, I want to control what is included in reports | Include/exclude sections; identifiable comments only with recorded permission (S6.4, S16) | P1 | 5 |
| E16-9 | As M.Bryan, I want a full export of M.Bryan's data in a usable format | One-click full export (CSV/JSON bundle) for ownership and handover | P0 | 5 |

---

## E17. Security, privacy, audit and recovery (S16)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E17-1 | Secure individual accounts | Passwordless sign-in, rate limiting, secure cookies, CSRF protection, account lockout on abuse | P0 | 1 |
| E17-2 | Restricted access | Role-based access with server-side checks; delegate isolation test; speaker restricted view | P0 | 1, 5 |
| E17-3 | Secure transport and storage | TLS everywhere; database and backups encrypted; storage private with short-lived signed URLs; secrets only in server environment | P0 | 1 |
| E17-4 | Audit log | Record administrative changes, record corrections, attendance corrections, status overrides, question changes, report approvals, data exports, sign-in anomalies (who, what, when, old/new value) | P0 | 1, 5 |
| E17-5 | Controls over report content | See E16-8 | P1 | 5 |
| E17-6 | Privacy information | Section 6.4 text displayed at sign-up and available in the footer; consent for sharing identifiable comments with sponsors recorded per delegate | P0 | 1 |
| E17-7 | Backup and recovery | Documented process; restore tested end to end before go-live | P0 | 6 |
| E17-8 | Correction process for delegate records | Covered in E2-4; delegate can request correction from their account | P0 | 1 |
| E17-9 | Documentation of ownership and hosting | Platform, data and source-code ownership, hosting and support arrangements written and handed over | P1 | 6 |
| E17-10 | Data minimisation and retention | Define retention period and deletion/anonymisation process; delegate can ask for deletion | P2 | Post |

---

## E18. Testing and acceptance (S17 Phase 2)

Each test is a runnable checklist for M.Bryan plus automated tests where possible.

| ID | Test (workplan) | Required result | Inc |
|---|---|---|---|
| T1 | Sign-up and access | A delegate can sign up, sign in again and recover access | 1 |
| T2 | Delegate journey | A test delegate completes baseline, check-ins, Transfer Plan, final assessment and a simulated follow-up | 5 |
| T3 | Reminder preferences | A delegate selects, updates and stops reminders; the schedule is recorded | 5 |
| T4 | Physical and virtual journeys | Each format receives the appropriate questions | 4 |
| T5 | Mobile use | Works on common mobile devices (Android Chrome, iOS Safari, a small-screen phone) | 2-5 |
| T6 | Record matching | All assessments and plans are linked to the correct delegate account | 5 |
| T7 | Knowledge scoring | Correct answers and paired changes are calculated accurately | 5 |
| T8 | Dashboard calculations | Counts and percentages match a test dataset with known results | 5 |
| T9 | Access controls | Users cannot see information outside their authorised access | 5 |
| T10 | Duplicate handling | Duplicate records and repeat submissions are identified and handled correctly | 5 |
| T11 | Interrupted access | A delegate returns to a saved plan and recovers access when needed | 5 |
| T12 | Reports and exports | Contain the correct data, labels and response counts | 5 |
| T13 | Backup and recovery | The team restores a backup using the documented process; record counts match | 5-6 |
| T14 | Load test (added) | A few hundred simulated delegates submit session feedback and plans within five minutes without errors or slow responses | 5 |
| T15 | Email deliverability (added) | Magic links and reminders reach Gmail, Outlook and a corporate mailbox in the inbox | 1, 5 |
| T16 | Idempotent scheduling (added) | A reminder due now is sent once even if the worker restarts or two workers overlap | 5 |

The team shares a brief test summary and demonstrates the working platform to M.Bryan (S17 Phase 2).

---

## E19. Live operation, handover and review

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E19-1 | Before conference: import and invitations | Import delegates, issue invitations, share the pre-conference assessment, monitor sign-up and completion, send agreed communications | P0 | 6 |
| E19-2 | Before conference: summary | Provide M.Bryan a summary of expectations and needs | P1 | 6 |
| E19-3 | Day 1 operations | Record/import attendance, issue Day 1 check-in, share urgent experience issues promptly | P0 | Nov 12 |
| E19-4 | Day 2 operations | Issue Day 2 check-in, support the 30-minute Transfer Planning session, issue the final evaluation | P0 | Nov 13 |
| E19-5 | Named support person | One named developer available throughout the conference including the Transfer Planning session; backup named | P0 | 6 |
| E19-6 | Immediately after | Review records, completion and data quality; prepare and share the initial experience and learning report | P0 | Nov 14+ |
| E19-7 | Send 30-, 60-, 90-day follow-ups, monitor responses and delivery, provide follow-up reports and support summaries | See E12, E16 | P0 | Post |
| E19-8 | Handover pack (S18) | Access to platform and dashboard; guide to viewing delegate information and reports; guide to exporting data; final question list, options and scoring; calculation rules; privacy and data-sharing information; technical and hosting documentation; backup and recovery arrangements; named support contacts; maintenance and support arrangements | P1 | 6 |
| E19-9 | Phase 5 review | Ease of sign-up and use, completion of assessments and plans, reliability of reminders and follow-ups, report usefulness, data collected, technical issues, changes before another event | P2 | Post |

---

## 4. Increment plan with exit tests

| Inc | Stories | Exit test (M.Bryan can run) |
|---|---|---|
| **1** (Oct 29) | E0-1 to 7, E0-10, E0-12, E1-1, E1-2, E2-1 to 5, E3-1 to 7, E3-9, E17-1 to 4, E17-6, E17-8 | Staging over HTTPS; push deploys; import a test file with duplicates and bad emails and read the error report; invite, sign up and sign in a registered delegate; unregistered email refused; a delegate cannot see another's data; backup restores into an empty database |
| **2** (Oct 31) | E1-3, E1-4 (stages), E1-7, E2-7, E4-1 to 9, E4-11, E4-12, E5-1 to 9 | Complete the pre-conference assessment on a phone, leave and resume; exclusivity rule blocks invalid answers on client and server; knowledge scoring and immediate result correct; admin sees completion count |
| **3** (Nov 2) | E2-6, E6-1 to 5, E7-1 to 4, E8-1 to 9, E8-11, E13-1 | Scan a session QR, sign in, land on the right form; repeat submission updates rather than duplicates; Day 1 Q3 appears in the admin attention view and email; attendance corrections audited; support request creates a record |
| **4** (Nov 4) | E3-8, E9-1 to 12, E10-1 to 6, E11-1 to 4, E11-6, E11-8 to 14, E14-1 to 3, E14-5 | Create a plan on Day 1, edit on Day 2, submit, edit again and confirm version 1 is preserved; physical and virtual delegates get different questions; expectation flows (with and without a pre-conference answer); reminder preferences saved. **Go/no-go check this evening** |
| **5** (Nov 6) | E0-8, E0-9, E4-10, E5-10, E6-6, E8-10, E10-7 to 12, E11-5, E11-7, E11-15, E12-1 to 6, E12-8 to 15, E13-2 to 6, E14-4, E15-1 to 18, E16-1, E16-2, E16-3, E16-6, E16-8, E16-9, E17-2, E17-4, E17-5, T2 to T16 | Dashboard matches the known-results dataset exactly; reminder sent once after worker restart; load test passes; restore test passes; access-control and duplicate tests pass; follow-up forms show the plan. **Code freeze** |
| **6** (Nov 7) | E0-7, E0-11, E17-7, E17-9, E19-1, E19-2, E19-5, E19-8 | Production smoke test of full sign-in-to-submission path; every alert triggered once and received; invitations ready to send; named support contacts confirmed |

**If the Nov 4 check fails, cut in this order:** E14-3 file upload (keep text evidence), E16-3 follow-up report, E15-13 to 16 panel polish, E8-10 speaker view, E13-5 barrier tagging. Core P0 items are not cut.

---

## 5. Open questions (decisions needed; owner: M.Bryan)

| ID | Question | Why it matters | Needed by |
|---|---|---|---|
| **OQ-1** | **Final content freeze.** Are all questions, options and scoring final? | Late changes are the largest rework risk | Oct 30 |
| **OQ-2** | **Immediate right/wrong feedback on knowledge questions (S7.5).** The workplan says delegates see the result immediately. Showing the correct answer before the post-test lets delegates learn the answer from the pre-test and inflates the "change" figure. Options: (a) show correct/incorrect only, never the correct option; (b) show correct/incorrect in the pre-assessment only and not repeat it in the final assessment; (c) as specified. Which? | Affects validity of the paired-change indicator | Oct 30 |
| **OQ-3** | **"I am not so sure" vs "I am not sure".** Questions 1-3 use "I am not so sure", Questions 4-5 use "I am not sure", and the scoring rule says "I do not know or I am not sure". Standardise to one wording? | Workplan requires identical wording before and after | Oct 30 |
| **OQ-4** | **Two expectation scales in S10.5.** The first reads Fully / Partly / Not yet sure / Not at all / No longer applicable; the second reads Met / Partly met / Not yet met / Not met / No longer applicable. Backlog assumes: the first scale for recorded-before expectations, the second for expectations recorded after the conference, reported separately. Confirm, or choose one scale for both | Indicator "Expectation status" needs a single set of statuses per stage | Oct 30 |
| **OQ-5** | **Section 8.4 contains stray text** ("Yes, The Oracle. We should revise it to reflect both Transfer Planning sessions...") and S4, S8.3, S17 and S19 still describe a single 30-minute closing session while S9 describes sessions on both days. Confirm: two sessions (Day 1 and Day 2), one continuous plan | Affects screen flow, session setup and the final plan submission time | Oct 30 |
| **OQ-6** | **Section numbering.** Core indicators are headed 14.1 but the following sections are 15.2 and 15.3 (also referenced as S15.3). Confirm correct numbering for the handover documentation | Documentation | Nov 6 |
| **OQ-7** | **Original technical specification.** S17 Phase 0 refers to a separate document. Share it so the backlog can be checked against it | May add or change requirements | Oct 28 |
| **OQ-8** | **Day 1 Question 3 alerting.** Who receives the prompt notification (name and email), and what response time is expected? | Needed for E7-2 | Oct 30 |
| **OQ-9** | **Follow-up dates.** Anchor dates to Nov 13 (end of conference) or to each delegate's plan submission? Default proposed: Nov 13 + 30/60/90 days (Dec 13, Jan 12, Feb 11), editable | Needed for E12-1 | Nov 4 |
| **OQ-10** | **Attendee for end-of-conference and plan indicators.** Confirm that only delegates recorded as attending can be invited to the final evaluation and counted in plan completion | Denominators in S14.1 | Nov 2 |
| **OQ-11** | **Session list.** Titles, dates, times, speakers and facilitators for all ITTEC 2026 sessions, including the two Transfer Planning sessions | Needed for QR codes and feedback forms | Oct 30 |
| **OQ-12** | **Reminder channels.** Email only at launch? SMS/WhatsApp later? "From the channels the platform supports" (S6.3) | Scope | Oct 30 |
| **OQ-13** | **Consent to share identifiable comments.** Is consent captured per delegate at sign-up, or asked when a comment is selected for sharing? (S6.4) | Reports and sponsor sharing | Nov 4 |
| **OQ-14** | **Phase 1 vs scope.** S17 Phase 1 says the complete conference and follow-up workflow must be built and tested by Nov 7. This backlog builds follow-up forms (E12-1 to E12-6) by Nov 6 but defers the 180-day scheduling and PDF/DOCX reports. Confirm acceptable | Scope of Nov 7 | Oct 30 |
| **OQ-15** | **Team capacity.** Number of developers, weekend availability, and the M.Bryan acceptance contact for each increment | The plan assumes at least two or three developers working in parallel | Oct 28 |
| **OQ-16** | **Support contact and data region.** Confirm hosting region and the named support person for the conference | Privacy and live support | Nov 2 |

---

## 6. Key risks

| Risk | Impact | Mitigation |
|---|---|---|
| Content not frozen by Oct 30 | Rework on form engine and tests | Freeze gate; versioning limits damage |
| Email deliverability (magic links) | Delegates cannot sign in | SMTP relay, SPF/DKIM/DMARC, test in Inc 1 and Inc 5, show support contact on sign-in |
| Surge after sessions (hundreds of delegates in five minutes) | Slow or failed feedback | Light form pages, cached form definitions, load test T14, temporary server resize for Nov 12-13 |
| Single VPS | Outage during the conference | Monitoring, tested restore, runbook, named support person |
| Scheduler failure | Reminders and follow-ups silently stop | Worker heartbeat, idempotent jobs, failed-job alerts, T16 |
| Small team and weekend work | Delays | Parallel tracks (backend, frontend, DevOps/QA), named backups, cut-list in section 4 |
| Immediate feedback in the pre-assessment | Inflated paired change | Decide OQ-2 |
| Ambiguous session structure | Wrong plan flow | Decide OQ-5 |

---

## Appendix A. Question bank (seed data)

Format: ID, wording or content, answer type, required (R) or optional (O) as set in the workplan. Where the workplan does not state it, the backlog proposes a default marked *(proposed)*. **Confirm all *(proposed)* settings at the content freeze.**

### A1. Pre-conference assessment (S7)

**Delegate details (S7.2)**

| ID | Question | Type | Req |
|---|---|---|---|
| Q-DET-1 | Name | Short text | R *(proposed)* |
| Q-DET-2 | Email address | Email | R *(proposed)* |
| Q-DET-3 | Organisation | Short text | R *(proposed)* |
| Q-DET-4 | Job title or role | Short text | R *(proposed)* |
| Q-DET-5 | Country | Single select | R *(proposed)* |
| Q-DET-6 | Attendance format: physical or virtual | Single select | R *(proposed)* |
| Q-DET-7 | Are you attending: as an individual / as a nominee of an organisation / in another capacity? | Single select | R *(proposed)* |

**Expectations and challenges (S7.3)**

| ID | Question | Type | Req |
|---|---|---|---|
| Q-EXP-1 | What are your main reasons for attending ITTEC 2026? | Long text | R *(proposed)* |
| Q-EXP-2 | What would you like to learn or gain from the conference? | Long text | R *(proposed; reused in the Transfer Plan and final evaluation)* |
| Q-EXP-3 | What challenge relating to training application, measurement or business results would you like ITTEC to help you address? | Long text | R *(proposed)* |
| Q-EXP-4 | What would make attending ITTEC valuable to you? | Long text | R *(proposed)* |
| Q-EXP-5 | What would you like to do differently after the conference? | Long text | R *(proposed; reused in the Transfer Plan and follow-ups)* |

**Current practices (S7.4)**

Scale: Always | Often | Sometimes | Rarely | Never | Not applicable to my role. Stem: "Before training is selected,". "Not applicable to my role" is not scored as a low rating. Each statement stored separately.

| ID | Statement |
|---|---|
| Q-PRA-1 | I or my organisation identify the performance or business need. |
| Q-PRA-2 | I or my organisation establish what stakeholders expect training to achieve. |
| Q-PRA-3 | I or my organisation identify relevant measures before training begins. |
| Q-PRA-4 | I or my organisation plan how participants will apply learning in the workplace. |
| Q-PRA-5 | I or my organisation involve line managers or other relevant stakeholders in supporting application. |
| Q-PRA-6 | I or my organisation follow up to find out whether participants applied their learning. |
| Q-PRA-7 | I or my organisation assess whether training contributed to workplace or business results. |

**Baseline knowledge assessment (S7.5), repeated in the final assessment (S10.4A)**

Introduction (exact text): *The following questions assess selected concepts relevant to ITTEC. They do not cover everything you may learn during the conference. Please answer based on your current knowledge. If you are unsure of an answer, select "I am not so sure."*

| ID | Question | A | B | C | D | E | Correct |
|---|---|---|---|---|---|---|---|
| Q-KN-1 | A team is missing a performance target. What should be done before deciding that training is the solution? | Immediately enrol the entire team in a training programme. | Examine the performance gap and its possible causes. | Ask a trainer to deliver the most popular course to address the performance target that they keep missing. | Measure participant satisfaction with previous training. | I am not so sure. | **B** |
| Q-KN-2 | Which action best supports the application of learning after training? | Expecting participants to apply learning without discussing it at work. | Providing a certificate at the end of training. | Agreeing on opportunities to apply learning and securing relevant workplace support. | Measuring attendance only. | I am not so sure. | **C** |
| Q-KN-3 | Which of the following is the clearest example of a training application measure? | The number of people registered for a course. | Participants' ratings of the venue. | The number of training hours delivered. | The percentage of participants using the agreed skill on the job. | I am not so sure. | **D** |
| Q-KN-4 | Why should relevant performance or business measures be identified before a training initiative? | To establish a starting point and track relevant changes over time. | To guarantee that all later improvements were caused by training. | To replace the need for application support. | To measure only how much participants enjoyed training. | I am not sure. | **A** |
| Q-KN-5 | What does Return on Expectations assess? | Whether every participant received a certificate. | The number of training sessions delivered. | The extent to which agreed stakeholder expectations were met. | The cost of the training venue alone. | I am not sure. | **C** |

Scoring rules: 1 point per correct answer; incorrect or "not sure" = 0; maximum 5; percentage = correct / 5 x 100; record each answer and the total; compare only delegates who completed all five at both stages; show the number included; report separately from confidence and satisfaction. Display note: these questions assess selected concepts and do not represent everything a delegate may learn. (See OQ-2 and OQ-3.)

**Baseline confidence (S7.6), repeated in the final assessment (S10.4B)**

Stem: "How confident are you in your ability to:". Scale: 1 Not at all confident | 2 Slightly confident | 3 Moderately confident | 4 Very confident | 5 Extremely confident | Not applicable to my role.

| ID | Statement |
|---|---|
| Q-CON-1 | Identify questions to ask before deciding whether training is the right response to a performance need? |
| Q-CON-2 | Discuss stakeholder expectations before a training initiative? |
| Q-CON-3 | Identify a relevant measure and establish a baseline? |
| Q-CON-4 | Plan how learning will be applied in the workplace? |
| Q-CON-5 | Identify the support needed from line managers or other stakeholders? |
| Q-CON-6 | Track whether participants have applied what they learned? |
| Q-CON-7 | Identify evidence that may show a contribution to workplace or business results? |

Reporting rule: per statement; exclude "Not applicable to my role" and unanswered; show response numbers; for before/after use delegates who answered the same statement at both stages. Label as self-reported confidence.

**Current use of tools and practices (S7.7)**

Q-TOOL-1: "Which of the following do you currently use in your work? Select all that apply." Multi-select. Options: a process for identifying the cause of a performance gap; a document or process for recording stakeholder expectations; baseline data or performance measures before training; a participant action or transfer plan; a process for involving line managers in supporting application; a follow-up process for checking workplace application; a method for gathering evidence of workplace or business results; **None of the above**; **Not applicable to my role**; Other: please specify. "None of the above" and "Not applicable to my role" cannot be combined with any other option.

### A2. Day 1 check-in (S8.2)

| ID | Question | Type | Req |
|---|---|---|---|
| Q-D1-1 | What is the most valuable thing you learned today? | Long text | R *(proposed)* |
| Q-D1-2 | What idea, tool, practice, model, or framework from today could you apply in your work? | Long text | R *(proposed)* |
| Q-D1-3 | Is there anything about your conference experience that the ITTEC team should address before Day 2? | Long text | O *(proposed)*. **Made available promptly to M.Bryan** |

### A3. Day 2 check-in (S8.3)

Purpose: help delegates reflect on Day 2 before they develop their plans. Brief. Does not replace the Transfer Plan or the final evaluation.

| ID | Question | Type | Req |
|---|---|---|---|
| Q-D2-1 | What is the most valuable thing you learned on Day 2? | Long text | R *(proposed)* |
| Q-D2-2 | Which Day 2 session, discussion or activity was most relevant to your work? | Short text or session select | R *(proposed)* |
| Q-D2-3 | What idea from Day 2 would you like to explore or apply? | Long text | O *(proposed)* |
| Q-D2-4 | What question remains on your mind after today's sessions? | Long text | O *(proposed)* |

### A4. Session feedback (S8.4)

The form shows the session title and speaker/facilitator automatically.

| ID | Question | Type | Req |
|---|---|---|---|
| Q-SF-1 | How would you rate the relevance of this session to your work? | Excellent / Good / Fair / Poor | **R** |
| Q-SF-2 | How would you rate the clarity and quality of the session delivery? | Excellent / Good / Fair / Poor | **R** |
| Q-SF-3 | How would you rate the practical usefulness of the session? | Excellent / Good / Fair / Poor | **R** |
| Q-SF-4 | What was your main takeaway from this session? | Text box | O |
| Q-SF-5 | What could be improved about this session? | Text box | O |

### A5. Individual Transfer Plan (S9.2)

One plan per delegate, with multiple actions and a marked first priority. "Measure and baseline" accepts "Not yet known" or "Not applicable". Drafts can be saved incomplete. Show Q-EXP-2 and Q-EXP-5 answers beside the form.

| ID | Field | Prompt | Type | Per |
|---|---|---|---|---|
| Q-TP-1 | Priority learning | What knowledge, skill, tool or practice from ITTEC will you apply? | Long text | Action |
| Q-TP-2 | Action | What specifically will you do differently? | Long text | Action |
| Q-TP-3 | Workplace opportunity | Where or on which initiative will you apply it? | Long text | Action |
| Q-TP-4 | First step | What is the first action you will take? | Long text | Action |
| Q-TP-5 | Start date | When will you begin? | Date | Action |
| Q-TP-6 | Target date | When do you expect to complete the action? | Date | Action |
| Q-TP-7 | Stakeholders | Who needs to be involved, informed or consulted? | Long text | Action |
| Q-TP-8 | Support | What support, resources or approval do you need? | Long text | Action |
| Q-TP-9 | Potential barriers | What might prevent or delay your action? | Long text | Action |
| Q-TP-10 | Evidence of application | What will show that you have applied your learning? | Long text | Action |
| Q-TP-11 | Expected result | What improvement do you expect your action to contribute to? | Long text | Action |
| Q-TP-12 | Measure and baseline | What will you track, and what is its current starting point? (or Not yet known / Not applicable) | Text + options | Action |
| Q-TP-13 | Review date | When will you review your progress? | Date | Action |
| Q-TP-14 | Reminder preferences | When and how often would you like M.Bryan to remind you about your plan? | Preference form (E10) | Plan |

Required fields at submission *(proposed)*: Q-TP-1, 2, 4, 5, 6, 13 and Q-TP-14. Other fields optional.

### A6. End-of-conference evaluation (S10)

**Experience (S10.2)** Scale: Excellent | Good | Fair | Poor | Not applicable.

| ID | Item |
|---|---|
| Q-FE-1 | Relevance of the conference to your work. |
| Q-FE-2 | Quality of the sessions you attended. |
| Q-FE-3 | Practical usefulness of the discussions and activities. |
| Q-FE-4 | Opportunities to interact and exchange ideas. |
| Q-FE-5 | Organisation and communication. |
| Q-FE-6 | Your overall conference experience. |
| Q-FE-7 | What did ITTEC do well? (text) |
| Q-FE-8 | What should be improved for a future conference? (text) |

**Physical delegates (same scale):** Q-FE-P1 Registration and check-in; Q-FE-P2 Venue and facilities; Q-FE-P3 Accessibility and comfort; Q-FE-P4 On-site support.
**Virtual delegates (same scale):** Q-FE-V1 Ease of joining; Q-FE-V2 Audio and visual quality; Q-FE-V3 Access to sessions; Q-FE-V4 Ability to participate and engage; Q-FE-V5 Technical support.

**Learning assessment**
- A. Q-KN-1 to Q-KN-5 repeated with identical wording, options and scoring.
- B. Q-CON-1 to Q-CON-7 repeated with the same scale.
- C. Learning gained: Q-FE-C1 What is the most valuable knowledge, skill, tool or practice you gained from ITTEC? Q-FE-C2 How is it relevant to your work or organisation? Q-FE-C3 What can you now do, or do differently, as a result of what you learned?
- D. Unresolved needs: Q-FE-D1 What question or challenge remains unresolved for you? Q-FE-D2 What additional knowledge, resource or support would help you apply what you learned? Q-FE-D3 Is there a topic you would like M.Bryan to address in a future programme?
- E. Readiness: Q-FE-E1 How ready are you to begin applying your priority learning? (Ready to begin now | Ready, but support is needed | Not yet ready | Not applicable). Q-FE-E2 Have you completed your Individual Transfer Plan? (Yes | Started but not completed | No), prefilled from the plan record. Q-FE-E3 What support would help you begin?

**Expectations and value (S10.5)**
- Q-FE-X1 (shown if Q-EXP-2 exists): display the pre-conference answer, then "To what extent did ITTEC provide what you hoped to gain?" Fully | Partly | Not yet sure | Not at all | No longer applicable.
- Q-FE-X2: "Please explain your response. What did you gain, and what is still missing?" (text)
- Q-FE-X1b (shown if no pre-conference answer): "You did not record this before ITTEC. Looking back, what did you hope to gain from attending?" Text box plus "Prefer not to answer"; label "Recorded after the conference"; then "To what extent was this expectation met?" Met | Partly met | Not yet met | Not met | No longer applicable.
- Q-FE-X3: Which expectation was met most effectively?
- Q-FE-X4: Which expectation remains partly met or unmet?
- Q-FE-X5: What made ITTEC valuable to you?
- Q-FE-X6: What would have made your experience more valuable?
- The duplicate "Looking at the expectations you recorded before ITTEC, to what extent were they met?" is replaced by Q-FE-X1, so delegates answer it once.

### A7. Follow-up questions (S11)

Every follow-up displays the delegate's Transfer Plan and their Q-EXP-5 answer.

**30-day (S11.2)**

| ID | Question |
|---|---|
| Q-F30-1 | Have you started the action in your Transfer Plan? |
| Q-F30-2 | What have you done so far? |
| Q-F30-3 | What has helped you make progress? |
| Q-F30-4 | What has delayed or prevented progress? |
| Q-F30-5 | What is your next step, and when will you take it? |
| Q-F30-6 | What support do you need from M.Bryan or another stakeholder? |
| Q-F30-7 | Would you like to change your reminder preferences? |

**60-day (S11.3)**

| ID | Question |
|---|---|
| Q-F60-1 | What have you applied from ITTEC? |
| Q-F60-2 | Where and how have you applied it? |
| Q-F60-3 | How often have you applied it? |
| Q-F60-4 | Who has been involved or provided support? |
| Q-F60-5 | What has changed in your work or your organisation's practices? |
| Q-F60-6 | What evidence of application can you share or describe? |
| Q-F60-7 | What barriers or support needs remain? |

**90-day (S11.4)**

| ID | Question |
|---|---|
| Q-F90-1 | What progress have you made against your Transfer Plan? |
| Q-F90-2 | What actions have you completed, continued, changed or not started? |
| Q-F90-3 | What results or improvements have you observed? |
| Q-F90-4 | What evidence or relevant measures are available? |
| Q-F90-5 | What other factors may also have contributed to the changes? |
| Q-F90-6 | To what extent have your expectations of ITTEC been met? |
| Q-F90-7 | What further support or time do you need? |

**Application question for the "reported application rate" (S14.1):** the follow-up forms must include one structured question per stage ("Have you applied learning from ITTEC at least once in a real work situation?" Yes / No) so the indicator has a defined numerator and denominator. *(proposed: confirm with M.Bryan.)*

**Longer-term follow-up (S11.5):** about 180 days or later, selected delegates or organisations; question set to be supplied by M.Bryan.

### A8. Reminder preference options (S6.3)

- Start: date. Frequency: Once | Every other day | Twice a week (choose days of the week) | Weekly | Every two weeks | Monthly. Day and time (where applicable). Channel (from supported channels). End: optional end date, or stop at any time.

---

## Appendix B. Application status definitions (S11.6)

| Status | Definition | Extra details required |
|---|---|---|
| Not yet started | The delegate has not begun the planned action. (e.g. plans to meet a line manager but has not scheduled or held the meeting) | none |
| Started | An initial step has been taken, but not yet sufficiently advanced to be in progress. (e.g. contacted the line manager to arrange a meeting) | none |
| In progress | Actively working on the action, not yet at the planned point of completion or application. (e.g. developing an application-tracking process with stakeholders) | none |
| Applied | Used the learning or practice at least once in a real work situation. (e.g. used the new tracking process for one training programme) | Example and when application occurred |
| Applied consistently | Reports using the learning or practice repeatedly over the period described. (e.g. used the tracking process across several programmes) | Example and when application occurred |
| Completed | The planned action has been finished according to the delegate's stated goal. | What was completed and when |
| Changed | The original action was revised because circumstances, priorities or approach changed. | Brief explanation |
| No longer applicable | The original action is no longer relevant or possible. | Brief explanation |

Rules: one current status per action; delegate selects it; history and explanations retained; one-time completion does not imply consistent use; Started / In progress / Completed do not by themselves mean learning was applied; dashboard counts each action once in its latest status.

---

## Appendix C. Indicator definitions (S14.1)

| Indicator | Numerator / denominator |
|---|---|
| Platform sign-up rate | Registered delegates who created an account / total valid registered delegates x 100 |
| Attendance rate | Registered delegates recorded attending at least part of one conference day / total valid registered delegates x 100 |
| Pre-conference assessment response rate | Delegates who submitted the pre-conference assessment / registered delegates invited x 100 |
| End-of-conference assessment response rate | Attendees who submitted the final assessment / attendees invited x 100 |
| Transfer Plan completion rate | Attendees who submitted a completed Transfer Plan / attendees x 100 |
| Follow-up response rate | Delegates who submitted the follow-up / delegates invited to it x 100, separately for 30, 60, 90 and any later follow-up |
| Reported application rate | Delegates who answered the follow-up application question and reported applying learning at least once / delegates who answered that question x 100 |
| Knowledge score | Correct answers / 5 x 100 |
| Knowledge scores before and after | For delegates who completed all five questions at both stages: average post minus average pre, in percentage points, with number of paired delegates |
| Confidence change | Per statement: average post rating minus average pre rating for delegates who answered that statement at both stages; exclude "Not applicable" |
| Expectation status | Assessed expectations in each status / total assessed at that stage x 100, each status shown separately |

**Worked example:** 40 delegates answer the application question and 24 report applying learning, so the rate is 24 / 40 x 100 = 60%. The dashboard must say **"24 of 40 respondents reported application"** and must not say 60% of all attendees applied learning unless the 40 respondents represent all attendees.

**Excluded from calculations:** test records; duplicate records confirmed as duplicates; cancelled registrations (from the valid count); unanswered questions (from that question's denominator); "Not applicable" responses (from scored confidence). All corrections by authorised users are recorded.

---

## Appendix D. Platform completion checklist (S19)

- [ ] Available for registered delegates no later than November 7, 2026
- [ ] Each delegate can sign up and access a unique individual account
- [ ] Delegates can select and change when and how often they receive reminders
- [ ] Pre-conference assessment available with the knowledge and confidence questions
- [ ] Day 1 and Day 2 check-ins available as separate activities
- [ ] Delegates can complete their Individual Transfer Plans during the Transfer Planning sessions
- [ ] Delegates can save, revisit and update their plans
- [ ] Final evaluation repeats the baseline knowledge and confidence questions
- [ ] Follow-up assessments are linked to each delegate's account and plan
- [ ] Application and expectation statuses use the workplan definitions
- [ ] M.Bryan can view the dashboard and generate the required reports
- [ ] Calculations display the correct numbers, percentages and respondent groups
- [ ] Data access and security controls have been tested
- [ ] The development team is ready to operate and support the platform during ITTEC and the agreed follow-up period