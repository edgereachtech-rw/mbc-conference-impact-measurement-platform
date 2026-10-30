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
| **1** | Thu Oct 29 | Foundation, sign-in and access control (delivered; delegate import moved to 1b) |
| **1b** | Fri Oct 30 | Admin CSV/XLSX delegate import, platform identity, import audit (see design note after E3) |
| **1c** | with Inc 2 | Delegate "My Events" view on the identity model |
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
| **Delegate** | Participant whose record an M.Bryan admin imported from the event registration file; one platform identity links every event they appear in. There is no public sign-up | Only their own information, across their own events (S3.1, S13.2, S16) |
| **M.Bryan admin** | Manages conference, reviews data, generates reports | All conference data for ITTEC |
| **Development team** | Builds, tests, operates, supports | Technical access; response content only where needed for support |
| **Speaker/Facilitator** | Receives feedback on their own session | Only their own session's feedback, anonymised unless permission given (S8.4) |

Decisions 2026-10-29: the analyst role and the support role are not part of the approved requirements and are not replaced; M.Bryan acts as admin, as in the original requirements. The Increment 1 code contains both roles. They are retired in Increment 1b under the explicit plan in design note D8 item 7: existing accounts with those roles are reviewed and revoked or migrated under written authorisation, never silently promoted to admin.

---

## 3. Epics overview

| ID | Epic | Priority | Inc |
|---|---|---|---|
| E0 | Foundation, DevOps and operations | P0 | 1, 5, 6 |
| E1 | Conference setup (reusable event model) | P0 | 1-2 |
| E2 | Delegate records, CSV/XLSX import and platform identity | P0 | 1b |
| E3 | Sign-in and access control (no public sign-up); My Events | P0 | 1, 1b, 1c |
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
| E1-1 | As an M.Bryan admin, I want to create and configure an event (revised 2026-10-30 to the event creation and configuration brief) | Admin-only. Structured profile: name, unique event code generated from the name (decided 2026-10-30; numbered when taken, not editable), description, type (conference, workshop, seminar, summit, training, other), organiser, format (physical, virtual, hybrid), time zone; optional theme, logo or image URL, website, additional information; venue required for in-person and hybrid events. Dates picked one by one on a calendar, consecutive or not, kept individually, shown in order, duplicates refused, at least one date; start and end derived from the earliest and latest date (OQ-30). Removing a date that has sessions is refused until the sessions are moved or deleted. Review and publication: draft, published (active), archived; publishing requires the date and venue rules; archived events are read-only. Every change audited (`event.created`, `event.updated`, `event.dates_changed`, `event.session_*`, `event.assessment_configured`, `event.status_changed`). ITTEC 2026 is one configured event, not a hardcoded structure | P0 | 1, 2 |
| E1-2 | As M.Bryan, I want participation categories | Physical and virtual categories linked to registrations | P0 | 1 |
| E1-3 | As an M.Bryan admin, I want optional conference sessions (revised 2026-10-30) | Sessions are optional; an event publishes without them. Each session belongs to the event and to one of its selected dates (never another date); title, date, start and end time (end after start, wall-clock in the event time zone), type (keynote, plenary, panel, workshop, breakout, Transfer Planning, networking, other) required; description, venue or room, speaker or facilitator, capacity optional; session-specific feedback switch per session. The schedule groups sessions by date in time order and lists selected dates without sessions too. Objectives and intended learning outcomes go in the description until the session feedback forms arrive | P0 | 2 |
| E1-4 | As an M.Bryan admin, I want to configure the assessment stages per event (revised 2026-10-30) | Three stages, pre-conference, during-conference and follow-up, each enabled or disabled independently per event; none mandatory; per stage: availability (opens at), deadline (closes at, after opening, both entered in the event time zone), target (all delegates or a named group), status (draft, scheduled, open, closed; a disabled stage stays draft, a scheduled stage needs an opening time and opens by itself at that time, closing at its deadline; decided 2026-10-30, the admin card shows what delegates currently see). Stages are separate from sessions: an event can have assessments without sessions and sessions without every stage. Every enabled stage carries questions delegates answer (decided 2026-10-30): per stage an ordered, versioned question list (short answer, long answer, single choice, multiple choice, rating scale, yes or no, number, date; required flag; measurement area); an enabled stage with no questions cannot be scheduled, opened or published; editing an answered question creates a new version and answers keep the version they answered. Questions can be grouped into ordered, titled sections with an introduction; delegates answer one section per step (2026-10-30). Format extended 2026-10-30: a section is marked Not marked, Rating scale (stored as scored) or Knowledge (decided 2026-10-30: marking belongs to the section, not to each question); in a scored section single-choice options carry scores, in a knowledge section each single-choice question has one correct answer (one point, instant feedback, locked once answered), multiple-choice options may be exclusive or "Other, please specify", and the ITTEC pilot questions are seeded data, not a template (question roles, repeating a question from another stage and example sets were removed on request 2026-10-30; how the final assessment pairs with the baseline is to be decided with that stage). Delegates see enabled stages as upcoming, open or closed, save drafts while open and submit each section separately (decided 2026-10-30: a section locks when submitted, the stage is submitted once every section is; a review popup lists the answers first; missing required answers are flagged in a highlighted banner); admins read any delegate's full response section by section (viewing audited); validation per question type on the server. Participant-group membership rules (OQ-31) and the 30/60/90/180-day follow-up dates (S4) are still to be specified. Attendance is recorded separately and never inferred from a submission | P0 | 2, 5 |
| E1-5 | As M.Bryan, I want reporting periods | Named periods with start/end dates used by reports and the dashboard | P1 | 5 |
| E1-6 | As M.Bryan, I want to copy an event's setup for a future conference | Duplicate event with sessions, forms, stages; no delegate data copied | P2 | Post |
| E1-7 | As the dev team, I want ITTEC 2026 seeded | All sessions, objectives and dates entered once confirmed by M.Bryan. **Dependency: M.Bryan supplies the session list and speakers** | P0 | 2 |

---

## E2. Delegate records, CSV/XLSX import and platform identity (S6.1)

Revised 2026-10-29: delegates never register on the platform. Every delegate record comes from a file an M.Bryan admin imports for a specific event, and one person keeps one platform identity across events. The design note after E3 is authoritative for the details.

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E2-1 | As an M.Bryan admin, I want to import an event's registered delegates from CSV or XLSX | Select the event; upload `.csv` or `.xlsx`; file type, size, structure, required columns and row values validated; preview of accepted, rejected, duplicate, updated, linked and conflicting rows with row-level reasons before anything is written; explicit confirm; repeatable without creating duplicate registrations or identities; existing records and history preserved on re-import (design note D3, D5) | P0 | 1b |
| E2-2 | As the platform, I keep one platform identity per person and one registration record per event | A person matched by normalised email has one identity; each event they appear in has its own delegate record linked to that identity with a stable id and the attendance format for that event (D6) | P0 | 1b |
| E2-3 | As M.Bryan, I want duplicates and ambiguous matches detected, not merged silently | Identical repeated rows within a file skipped and reported as duplicates; rows that share an email but differ in name or registration details quarantined as conflicts, never resolved by file order; rows that match an existing record update it in place; rows with the same name and organisation but another email flagged as possible duplicates; conflicting identity matches quarantined for an admin to resolve with one of the actions valid for the conflict type, validated on the server and audited (D5). Confirmed duplicates keep history and are excluded from counts | P0 | 1b |
| E2-4 | As an authorised user, I want to correct delegate records | Edit name, organisation, role, country, format, status. Every change recorded (who, when, old and new value). Email changes go only through the identity email-change workflow (E2-12); imports never change an email | P0 | 1b |
| E2-5 | As M.Bryan, I want registration status | Active, pending, cancelled, duplicate, test (decided 2026-10-30: `active` replaces `valid`; `pending` added). Pending is imported as such or set by an admin; a pending registration cannot sign in, is not listed in My Events and is excluded from active-registration counts until an admin sets it to active. Cancelled, pending and test records excluded from active-registration counts (S14.1 "valid registrations"). A registration missing from a later file is never cancelled automatically | P0 | 1b |
| E2-6 | As M.Bryan, I want registration, attendance and assessment status per delegate | List/filter delegates by first sign-in, pre-assessment, attendance by day, plan, final evaluation, follow-up status | P0 | 3 |
| E2-7 | As M.Bryan, I want the nominating organisation recorded | Delegate capacity (individual / nominee of an organisation / other) and organisation name stored for organisation reports (S7.2, S13.3) | P1 | 2 |
| E2-8 | As an M.Bryan admin, I want to map file columns to platform fields | Suggested mapping from header names; minimum required fields email, name and attendance format; optional fields and the external registration id as in design note D4; unmapped columns ignored and reported; mappings saved per registration source and reused when the file structure matches, re-confirmed by the admin when it changes; every import still goes through preview and explicit confirmation (decided) | P0 | 1b |
| E2-9 | As the platform, I reuse an existing identity when the same person appears in another event | Match by normalised email (and external registration id within an event); link the new event record to the existing identity; never create a second identity for a matched email (D5) | P0 | 1b |
| E2-10 | As the platform, I handle missing, shared and changed emails safely | Missing email rejects the row with a count in the preview; each identity has a unique email and shared-email rows are quarantined as conflicts for admin resolution (decided, D5); changed email only through the admin email-change workflow (E2-12); a new email with a known external registration id is a conflict (D5) | P0 | 1b |
| E2-11 | As an M.Bryan admin, I want import history and audit | Each run records actor, event, timestamp, file name, mapping, counts and outcome; row-level report downloadable and audited; only M.Bryan admins run imports, read history and review or resolve conflicts; no other role sees any of it (D3, D9) | P0 | 1b |
| E2-12 | As an M.Bryan admin, I want to change a delegate's email when they ask | The delegate contacts M.Bryan (no self-service change). The admin finds the existing identity by current email, name or event. Before changing anything the admin verifies the request (policy OQ-29, approval required before this story is implemented) and records the method. The change: updates the email on the existing identity, preserving the identity id and every linked registration, attendance record, response, consent record and audit entry; revokes all sessions immediately; invalidates every outstanding sign-in link, code and pending verification issued to the identity; after the change the old address can no longer authenticate as that identity; the new address can sign in only after it completes the normal passwordless verification, which is also the proof of control. Audit entry: verification method, administrator, decision, timestamp, old and new email, never a token or code. The previous address is kept in the identity's email history for import matching only (D5.1); it never authorises sign-in and is never reassigned by an import. A successful change writes `identity.email_changed`; a new address that is the current or a historical address of another identity is refused on the server, nothing changes, `identity.email_change_refused` is written, and identities are never merged. The change runs in one transaction serialised on both addresses so a concurrent import cannot slip between the check and the update | P0 | 1b (after OQ-29) |
| E2-13 | As an M.Bryan admin, I want to deactivate or reactivate a delegate account | Admin-only, authorised on the server for every request; sets a delegate account to inactive or active with a reason category; no public route, no new role, no account creation. Success writes `identity.account_status_changed` (old and new status, actor, reason category, timestamp); a refused request (non-admin caller, unknown account, a staff account, or no change in status) writes `identity.account_status_refused` and no success event; a failure after acceptance writes `identity.account_status_failed`, no success event, and leaves the status unchanged. Deactivation revokes every session of the account at once. Reactivation only clears the inactive status: the delegate still needs an eligible imported registration (D1.2, D8 item 1), still signs in through the passwordless verification with their current address, gets no restored session, and remains subject to the production test-data gate and every other authentication and authorisation check | P0 | 1b |
| E2-14 | As an M.Bryan admin, I want to email selected delegates of an event (added 2026-10-30) | From the event's delegate list: tick registrations one by one, tick the whole page, or extend to every registration matching the current status filter and search; write a subject and body in a small formatting set (bold, italic, headings, lists, links) with per-delegate placeholders (first name, name, email, organisation, event name) and a preview rendered exactly as the email; explicit confirmation before sending. The server validates everything again: admin-only, event not archived, registrations belong to the event, merged duplicates never messaged, one email per address, unknown placeholders refused, at most 2,000 recipients per message. Each message records who sent it, when, the selection used (never the addresses), and the outcome per recipient; the event page lists sent messages with per-recipient status. `message.sent` and `message.send_failed` are audited without addresses. Sending is synchronous in Increment 1b; moving it to the worker queue is deferred until the reminder engine (E10-8) introduces jobs | P1 | 1b |

---

## E3. Sign-in and access control, no public sign-up (S3, S6.2, S16)

Revised 2026-10-29: there is no sign-up. "First sign-in" replaces "sign-up" wherever the workplan used it. Delivered in Increment 1: E3-3 to E3-6 and E3-9 (see README, Authentication and access control). The identity-based changes are in design note D8.

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E3-1 | As a delegate, I want an invitation to join | Invitation email with single-use link tied to my imported registration; the link opens the normal sign-in flow with my email pre-filled (no separate account-creation step). Resend and bulk-send from admin. Invitation status tracked (sent, bounced, accepted = first sign-in) | P0 | 1b |
| E3-2 | As an imported delegate, I want to sign in with the email on my registration (supersedes "sign up") | Only an email that matches an imported registration with status active in a non-archived event (or an active staff account) can obtain a link or code; a registration with status test never authorises production access (OQ-27, decided); the first verification links my account to my platform identity so every event record stays connected; any other address gets the same generic response and gains nothing (D1, D8) | P0 | 1, 1b |
| E3-3 | As a delegate, I want simple passwordless sign-in | Email magic link or one-time code; code expires quickly; rate-limited; session via `httpOnly`, `Secure`, `SameSite` cookie; works after the conference | P0 | 1 |
| E3-4 | As a delegate, I want to recover access | Same flow as sign-in; support contact (`conference@mbryanconsultinggroup.com`) shown; to change my email I contact the M.Bryan admin, who uses the identity email-change workflow (E2-12) | P0 | 1 |
| E3-5 | As a delegate, I want to stay signed in on my phone during the conference | Session lasts the conference week; deep links (e.g. session QR) sign me in then return me to the target page | P0 | 1 |
| E3-6 | As the platform, I enforce role-based access on the server | Delegates access only their own records; admin and speaker permissions as in section 2 (analyst and support roles removed 2026-10-29; retirement plan in D8 item 7). Every API route has an authorisation check and test | P0 | 1 |
| E3-7 | As a delegate, I want to see privacy information at first sign-in | Section 6.4 text displayed and acceptance recorded with timestamp and version | P0 | 1b |
| E3-8 | As a delegate, I want to be told about both reminders and evaluation follow-ups | First-sign-in and reminder screens explain the difference (S4 note: reminders are chosen by me; evaluation follow-ups are scheduled by M.Bryan) | P0 | 4 |
| E3-9 | As an M.Bryan admin, I want to manage user accounts for staff | Create admin and speaker users; no analyst or support role; deactivate; audit | P0 | 1 |
| E3-10 | As a delegate, I want one My Events view of every event I am part of | After sign-in, one list of all events linked to my identity with, per event, name and dates, registration status, attendance only when an attendance record exists (otherwise "not recorded"), assessments and outcomes, transfer plan, follow-ups and other impact records as they become available; served by `GET /me/events` and `GET /me/events/:eventId` with server-side authorisation on every record (D7) | P0 | 1c |
| E3-11 | As the platform, I never grant delegate access to an unknown email | No sign-up route exists; an address with no eligible imported identity cannot obtain a session or any event history; staff safeguards unchanged (D1, D8) | P0 | 1, 1b |

---

## E2/E3 design note: delegate identity, import and event history (authoritative, 2026-10-29)

This note supersedes every earlier statement that a delegate "signs up" on the platform. It is the
design basis for Increment 1b. Items marked **OD-n** are open decisions listed in section 5; they
are not settled by this note.

### D1. Business rules (revised 2026-10-29)

1. **No public registration.** The platform has no sign-up page, no "create account" action and no
   self-service way for a person to become a delegate. Delegate records exist only because an
   M.Bryan admin imported an event's registration file.
2. **Sign-in is for imported identities only.** A delegate authenticates with the email on an
   imported registration through the existing passwordless flow (link or code). An email that
   matches no eligible imported registration and no active staff account receives the same generic
   response and nothing else; it never gains a delegate account or any event history. Delegate
   access therefore requires a successful email verification and at least one genuine, eligible
   imported registration, and every request is authorised on the server against the session's
   identity; the browser never filters another person's records out (decided).
3. **One person, one platform identity, many events.** A person who appears in several events'
   files has one platform identity and one sign-in experience. Each event keeps its own
   registration, attendance, assessment, plan, follow-up and impact records, linked to that
   identity through the event-specific delegate record.
4. **Registration is not attendance.** An imported row proves registration only. Registration
   imports carry registration data and nothing else: no attendance column is mapped, imported or
   turned into an attendance record. Attendance is recorded and managed inside the platform as its
   own workflow (E6, Increment 3) and is shown only from an attendance record; otherwise the event
   shows "attendance not recorded".
5. **Staff accounts are unchanged.** Admin and speaker accounts are created by an admin (E3-9) and
   keep every existing control (E3-3, E3-6, E17). The analyst and support roles are not part of the
   approved requirements (decisions 2026-10-29); both exist in the Increment 1 code and are retired
   in Increment 1b under the explicit plan in D8 item 7.
6. **Test data never opens production.** Development and staging use test registrations and test
   accounts for rehearsals and automated tests. In production a delegate signs in only with a
   genuine, eligible imported registration; a registration with status test, or an account linked
   only to test registrations, never authorises production delegate access (OQ-27, decided). Test
   data is removed from or excluded from eligibility in production before go-live, and the gate in
   D8 item 8 proves it with real authentication outcomes, not only a generic response.

### D2. Delegate lifecycle

| Stage | What happens | Where recorded |
| --- | --- | --- |
| Import | Admin selects the event and the registration source, uploads CSV or XLSX, confirms the mapping, reviews the preview, confirms. Accepted rows become event delegate records; each row is matched to an existing platform identity, creates a new one when its address is owned by no identity, or is quarantined as a conflict (D5) | `delegate` (event record), platform identity (OD-1), `import_run`, `import_row`, `audit_log` |
| Invitation (optional, E3-1) | Admin sends invitations; the link opens the normal sign-in flow with the delegate's email pre-filled. No separate "accept" account step | `invitation` |
| First sign-in | The delegate requests a link or code with their email. Eligibility: an imported record with status active in a non-archived event, or an active staff account. A registration with status `test` never authorises production access (OQ-27, decided); development and staging may allow it for rehearsals and automated tests. The Increment 1 code accepts `test` records unconditionally and Increment 1b confines that to non-production configuration (D8 item 1). On verification the account is linked to the platform identity, `signed_up_at` is set on each eligible event record, consent to the privacy notice is recorded at this point (E3-7) | `user_account`, identity link, `consent_record`, `audit_log` |
| Later events | A new import that matches the same identity attaches the new event record to it. The delegate's next sign-in shows both events; no new account, no new identity | `delegate` linked to the existing identity |
| Corrections | Admin edits (E2-4) and re-imports change the event record in place; history and existing records are kept; every change is audited | `delegate`, `audit_log` |
| Email change | The delegate contacts the M.Bryan admin. The admin locates the identity, verifies the request under the approved policy (OQ-29), updates the email on the existing identity, keeps the identity id and every record attached, revokes all sessions, invalidates outstanding links and codes, and audits method, admin, decision, time, old and new email (E2-12). The previous address is recorded in the identity's email history (D5.1): it stays reserved, is never reassigned by an import, helps match old exports only together with trusted registration linkage, and is never valid for sign-in. No new identity is created; the identity and registration ids are unchanged; the old address can no longer sign in; the new address works only after passwordless verification succeeds | `user_account.email`, identity, `auth_session.revoked_at`, `audit_log` |

### D3. Import workflow (E2-1, E2-8 to E2-11)

1. **Select event and registration source.** The admin picks the event the file belongs to and explicitly selects the registration source (or its saved mapping) the file came from; the platform never guesses the source from the file. Imports into an archived event are refused.
2. **Upload.** Accepted types: `.csv` (UTF-8, comma or semicolon, header row required) and `.xlsx` (first worksheet unless chosen). Limits (decided): 10 MB and 5,000 rows per file; a larger file is refused at upload with the instruction to split the export; `.xls` and every other type are refused. The file is stored in private object storage under an import-run key, never in the database, never exposed through a public URL and never served back without an admin authorisation; the original file is only needed to produce the preview and the commit. Its retention and deletion follow the policy in D9, whose duration and trigger are unresolved (OQ-22) and guarded by the temporary safeguard described there; the import audit history and the row report have their own lifecycle and do not depend on the file. Content is parsed server-side; formulas, macros and embedded or external links are never executed, cells are read as values only.
3. **Validate.** File-level: type, size, readable encoding, header row present, every required field mapped. Row-level: email syntactically valid after normalisation, name present, attendance format recognised, enumerations recognised, no control characters, cell length limits. A row with any error is rejected; the rest of the file proceeds.
4. **Preview (dry run).** Before anything is written the admin sees: accepted rows; rejected rows with row number and reason; duplicate rows within the file (identical repeats of one registration, later occurrences flagged); rows that share an email but differ in name or details (quarantined as conflicts, none of them processed); rows that match an existing event record (will update); rows that match an existing platform identity in another event (will link); rows that conflict (D5). Counts for each group and a downloadable row-level report.
5. **Confirm.** An explicit confirm step commits the run. The preview is bound to the run id together with a fingerprint: the file hash, the mapping, and a snapshot token of the event's delegate records and of every matched identity (their ids and `updated_at` values). A preview expires after 30 minutes. At confirmation the server re-runs validation and matching inside the commit transaction and compares each row's outcome with the preview; if the fingerprint or any outcome differs (a record edited, another run committed, an identity changed meanwhile), the commit is refused with a "preview out of date" response, nothing is written, and a fresh preview is required. Closing the page discards the run.
6. **Commit.** Inside one database transaction per run: valid rows create or update event records and link identities; conflicting rows, including every row of an email that conflicts within the file, are quarantined, meaning no identity or delegate record is created or updated for them and they are stored in `import_row` with status `conflict`, a reason code and both sides of the conflict; `import_run` and `import_row` outcomes are written, with one audit entry per run (actor, event, file name, counts, outcome) and one per changed delegate (old and new values). Quarantined rows wait for an admin decision (D5): one of the actions valid for the conflict type, validated on the server against the unique-email rule; each decision is applied in its own transaction and audited. In the audit trail a committed import (`import.committed` with its counts), a quarantined row (the run's conflict count plus the `import_row` status and reason), a refused or failed resolution (`import.resolution_refused`, `import.resolution_failed`) and a failed migration (`migration.identity_backfill` with an overall fail) are distinct and never share an event name.
7. **History.** Only M.Bryan admins see past runs for the event: who, when, file name, counts, outcome, the row report and the open conflicts. No other role, and no delegate, has access.

### D4. Field mapping and minimum fields (E2-8)

Registration platforms export different columns, so every run has a mapping from file columns to platform fields. The admin confirms the mapping on the preview screen; a suggested mapping is built from header names (case-insensitive, common synonyms such as "E-mail", "Email Address", "Full Name", "First Name" + "Last Name", "Company", "Organization"). Mappings are saved per registration source (decided). The admin explicitly selects the source or saved mapping before uploading; the platform never infers a source from an ambiguous file. A saved mapping is reused only when the file's header structure matches it exactly (same column names after trimming and case folding); a changed or unknown header structure requires the admin to review and confirm the mapping before the preview is produced. Every import still goes through validation, preview and explicit confirmation. The actual registration platforms and their exports are not yet known (OQ-20): source-specific header synonyms and mapping behaviour are finalised only after sample exports from the real sources have been obtained.

| Platform field | Required | Rule |
| --- | --- | --- |
| `email` | Yes | Trimmed, lower-cased, must parse as an address; identity matching key |
| `name` | Yes | Full name; when the file has first and last name columns they are joined with one space |
| `attendance_format` | Yes | physical or virtual, required because E2-2 and E5-1 (S6.1, S7.2) store it per registration and the Increment 2 questionnaires branch on it; synonyms (in person, onsite, online, remote) mapped; an unknown or missing value rejects the row and the platform never guesses it. When an export has no such column, the admin chooses one explicit value for the whole run on the preview (for example a physical-only file) and that choice is audited. Whether every registration platform exports this column is part of OQ-20 |
| `organisation` | No | Text, max 200 |
| `job_title` | No | Text, max 200 |
| `country` | No | Text, max 100 |
| `capacity` | No | individual, nominee_of_organisation, other; default individual |
| `nominating_organisation` | No | Text, max 200 |
| `registration_status` | No | active, pending, cancelled; default active (decided 2026-10-30). `duplicate` and `test` cannot be set by import |
| `external_registration_id` | No | The registration platform's own id for the row; when present it is a second matching key within that event and registration source only, and the preferred way to detect re-imports of a corrected row. Ids from different registration systems are never compared and identities are never merged on an id alone (decided); whether each source provides a stable id is part of OQ-20 |

Columns that are not mapped are ignored and reported as such in the preview; attendance, check-in or presence columns are always ignored (decision 2026-10-29). Defaults are applied only where the requirements define one: registration status active (E2-5) and capacity individual (E2-7, also the schema default). No other missing value is ever filled in.

### D5. Identity matching, duplicates, conflicts and re-import (E2-3, E2-9, E2-10)

- **Matching key.** Normalised email (trimmed, lower-cased), unique per identity (decided). Within one event and registration source, `external_registration_id` is checked first when mapped; ids never match across sources or events.
- **Within a file.** Rows that share a normalised email are compared after the same normalisation on every mapped field. Only when the normalised name and every mapped registration detail (external registration id, attendance format, organisation, job title, country, capacity, nominating organisation, registration status) are identical is the repeat a duplicate of one registration: the first occurrence is processed and the later ones are reported as "duplicate in file" and skipped. Any difference means the rows may describe two people sharing an address, or one person with inconsistent details, and file order never decides: every row of that email is quarantined as a conflict (reason `shared_email_in_file` when the normalised names or external ids differ, `inconsistent_repeat` when only other details differ), none of them creates or updates an identity or registration, and the preview counts them under conflicts with the reason on each row. Rows with the same name and organisation but different emails are flagged "possible duplicate" for review but imported, because distinct emails are distinct identities.
- **Same event, existing record (re-import).** A row whose email matches an existing record in the same event updates the mutable fields of that record (name, organisation, job title, country, format, capacity, nominating organisation, registration status) and keeps the record id, its identity link and every related record. The old and new values are audited. Nothing is deleted by an import: a registration that disappears from a later file stays in place; the admin sets it to cancelled deliberately (E2-5).
- **Other event, existing identity.** The new event record is linked to the existing identity. The identity's established name is preserved and never overwritten by an import (decided). Name comparison uses one deterministic normalisation: trim leading and trailing whitespace, collapse runs of whitespace to one space, apply Unicode NFC normalisation, and compare case-insensitively using Unicode case folding; nothing else is normalised. Only a row whose normalised name is identical to the identity's normalised name is an unambiguous match and links automatically. Any other difference (accents or diacritics, name order, transliteration, abbreviations, different spellings, an extra or missing name part) cannot be classified as a harmless formatting variation and quarantines the row for admin review; the identity's name stays as it was. Names that merely look similar never merge identities.
- **Conflicts, never merged silently.** Quarantined for admin resolution: a conflicting row creates and updates nothing until an M.Bryan admin resolves it, while the valid rows of the same run commit normally. Conflict conditions:
  1. the same `external_registration_id` already exists in the event with a different email;
  2. a row whose email is the current address of one identity while its `external_registration_id` in the same event and source belongs to a different registration or identity (the address may have been reused by another person);
  3. a row whose email matches an existing identity but whose normalised name is not identical to the identity's normalised name (rule above): a possible shared address or a different person;
  4. an identity already linked to a signed-in account whose status is inactive;
  5. rows that conflict with each other inside the file (shared email or inconsistent repeat, above);
  6. a row whose email is a historical address of an identity (D5.1) and that cannot be tied to that identity by established registration linkage (see Changed email, below).
  Conflicts are listed in the preview and in the conflict queue with both sides. The admin chooses one of the actions valid for the conflict type; the server validates every action against the unique-email rule and refuses any action that would create two identities with one email, change an identity's canonical email, or attach a registration to an identity the admin has not established as the same person. Ownership rule for every path (linking, creating, email changes, imports, conflict resolution and concurrent operations alike): an address that is the current or a historical address of identity A belongs to A, whether or not it is currently anyone's canonical email, and can be attached to a different identity B only if the approved, unambiguous linkage rules (D5.1 invariant 4) show it belongs to B; otherwise the operation is refused or the row quarantined, no record is modified, no information about A is returned, and the refusal is audited (`import.resolution_refused` or `identity.email_change_refused`). Valid actions: **link to the existing identity**, only when the admin records that it is the same person and the row's email is that identity's current address, one of its own historical addresses under invariant 4, or an address that is neither the current nor a historical address of any identity (rules 3, 5 for the one row that belongs to that person, 6; rule 4 only after an admin has reactivated the delegate account through E2-13, which never bypasses eligibility or verification); never when the address is reserved to another identity; **create a new identity**, only when the row's email is neither the current nor a historical address of any identity (D5.1 invariant 3) and the admin records that it is a different person (rule 1 when the new email is unowned; rule 5 for a row whose email is unowned once the other rows are rejected); never for rules 2 and 3, whose email is already owned; **reject the row**, always available; **correct the source**, meaning the row is rejected and the data is fixed in the registration source and re-imported, or the person's email is changed through E2-12 when the conflict is really an email change. A refused action changes nothing, returns no record of the other identity, and is audited as a refusal. Every resolution is audited as `import.conflict_resolved` with the decision, the actor and the resulting identity or delegate ids.
- **Missing email.** The row is rejected (email is the identity key). The preview reports the count so the admin can obtain addresses from the registration platform.
- **Shared email.** Each identity has exactly one current email and each current or historical email belongs to at most one identity (decided). A second row with the same email in the same file is a duplicate only when it is an identical repeat (Within a file); otherwise every row of that email is quarantined. Any sign that two people share one address (a non-identical normalised name on an email match, or an admin email change to an address another identity holds) is quarantined as a shared-email conflict for admin resolution; the platform never links two people to one identity and never shows one delegate another's records.
- **Changed email.** Imports never change the canonical email of an existing identity, never restore a previous one, and never create a second identity for a person whose email was changed. A row with a new email and a matching `external_registration_id` is a conflict (rule 1). Email changes go through the admin workflow in E2-12 (verified request, identity located, email updated in place, sessions revoked, audited); the previous address is kept in the identity's email history for import matching only, never for sign-in (D2). **Old-email rows** (an export produced before the change still carries the previous address): (a) when the same event already holds a registration record linked to that identity and the row matches it unambiguously through established linkage, either the same `external_registration_id` from the same source or the registration record's own imported email in that event, the row updates that record in place, the identity is untouched and its canonical email stays the new one; (b) when no such linkage exists, in particular for a new event or a source without a stable id, the row is quarantined with reason `previous_email_of_identity` (rule 6) and nothing is created, because an old address that one person has abandoned may legitimately belong to someone else later; name similarity never settles it. Resolution follows the conflict actions above: linking the row's registration to the existing identity when the admin establishes it is the same person keeps the identity, its canonical email and every linked record; creating a new identity for that address is not allowed while the address is in any identity's history (D5.1 invariant 3); otherwise the row is rejected or the source corrected. Implementation decision required (dev team): the current schema has no identity email history; detecting old-email rows needs a history of previous identity emails with change dates, otherwise such a row is indistinguishable from a new person and would be created silently. That capability is part of Increment 1b, not assumed to exist; its safety rules are in D5.1.
- **Corrected records.** A corrected file is re-imported; matched rows update in place (above), unmatched rows create new records, and the row report shows exactly which rows did what.
- **Confirmed duplicates (E2-3).** An admin can mark an event record as a duplicate of another; it keeps its history, is excluded from counts, and the partial unique index on (event, email) already allows it.

#### D5.1 Identity email history: safety invariants (required behaviour; capability not present today)

The current schema holds one email per account and per event registration and no history of previous identity addresses (D6). The invariants below are requirements for Increment 1b; they describe behaviour and constraints, not a table design, and none of them has been implemented or tested.

1. **One current address.** Each identity has exactly one current canonical email, unique across identities under the normalised-email rule (D5). Only that address takes part in sign-in eligibility.
2. **History is separate and inert for sign-in.** Previous addresses are stored apart from the current address, tied to the identity, with the change date, the administrator and the audit reference. A historical address never authorises a sign-in on its own: a link request for it receives the generic response and sends nothing, and a token issued to it before the change is rejected (D8 items 1 and 5).
3. **Historical addresses stay reserved.** An address in any identity's history is not available to an import for creating a new identity, not available as the new address of another identity in E2-12, and not available for attaching a registration to another identity through conflict resolution, even when the address is no longer any identity's canonical email; so an old registration cannot be linked to the wrong person. The reservation is checked on the server in every path, including concurrent operations (invariant 9). Reusing an address for a different person is not an import behaviour; if the product ever needs it, it is an explicit, separately reviewed policy and a product decision, not something this design permits.
4. **History helps locate, never decides.** A historical address may be used to find the identity an import row probably refers to only when the row also carries unambiguous, trusted registration linkage (the same `external_registration_id` from the same source in the same event, or the registration record's own imported email in that event, as in Changed email above).
5. **A history match alone merges nothing.** Without that linkage, a match on a historical address neither merges identities nor attaches a registration; the row is quarantined (reason `previous_email_of_identity`).
6. **Collisions quarantine; stored collisions fail the gate.** A proposed import row whose email is the current or a historical address of a different identity than its linkage points to, or that cannot be matched unambiguously at all, is quarantined for admin review with both sides shown and nothing changed (D6.1 step 3a, Case B2). A collision that already exists in stored state, an address assigned to two identities or a registration whose ownership is in doubt, is not a row-level matter: it fails the migration's hard-invariant gate (Case B1) and production imports stay disabled until it is resolved and the invariants are rechecked. An unresolved evidence question about a stale address (Case A) is neither; it is reserved and quarantined without being treated as a proven collision.
7. **Imports never rewrite identity state.** An import never restores a previous address, never creates a duplicate identity for an address in history, never transfers a registration from one identity to another, and never creates, edits or deletes history entries; history is written only by E2-12, by the migration backfill from verified evidence, and by an audited admin decision (`migration.address_resolved`).
8. **The change workflow preserves everything.** E2-12 keeps the identity id and every event-registration id, and leaves attendance, consent, response and audit records attached; it records old and new address, decision, administrator, verification method and timestamp, and never a token, code or session value.
9. **Server-side and concurrency-safe.** Uniqueness, reservation and linking are enforced in the API and the database, not in the browser. An email change and an import run that touch the same address serialise on that normalised address (a per-address lock inside one transaction, the same mechanism the sign-in ledger uses), so two concurrent imports cannot create two identities for one address, and an import racing an email change either sees the completed change or is quarantined; a failed operation leaves no partial rows.
10. **Required implementation decisions (Increment 1b, not present today).** A store of previous identity addresses with date, actor and audit reference; a uniqueness check that covers current and historical addresses together; the per-address serialisation; and the migration gate in D6.1 step 3a, which seeds history only from verified evidence or audited admin decisions because existing audit entries may be incomplete. The email-change workflow itself remains subject to OQ-29; these invariants do not depend on OQ-29 and apply to import matching regardless.

### D6. Data model relationship (impact analysis; no schema change in this task)

Current state: `delegate` is an event-specific record with `event_id`, `email` and an optional `user_account_id`; `user_account` is created at first sign-in and linked by email; `resolveSession` picks the most recent linked delegate as "the" delegate. There is no platform-level identity row, so a person's events are related only through equal email strings and the account link made at sign-in.

Proposed model (OD-1 to approve):

| Entity | Purpose | Notes |
| --- | --- | --- |
| **delegate identity** (new) | One row per person: current canonical email, display name, timestamps, optional link to `user_account` | Created at import time, before any sign-in; unique on the normalised current email; uniqueness also checked against every identity's historical addresses (D5.1). Keeps `user_account` purely an authentication record |
| `delegate` (existing, per event) | Registration and event-specific facts | Gains `identity_id` (required for new rows, back-filled for existing rows by email); keeps `event_id`, `email` as imported, status, `user_account_id` becomes derived from the identity and is retired after back-fill |
| `import_run` (new) | One per upload: event, actor, file name and storage key, mapping used, counts, status (previewed, committed, discarded), timestamps | Admin-only read; append-only outcome |
| `import_row` (new) | One per file row: row number, outcome (accepted, updated, linked, duplicate_in_file, rejected, conflict), reason code (for conflicts: `external_id_mismatch`, `email_owned_by_other_identity`, `name_mismatch`, `inactive_account`, `shared_email_in_file`, `inconsistent_repeat`, `previous_email_of_identity`, `address_under_migration_review`), the delegate id it produced or touched | Powers the row report and the conflict queue |
| identity email history (new; implementation decision) | Previous canonical emails of an identity with the change date, the administrator and the audit reference; written only by E2-12, by the migration backfill from verified evidence, and by audited admin decisions (`migration.address_resolved`) | Reserved addresses: never reassigned to another identity by import or email change until a separately reviewed reuse policy exists; used only to recognise old-email import rows together with trusted linkage (D5.1); never consulted for sign-in eligibility |
| `attendance` (E6, later) | Day and session attendance per event delegate | Unchanged by this note; registration imports never create attendance rows (decision 2026-10-29) |

Alternative considered: creating `user_account` rows at import time instead of a separate identity. Rejected as the recommendation because it mixes authentication state with registration data, the unique email on `user_account` would block legitimate shared-mailbox handling decided under OD-3, and staff accounts would share a table with hundreds of never-signed-in delegate rows.

#### D6.1 Migration and backfill plan (Increment 1b; expand, verify, then contract)

1. **Expand.** Add the identity table and a nullable `identity_id` on `delegate` and on `user_account`. No existing column or row is dropped in this step, so the Increment 1 code keeps working until the application version that reads identities is deployed.
2. **Rehearse.** Run the backfill as a script on a copy of staging data first; it prints a report (counts below) and makes no change in dry-run mode. The same script runs in the deploy migration step.
3. **Backfill identities.** One identity per distinct normalised email across all `delegate` rows; the display name comes from the most recent record with status active. Every delegate row receives its `identity_id`, including rows with status duplicate, so their history stays attached to the person. Mixed-case variants of one address collapse into one identity by design.
3a. **Pre-import address gate (audit history may be incomplete).** Audit entries of earlier email changes are not assumed complete, so history is never seeded from audit evidence alone. For every delegate-role account and every identity candidate the script compares three things: the account email, the imported email on each event registration that links to that account, and any audit evidence of an email change (old and new value). A registration email that differs from its linked account's email is a potential historical address; name similarity resolves nothing in any case. The gate separates two outcomes that must never be confused.
    **Hard invariants (global; all must hold or the migration fails):** (H1) no normalised address is a current or historical address of two different identities; (H2) every delegate registration is linked to exactly one valid identity; legacy registrations whose ownership cannot be established from stored data and verified evidence make H2 fail, so the migration stops before the import feature is enabled and the data goes to Case B1 remediation; (H3) every historical-address record carries verified evidence (an audit entry recording that exact old-to-new change) or an explicit, audited admin decision; (H4) current-address and historical-address uniqueness is enforced by a database constraint across all identities, not merely observed by an application-level scan; the migration fails if that constraint cannot be created because stored data violates it; (H5) the migration has not silently merged identities, reassigned an address, discarded history or changed the ownership of any existing registration, checked against the pre-migration snapshot. The overall gate result is pass only when H1 to H5 all pass; a failed hard-invariant check rolls the migration back, or otherwise leaves the previous application version safely usable with existing ownership and history intact, and production imports stay disabled. A passing check on one address never overrides a failed global invariant.
    **Case A, unverified stale address (evidence incomplete, stored state consistent).** A registration email differs from its linked account's email, and the available evidence neither verifies the change nor shows that the address belongs to another identity. The address is reported as unverified, never treated as verified history, reserved provisionally so no other identity can claim it (the reservation is held in the same constraint-backed store as current and historical addresses, so a claim by another identity is refused, not merely detected), and every import row carrying it is quarantined on sight with reason `address_under_migration_review`. Case A findings do not fail the migration: it may complete only if H1 to H5 all hold with the reservations enforced, and production imports remain disabled for the affected addresses. An authorised, audited admin decision (`migration.address_resolved`) resolves the evidence question, but a decision alone never enables imports: the gate is rerun afterwards and imports for that address are enabled only if its ownership is established and H1 to H5 all pass. An unresolved Case A address never bypasses the gate because it is merely quarantined.
    **Case B, actual cross-identity collision.** An address is a current or historical address of identity A and is also assigned to, or proposed for, identity B, or the evidence shows that a registration may belong to a different identity than the one it is linked to. Both sides are reported to admins only, with no personal data in logs, and nothing is linked, merged, reassigned or guessed. Two sub-cases: (B1) the collision is in stored state, meaning the address is already assigned across two identities or a registration's ownership is in doubt, so H1, H2 or H5 cannot be established; this fails the hard-invariant gate, the migration is rolled back or the previous version kept usable, production imports stay disabled, and the migration is not reported as successful merely because rows were quarantined. An admin decision or audit entry alone cannot clear B1: the underlying data must be remediated under explicit written authorisation, with every step audited, preserving historical records and establishing unambiguous registration ownership; then the gate is rerun and imports remain disabled until every one of H1 to H5 passes. (B2) the collision exists only in a proposed import row while stored identity state is consistent; the row is quarantined and the conflicting action refused without changing any stored identity, registration or history record and without exposing the other person's data; it is resolved only through an authorised, audited action, after which the row's validation and the relevant global invariant checks are rerun, and the row is permitted only once its linkage is unambiguous and H1 to H5 still pass.
    An unresolved evidence question (Case A) is never promoted to a proven collision, and an actual ownership collision (Case B) is never downgraded to a row-level warning. The migration report lists every finding by case and by invariant with counts and ids only, never personal data, and records an overall fail whenever any hard invariant fails. Nothing in this gate exists today; it is implemented and tested in Increment 1b, and only its report counts, not its judgement, are considered verified evidence once it has run on a staging copy.
4. **Link accounts.** A delegate-role `user_account` is linked when its normalised email matches exactly one identity. An account whose email matches no identity (orphan account) or whose match is ambiguous is listed in the report, left unlinked and never guessed. An unlinked delegate account cannot sign in, because no eligible identity exists for it, until an admin resolves it from the report.
5. **Duplicate normalised emails.** Within one event the partial unique index already prevents two non-duplicate rows with the same address; rows marked duplicate are reported for information. Across events the same address is the expected multi-event case and links to one identity.
6. **Sessions.** Sessions of linked accounts stay valid. Sessions of unlinked delegate accounts are revoked by the migration so no session outlives its eligibility. Staff sessions are untouched.
7. **Verify, before and after.** Before the migration runs, the script records the intended M.Bryan admin account (active, able to authenticate) and the counts of delegate rows, registrations, consents, responses and audit rows. After the backfill it checks every invariant and fails safely (the transaction is rolled back and the old application version keeps running) if any is violated: the intended admin account is still active and a real sign-in succeeds; that admin can reach the import, history and conflict-resolution workflows; no account that held the analyst or support role was promoted to admin; every retired-role account is inactive, cannot authenticate and holds no active session; every unambiguous delegate identity is linked and its historical records are byte-for-byte unchanged (counts and checksums match the pre-migration figures); orphaned and ambiguous accounts appear in the report and are not linked; no delegate row is left without an identity; the address gate (step 3a) reports hard invariants H1 to H5 as passed, which includes that no stored cross-identity collision (Case B1) exists and that the uniqueness constraint of H4 is in place; Case A findings (unverified stale addresses) and Case B2 findings (proposed-row conflicts) are listed with imports disabled for their addresses and do not count as success for those addresses. The overall result is fail if any of H1 to H5 fails, whatever the other checks show. Pre-existing audit rows are unchanged (append-only); the migration adds exactly its own report entry. The report (identities created, rows without identity, accounts linked, orphan, ambiguous, retired-role accounts, sessions revoked, verified history entries, unverified stale addresses, collisions, pass or fail per invariant) is written durably as the report event `migration.identity_backfill` outside the backfill transaction, after its commit or rollback, with `result` pass or fail, counts and ids only; `pass` is possible only when H1 to H5 all passed and the backfill committed; if the report cannot be written the run counts as failed, imports stay disabled and the runbook recovery path applies (contract in D9).
8. **Contract.** In a later migration, after 1b is verified on staging: make `delegate.identity_id` required and retire `delegate.user_account_id` once every reader uses the identity link.
9. **Rollback.** The expand step is reversible by dropping the added table and columns; it deletes nothing, so the previous application version can be restored at any point before the contract step. A rolled-back run still leaves its durable `fail` report, and imports stay disabled until a later run writes a `pass` report.

### D7. Unified My Events (E3-10)

- After sign-in, `/account` becomes **My Events**: one list of every event linked to the delegate's identity, ordered upcoming events first (soonest first) and then past events with the most recent first (decided); whether archived events and cancelled registrations appear is pending (OQ-25, with a recommended default); with the event name, dates, location or format, and the delegate's own records for that event where they exist and the delegate is allowed to see them: registration status and attendance status shown separately (attendance only from an attendance record, otherwise "not recorded"), pre-conference assessment status and results, transfer plan, follow-ups, and other impact records as the later epics deliver them.
- One identity, one sign-in: the same session serves every event; nothing is re-authenticated per event.
- The API exposes `GET /api/v1/me/events` (list) and `GET /api/v1/me/events/:eventId` (one event with its records). Both resolve records through the session's identity on the server; the event id in the path is only accepted when that event has a delegate record linked to the caller's identity, otherwise 404. Frontend filtering is never relied on. Existing `GET /me/delegate` is superseded by the per-event endpoint.
- Staff views of a delegate's events use the existing role rules (admin reads and corrects with audit).

### D8. Authentication and authorisation implications (E3, E17)

Kept as implemented and verified in Increment 1: passwordless link and code, single-use hashed tokens with expiry, server-side sessions with idle and absolute expiry and revocation, origin check, PostgreSQL-backed rate limiting with keyed identities, generic responses, audit without secrets, redaction in API and proxy logs, and production configuration validation. No control is relaxed.

Required changes when Increment 1b is implemented (impact only, not done here):

1. Eligibility lookup at link request and at verification moves from "any `delegate` row with this email" to "an identity with this email that has at least one event record with status active in a non-archived event" . Only the identity's current address is considered; historical addresses (D5.1) are never eligible. In production, registrations with status `test` are never eligible; outside production they may be included only through an explicit non-production setting that the startup validation refuses when `NODE_ENV=production`, never through a code default (OQ-27, decided). The outward behaviour (generic 202, nothing sent otherwise) is unchanged.
2. At first verification the account is linked to the identity once, instead of `updateMany` on every delegate row by email. Later events need no action at sign-in.
3. `resolveSession` carries the identity id; `principal.delegateId` is replaced by the set of event delegate ids owned by the identity, resolved per request for the event in question.
4. `signed_up_at` is kept per event record (first sign-in while that record exists) so per-event sign-in rates (E15-1) still work.
5. The email-change workflow (E2-12) updates the email on the identity in place, revokes all its sessions immediately (existing `revokeAllSessions`), marks every outstanding sign-in token and code issued to the identity as used so no pending link, code or verification challenge survives, and is audited with method, admin, decision, time and old and new email; eligibility is evaluated against the identity's current email, so the old address can no longer obtain a link or verify; the new address is usable for delegate sign-in only once it has completed the normal passwordless verification; the identity id and every linked record are unchanged. Before updating, the server checks the new address against every identity's current and historical addresses and refuses a collision with an audited refusal; the check and the update run in one transaction serialised on both normalised addresses, and import matching takes the same per-address serialisation (D5.1 invariant 9). The verification policy itself (OQ-29) must be approved before this item is built.
6. Import endpoints are admin-only (`requireRole('admin')`), file uploads are size-limited, and parsing follows whichever strategy the evidence-based decision under OQ-23 selects, synchronous within the request or asynchronous in the worker, with any threshold recorded as part of that decision; whichever is chosen, the limits apply, nothing in a file is executed, nothing is written before confirmation, and the preview fingerprint and revalidation at confirmation are preserved. Every run writes audit entries without row contents (counts and ids only; personal data stays in `import_row`, which is access-controlled like delegate records).
7. Retiring the `analyst` and `support` roles present in the Increment 1 code, under an explicitly authorised plan and never by silent promotion: the 1b backfill report lists every account holding either role; the migration sets those accounts inactive and revokes their sessions, so they lose access the moment the new version runs; an M.Bryan admin then decides per person, in writing and recorded in the audit log, whether an admin account is created for them (E3-9) or the account stays inactive; the role values are removed from the code and the enum only after no account carries them. Policies and tests that mention the two roles are removed in the same increment. The pre- and post-migration verification in D6.1 step 7 proves that the intended admin keeps access and that no retired-role account was promoted or can still authenticate.
8. Pre-go-live gate for test data, verified with real authentication outcomes, not only a generic response: before production go-live, and before each future event goes live, an automated check run against the production configuration (in the deployment smoke test, with a runbook step) produces a clear pass or fail per item and blocks go-live on any failure: (a) production holds no delegate with status `test`, no `is_test` rows, no test-only account, and no identity linked only to test data; (b) a test-only identity cannot obtain an authorised delegate session: the full link and code flow is attempted under production configuration and no session cookie is issued and no `auth_session` row is created; (c) a session associated only with test data, created on purpose in a disposable copy of the production configuration, cannot read any delegate or event record and, once 1c exists, gets nothing from My Events; (d) the production configuration refuses to start with any staging-only authentication allowance set. Findings are removed or made ineligible before the gate is re-run. These are requirements for implementation and testing; nothing here has been executed yet. Recorded in the Increment 6 exit test and Appendix D.

### D9. Import security, privacy, auditability, error handling and recovery

- **Authorisation.** Upload, preview, confirm, history and conflict resolution are M.Bryan-admin-only; nothing is exposed to any other role, to delegates or to anonymous callers. Every route has a server-side check and a test.
- **Files.** Stored in Garage under `imports/<event>/<run>/` with the original name recorded in `import_run`, in a private bucket with no public URL; downloads go through an admin-authorised, short-lived signed request and are audited. The original file has one purpose, producing the preview and the commit; after the run reaches a terminal state it is only a retained copy. Retention duration and deletion trigger are unresolved (OQ-22): no duration is assumed here, and the final policy must be approved by the product owner and the legal or privacy stakeholders before production go-live. Temporary safeguard against unbounded retention until then: the retention setting is mandatory in production configuration and the startup validation refuses to enable uploads without an explicit value taken from the approved policy, so production cannot accumulate files under an undefined rule; staging and development use a short rehearsal value chosen by the team. Deletion runs as a scheduled worker job: a failed deletion is retried with backoff, every failure is logged with the run id (never the file contents) and raised through the existing monitoring alerts, and a report of files past their deletion point is available to admins and checked in the pre-go-live gate. Import audit history and row-level reports have their own lifecycle and are never deleted by the file job. XLSX is parsed with values only; CSV is parsed with a strict reader (no formula evaluation; cells starting with `=`, `+`, `-`, `@` are stored as text and flagged in exports to prevent spreadsheet injection on the way back out).
- **Personal data.** Row contents live in `import_row` and `delegate` only. Application logs carry run or request ids, counts and row numbers, never emails, names or row contents (existing scrubber). Import audit entries carry actor, event, run id, counts and record ids, never row contents. Identity audit entries hold what the requirement needs to investigate the action: `identity.email_changed` and `identity.email_change_refused` carry the old and new address, the administrator, the verification method, the decision and the timestamp (E2-12), and never a token, code, cookie or session value. The row report download is audited.
- **Audit contract, per operation.** Success events are written inside the business transaction they describe, so they commit only when that transaction commits and a refused or rolled-back operation can never leave a success event; refusal and failure events are written outside the business transaction, in their own transaction after the refusal or rollback, so the evidence is durable and does not depend on state the rollback invalidated; the audit log is append-only and existing rows are never edited or deleted; entries carry actor, event, run or request id, reason category and record ids, with old and new values only where the requirement needs them (E2-12 addresses, E2-13 statuses, changed delegate fields), and never a token, code, cookie, session value or row contents. Per operation: **import preview** writes `import.previewed`; **import commit** writes `import.committed` (counts including quarantined rows) plus one `delegate.imported`, `delegate.updated_by_import`, `identity.created` or `identity.linked` per changed record, and a failed commit writes `import.commit_failed` and none of those; **discard** writes `import.discarded`; **conflict resolution** writes `import.conflict_resolved` on success, `import.resolution_refused` when the server refuses the action, `import.resolution_failed` when it fails after acceptance; **email change (E2-12)** writes `identity.email_changed`, `identity.email_change_refused` or `identity.email_change_failed`; **delegate account status change (E2-13)** writes `identity.account_status_changed`, `identity.account_status_refused` or `identity.account_status_failed`; **migration address decision** writes `migration.address_resolved`, `migration.address_resolution_refused` or `migration.address_resolution_failed`. Rule: a successful operation writes its success events and no refusal or failure event; a refused or failed operation writes exactly one refusal or failure event and none of its success events. If writing the refusal or failure event itself fails, the operation stays failed, no success event is ever manufactured, the business data stays unchanged, and the failed write is surfaced through the application log and the existing monitoring alerts for operational recovery. **Migration gate runs are a report, not a success event:** each completed run of the backfill and address gate writes exactly one `migration.identity_backfill` entry carrying `result` pass or fail, the per-invariant results, counts and ids only; the report is durable independently of the backfill transaction: it is written outside that transaction, after its commit or rollback, from the gate's own result record and never from application state the rollback invalidates, so it exists whether the backfill committed or rolled back; a failed run therefore records `fail` and needs no separate failure event, and writes no `identity.*` or `import.*` success event; `result` pass can be written only from a run in which H1 to H5 all passed and the backfill committed, and the import feature is enabled only by the existence of such a durable pass report, so a missing or failed report leaves imports disabled. If the report mechanism itself fails, the run is treated as failed whatever the backfill did: the migration is not reported as passed, production imports remain disabled, the condition is raised through the monitoring alerts and the runbook recovery path (rerun the gate, which writes a fresh report), and no report is reconstructed afterwards from memory or logs. Events for distinct operations in one test scenario are expected independently, each under its own operation's rule, so a scenario can legitimately contain a refused resolution, a failed migration report and a successful email change at once.
- **Errors.** Unreadable file, wrong type, missing headers and oversize files fail at upload with a clear message. Row errors never abort the run. A failed commit rolls back the whole run and leaves the preview available to retry; partial commits are impossible by construction (one transaction).
- **Recovery.** A committed run cannot be "undone" automatically (records may already have sign-ins and responses). Corrections are made by re-importing a corrected file or editing records; the audit log and `import_row` give the full trail. Daily backups (E0) cover the data.

### D10. Increment 1b: delegate import and identity (next increment; delegates' My Events follows)

**Boundary.** Admin CSV/XLSX import with preview and confirm, field mapping, platform identity creation and matching, duplicate and conflict handling, import history and audit, and the authentication changes in D8 items 1 to 5. The delegate-facing My Events screen (D7) is Increment 1c, built on the same API once the identity model is in place. Nothing else from E4 onwards starts before 1b passes review.

**Dependencies.** The product decisions of 2026-10-29 are in place (identity model, unique email, name-matching rule, quarantine, mappings per source, file limits, roles, test data, attendance). Still open on the product side: the email-change verification policy (OQ-29) blocks E2-12 only, not the rest of 1b; the source-file retention policy (OQ-22) does not block 1b development but blocks production go-live and production uploads until approved and configured; the registration sources and sample exports (OQ-20) are needed before source-specific synonyms are finalised, while the generic mapping screen can be built without them. Implementation decisions for the dev team, to be taken on evidence rather than assumed: the identity table shape in D6, the parsing strategy (OQ-23), the preview fingerprint mechanics, and the XLSX library, which goes through the project's new-dependency review.

**Acceptance criteria (measurable; each is required behaviour to be proven by tests written in Increment 1b, none has been executed):**

1. Parsing: a UTF-8 CSV and an XLSX with the same 50 rows import to identical previews; a semicolon-separated CSV is detected; a file without a header row, a `.xls`, a 10.1 MB file and a 5,001-row file are refused at upload with the reason and, for size and row limits, the instruction to split the export; an XLSX containing formulas, macros or external links imports cell values only and executes nothing.
2. Validation: rows with an invalid email, a missing name, an unknown attendance format or a control character are listed as rejected with row number and reason; the other rows of the same file are accepted; an unmapped required field blocks the preview.
3. Duplicates in file: a file with the same email on rows 3 and 9 and identical normalised name and details imports one record and reports row 9 as "duplicate in file".
4. Repeated import: importing the same file twice creates no new delegate, identity or event record; the second run reports every row as "updated (no change)".
5. Corrected re-import: changing a job title on a row and re-importing updates that record in place, keeps its id and its sign-in link, and writes an audit entry with the old and new value.
6. Identity reuse: importing an email into event B that already exists in event A creates one event B record linked to the existing identity; the identity count does not change.
7. Conflict handling: a row with an existing `external_registration_id` and a different email is quarantined: the run commits its valid rows, no identity or delegate record is created or updated for the conflicting row, it appears in the conflict queue with both sides, and resolving it with an action valid for its type writes an `import.conflict_resolved` audit entry with the decision and the resulting ids.
8. Changed email: an admin email change on an identity revokes all its sessions, is audited, and the delegate signs in with the new address while a link issued to the old address is rejected.
9. Authorisation: every non-admin staff role receives 403 on upload, preview, confirm, history and conflict resolution; a delegate and an anonymous caller receive 401 or 403 on every import route; tests cover each.
10. Audit: every committed run has an `import.committed` entry with actor, event, run id and counts; no import audit entry and no application log line contains an email, a name or a row's contents (identity audit entries for E2-12 hold the old and new address by requirement, D9).
11. Preservation: existing delegate records, consents, invitations and sign-in links remain intact after a re-import; a registration missing from the new file is not deleted or cancelled.
12. Cross-delegate access: with two identities each linked to two events, a delegate session can read only the records of its own identity through the existing delegate endpoints; another identity's delegate ids return 404.
13. Authentication regression: the full existing API suite (89 tests at the time of writing), the web tests and the HTTPS browser flow still pass with the identity-based eligibility in place; no public sign-up route exists and `/signin` still refuses unknown addresses generically.
14. Stale preview: editing a matched delegate record, or committing another run for the event, between preview and confirm makes the confirm fail with "preview out of date" and no database change; a fresh preview then commits.
15. Migration: the backfill report (D6.1) shows zero delegate rows without an identity, lists orphan and ambiguous accounts without linking them, and revokes only the sessions of unlinked delegate accounts; existing registrations, consents and invitations are unchanged, every pre-existing audit row is unchanged, and the audit log gains exactly one `migration.identity_backfill` entry with `result` pass; the import feature becomes enablable only once that pass report exists.
16. Registration only: a file with a "checked in" or "attended" column imports with that column reported as ignored, and no attendance record exists afterwards.
17. Production eligibility and the test-data gate: under production configuration the full link and code flow for a `test` registration yields no session cookie and no `auth_session` row; a session that belongs only to test data cannot read any delegate or event record; the startup validation refuses a production configuration that enables test registrations; the gate check reports pass or fail per item and a failing item blocks the deployment; under staging configuration with the explicit non-production setting the same registration can sign in.
18. Role retirement and migration invariants: after the 1b migration no account holds the `support` or `analyst` role, the backfill report lists the accounts that held them, none was promoted to admin, those accounts cannot sign in and hold no active session, requests with a session from such an account are rejected; the intended M.Bryan admin account is active, signs in, and reaches the import, history and conflict workflows; a deliberately violated invariant on a staging copy makes the migration roll back and leaves the old version running.
19. Email change: an admin changes an identity's email through E2-12 after recording the verification method; every registration, attendance record, response, consent record and audit entry stays attached and the identity id is unchanged; all sessions are revoked at once and an outstanding link and code issued before the change are rejected afterwards; a link requested for the old address is not sent; the new address signs in only after completing passwordless verification; the audit entry holds method, admin, decision, timestamp, old and new email and no token or code; setting an address that is the current or a historical address of another identity is refused on the server, changes nothing, and is recorded as an audited refusal.
20. Saved mappings: a second file from the same registration source with the same headers reuses the saved mapping; a file whose headers differ requires the admin to confirm the mapping before the preview; both still require preview and explicit confirmation.
21. Name matching: an email match whose name differs only by surrounding or repeated whitespace, letter case or NFC form links silently and keeps the identity's name; an email match whose name differs in accents, order, abbreviation, spelling or a name part is quarantined and the identity's name is unchanged.
22. Shared email in file: a file with the same email on rows 3 and 9 but different normalised names quarantines both rows with reason `shared_email_in_file`, creates no identity or registration for either, counts two conflicts in the preview, and leaves the other rows committed; a same-email pair with identical names but a different organisation is quarantined as `inconsistent_repeat` and neither row is applied until an admin chooses.
23. Resolution preserves unique email: resolving a quarantined row whose email is already owned by another identity with "create a new identity" is refused by the server, no identity, registration or email changes, the response carries no record of the owning identity, and exactly one `import.resolution_refused` event and no `import.conflict_resolved` event is written; "link to the existing identity" on the same row succeeds only with the admin's same-person confirmation recorded.
24. Old-email row with established linkage: after an admin changes an identity's email, re-importing the earlier export for the same event (same source and `external_registration_id`, or the registration record's own imported email) updates that registration in place, creates no identity, and leaves the identity's canonical email as the new address.
25. Old-email row without linkage: importing a row with the previous address into a different event from a source without a stable id quarantines the row as `previous_email_of_identity`, creates no identity, changes no email, and after the admin links it as the same person the registration is attached to the existing identity with its canonical email unchanged.
26. Preservation across 24 and 25, business data and audit asserted separately: (a) business data: before and after both runs the identity id and every registration id are the same, the count of identities and the identity's attendance records, consent records and responses are unchanged, and the only registration change is the one updated or newly attached record; (b) audit: every pre-existing audit row is byte-for-byte unchanged and the audit log gains exactly the expected events, one `identity.email_changed`, one `import.committed` per run and one `import.conflict_resolved` per resolution, each with actor, run or request id and old and new values and no secret.
27. Parsing decision on evidence: before the parser implementation is finalised, a recorded architecture decision (in docs/) cites staging measurements for representative 10 MB and 5,000-row CSV and XLSX files covering peak memory, processing time, timeouts, concurrent imports, retries and failure recovery for both synchronous and asynchronous handling, and both candidate paths are shown to write nothing before confirmation and to keep the preview fingerprint and revalidation.
28. Collision with another identity's address: an import row whose email is the current address, or a historical address, of a different identity than its linkage points to is quarantined with both sides shown; no identity, registration or history row is created, changed or transferred.
29. Reserved historical address: an admin email change to an address that is the current or a historical address of another identity is refused on the server, nothing is modified, and the refusal is audited with the administrator and timestamp and without secrets.
30. Concurrent operations: two import runs confirmed at the same moment with the same new address produce exactly one identity and one quarantined or updated row, never two identities; an import confirmed while an email change for the same identity is in progress either observes the completed change or is quarantined, and in no case transfers a registration or duplicates the identity.
31. Historical address cannot sign in: after a change, a link request for the previous address returns the generic response and sends nothing, a token issued to it before the change is rejected, and no session exists for it.
32. History integrity: after two successive email changes the history holds both previous addresses in order with actor, date and audit reference; an import run cannot add, change or remove history entries; the history is readable only by admins.
33. Atomic failures, business data and audit asserted separately: a failure injected midway through an email change or a conflict resolution leaves identity, registration, email-history, attendance, consent and response data unchanged and writes none of the success events; every pre-existing audit row is unchanged and the audit log gains exactly one failure event (`identity.email_change_failed` or `import.resolution_failed`) carrying the request or run id, the actor and a reason category, with no token, code, cookie or personal data, and that event is present after the business transaction has rolled back; when the failure write itself is forced to fail, no success event appears, the business data is still unchanged, and the attempt is visible in the API log and raises the monitoring alert; the API log line for the attempt holds the same id and no personal data.
34. Re-import after change: re-running the full earlier export after an email change leaves every identity id and registration id unchanged, attaches nothing to a different identity, preserves attendance, consent and responses, leaves every pre-existing audit row unchanged, and adds only that run's own audit events (extends 24 to 26).
35. Reserved address cannot move to another identity: with an address that is a historical address of identity A and a quarantined row carrying it, an admin's "link to identity B" is refused on the server with no change to A, B, the row or any history entry, the response contains nothing about A, and one `import.resolution_refused` event is written; "link to identity A" with the linkage of D5.1 invariant 4 succeeds; the same refusal applies when the attempt is an E2-12 change of B's email to that address (`identity.email_change_refused`).
36. Case A, unverified stale address: on a staging copy where an account's email differs from its registration email and no audit entry records the change, the gate (D6.1 step 3a) reports the address as unverified and reserves it provisionally without recording it as verified history or as an established identity relationship; an attempt by another identity to claim the reserved address (import or E2-12) is refused with an audited refusal; the migration completes because H1 to H5 still hold; the import feature stays disabled for that address; an import row carrying it is quarantined as `address_under_migration_review`; after an admin records a `migration.address_resolved` decision, imports for the address stay disabled until the gate is rerun (criterion 42); name similarity does not change the outcome.
37. Verified stale registration email: where an audit entry records the exact old-to-new change, the gate seeds the old address as verified history and an old-email row with established linkage then updates its registration in place (as in 24) without creating an identity.
38. Case B1, stored cross-identity collision: with the same address assigned in stored state as the current email of identity X and a historical or linked registration address of identity Y, so that H1 cannot be established, the gate reports both sides to admins only, links or merges nothing, fails the hard-invariant gate, rolls the migration back or leaves the previous version serving, keeps production imports disabled, and leaves X, Y and every record unchanged; the migration report records an overall fail; recording a `migration.address_resolved` decision without remediating the stored data leaves the next gate run failed; only an authorised, audited remediation that establishes one owner for the address, followed by a rerun in which H1 to H5 all pass, enables imports.
39. Migration fails safely and preserves ownership: a deliberately injected failure of any hard invariant H1 to H5 (an address in two identities, a delegate row without identity, a history row without evidence, an unenforceable uniqueness constraint, or a changed registration owner) rolls the migration back, leaves the previous application version serving, changes no identity, registration, attendance, consent, response or audit record, leaves every registration linked to the same owner as before, and logs the failure with the invariant name and no personal data; the import feature stays disabled.
40. Case B2, proposed conflicting import: with stored identity state consistent, an import row whose email is a current or historical address of a different identity than its linkage points to is quarantined and the resolution action that would attach it is refused (`import.resolution_refused`), with no change to any stored identity, registration or history record and no personal data of the other identity in the response; the stored state remains consistent and H1 to H5 still pass for every other address; the row is permitted only after an authorised, audited resolution, a rerun of its validation and of the relevant global checks, an unambiguous linkage, and H1 to H5 still passing.
41. Imports disabled on invariant failure: while any hard invariant H1 to H5 is reported failed, the production configuration refuses to enable the import feature and every upload attempt is refused with an audited refusal; a failed gate is never recorded as a passed one.
42. Gate rerun after resolution: after an authorised, audited resolution of a Case A or B2 finding, or an authorised, audited remediation of a Case B1 finding, the gate is rerun and reports success only when H1 to H5 all pass, after which imports for the resolved address are enabled; a rerun with any invariant still failing keeps imports disabled for every address, and a passing result for one address never clears a failed global invariant.
43. Audit distinguishability across independent operations: in one scenario containing four distinct operations, one committed import with a quarantined row, one refused conflict resolution, one failed migration rehearsal and one successful email change, each operation is judged under its own rule (D9): the import adds exactly one `import.committed` carrying the quarantined count and its per-record events; the refused resolution adds exactly one `import.resolution_refused` and no `import.conflict_resolved`; the failed migration adds exactly one `migration.identity_backfill` report with `result` fail, present although the backfill rolled back, and no `identity.*` or `import.*` success event and no separate failure event; the email change adds exactly one `identity.email_changed` and no refusal or failure event; every pre-existing audit row is unchanged and no entry holds a token, code, cookie or row contents.
44. Delegate account status (E2-13): an admin deactivates a delegate account, `identity.account_status_changed` is written with old and new status and every session of the account is revoked; a non-admin attempt and an attempt on a staff account are refused with `identity.account_status_refused` and no change; a failure injected after acceptance leaves the status unchanged and writes only `identity.account_status_failed`; after reactivation the delegate has no session, a link request for an address without an eligible registration still gets the generic response, and sign-in works only through the normal passwordless verification with an eligible registration.
45. Durable migration reporting: (a) on a staging copy where the backfill rolls back, the `migration.identity_backfill` report with `result` fail is still present afterwards; (b) a run with any of H1 to H5 failing can never produce a report with `result` pass; (c) when the report write is forced to fail during an otherwise passing rehearsal, no pass report exists, the import feature cannot be enabled, the monitoring alert fires, and a rerun of the gate writes the report and enables imports only then; (d) when the report write is forced to fail during a failing rehearsal, imports stay disabled and the alert fires; in every case no report is reconstructed from memory or logs.

**Increment 1c acceptance criteria (My Events, after 1b is approved):**

1. `GET /api/v1/me/events` returns only events that have a delegate record linked to the caller's identity; with two identities each linked to two events, each session sees exactly its own two events.
2. `GET /api/v1/me/events/:eventId` returns 404 for an event id that belongs to another identity or has no record for the caller, and never a partial record.
3. Each event entry shows registration status from the delegate record and attendance only when an E6 attendance record exists, otherwise "attendance not recorded"; a registered-only delegate is never shown as attended.
4. The list, ordering and visibility follow the OQ-25 decision; the authorisation tests run against the API, not the page, so no filtering is done in the browser.
5. The page works at 360 px width with the same session used for sign-in; no second authentication occurs per event.

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
| E5-1 | As a delegate, I want to confirm my details | Name, email, organisation, job title/role, country, attendance format, capacity (individual / nominee of an organisation / other). Prefilled from my registration and editable where allowed (S7.2). **Decided 2026-10-30: no separate form; the details come from the registration import (E4) and the delegate profile page** | P0 | 2 |
| E5-2 | As a delegate, I want to state expectations and challenges | Five questions in S7.3, stored as separate answers (see Appendix A, Q-EXP-1 to 5). Done 2026-10-30 as ITTEC pilot content (section "Expectations and challenges" of the example set): long answers, Q4 "What would make attending ITTEC valuable to you?" optional, all others required | P0 | 2 |
| E5-3 | As a delegate, I want to rate my current practices | Seven statements; scale Always, Often, Sometimes, Rarely, Never, Not applicable to my role. Each statement stored separately. "Not applicable" is **not** scored as a low rating (S7.4). Done 2026-10-30: single-choice statements in a section marked Rating scale, with option weights 5 to 1 and an unscored "Not applicable to my role" option (decided: not a rating-scale question); averages exclude it | P0 | 2 |
| E5-4 | As a delegate, I want to answer five baseline knowledge questions | Introduction text exactly as in S7.5. Options A-E with "I am not sure" as E (decided 2026-10-30: one wording for all five). Correct answers: Q1 B, Q2 C, Q3 D, Q4 A, Q5 C. Each answer stored. Done 2026-10-30: single-choice questions in a section marked Knowledge, one option ticked correct per question in the builder; introduction as the section description | P0 | 2 |
| E5-5 | As a delegate, I want to see immediately whether each knowledge answer is correct | Result shown after each answer (S7.5 note). Done 2026-10-30 following the document (OQ-2): the answer is saved the moment it is chosen, "Correct" or "Not quite, the correct answer is …" is shown at once, and the answer is locked; after submission the delegate sees only this per-question feedback | P0 | 2 |
| E5-6 | As the platform, I calculate the knowledge score | 1 point per correct answer; incorrect or "not sure" = 0; total 5; percentage = correct / 5 x 100; total score stored with each answer. Done 2026-10-30: `correct` and `score` stored per answer; the stage summary gives the average score and percentage over delegates who answered every knowledge question in a submitted response | P0 | 2 |
| E5-7 | As a delegate, I want to rate my confidence | Seven statements, scale 1-5 plus "Not applicable to my role" (S7.6). Same statements and scale reused in the final assessment. Done 2026-10-30: confidence preset (1 to 5 scored, "Not applicable" unscored); how the final assessment pairs its statements with these is to be decided with that stage (E11-7) | P0 | 2 |
| E5-8 | As a delegate, I want to say which tools and practices I use | Multi-select list from S7.7 with "None of the above", "Not applicable to my role" and "Other: please specify" (text required when Other selected). Exclusivity enforced. Done 2026-10-30: exclusive options and "Other, please specify" with required text, enforced in the browser and on the server (422 `answers_invalid`) | P0 | 2 |
| E5-9a | As M.Bryan, I want a dashboard per event | Done 2026-10-30: `/admin/events/:id/dashboard` shows delegates (registered, signed up, invited, in person/online, by status), each assessment stage with its window state and response counts, and messages sent, from one admin-only call (`GET /events/:id/dashboard`) | P0 | 2 |
| E5-9 | As M.Bryan, I want the pre-conference completion count | Number of invited delegates, started, submitted; list of non-completers for reminders. Done 2026-10-30: invited, started, submitted and response rate on the stage card (`GET .../assessments/:stage/summary`); the non-completer list (`GET .../non-completers`: not signed up, not started, started) under "Not yet submitted" with "Email these delegates", which opens the E2-14 message composer with them selected | P0 | 2 |
| E5-10 | As M.Bryan, I want a summary of delegate expectations and needs before the conference | Export/printable summary of S7.3 answers and baseline results (S17 Phase 3). Done 2026-10-30 as a CSV export of submitted responses (`GET .../assessments/:stage/responses.csv`, one row per delegate, option labels, a correct column per knowledge question and the total; audited) plus the on-card summary (counts, knowledge average, statement averages). A printable narrative summary is not built | P1 | 5 |

---

## E6. Attendance (S8.1)

| ID | Story | Acceptance criteria | Pri | Inc |
|---|---|---|---|---|
| E6-0 | As M.Bryan, I want attendance managed per event date with QR check-in, manual and bulk marking, corrections, closure and session attendance (attendance requirements, 2026-10-30) | Done 2026-10-30: individual QR code per delegate per date on the delegate's event page; admin scans (camera or typed code), the platform validates event and date and shows the registration, the admin confirms after checking the person; manual lookup and marking; bulk marking for online delegates with duplicates skipped and reported; corrections with a reason and audit history; per-date closure records absences; session attendance separate from the date; statuses not checked in / attended / partially attended / absent per date and attended / partially attended / absent / pending overall; delegate attendance profile; dashboard counts. Admins only, every action audited | P0 | 3 |
| E6-1 | As event staff, I want to check in physical delegates | Search by name/email, mark day 1 and/or day 2 presence; timestamp and user recorded; usable on a phone or tablet | P0 | 3 |
| E6-2 | As event staff, I want to record virtual attendance inside the platform | Virtual delegates are marked present per day (and per session where practical, E6-4) by staff from the attendance screen, the same workflow as E6-1, with timestamp and user recorded; corrections follow E6-3. The virtual platform's attendance report may be consulted by staff for reconciliation but is never imported: no external report creates or updates attendance records, and registration never implies attendance (decision 2026-10-29). Source S8.1 reads "record or import" for virtual attendance; if the product owner reads that as requiring an attendance-writing import, it conflicts with this decision and must be raised, not implemented | P0 | 3 |
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
| E15-1 | Platform first-sign-in rate | Imported delegates of the event who have signed in at least once / valid registered delegates of the event x 100 | P1 | 5 |
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
| E17-6 | Privacy information | Section 6.4 text displayed at first sign-in and available in the footer; consent for sharing identifiable comments with sponsors recorded per delegate | P0 | 1b |
| E17-7 | Backup and recovery | Documented process; restore tested end to end before go-live | P0 | 6 |
| E17-8 | Correction process for delegate records | Covered in E2-4; delegate can request correction from their account | P0 | 1 |
| E17-9 | Documentation of ownership and hosting | Platform, data and source-code ownership, hosting and support arrangements written and handed over | P1 | 6 |
| E17-10 | Data minimisation and retention | Define retention period and deletion/anonymisation process; delegate can ask for deletion | P2 | Post |

---

## E18. Testing and acceptance (S17 Phase 2)

Each test is a runnable checklist for M.Bryan plus automated tests where possible.

| ID | Test (workplan) | Required result | Inc |
|---|---|---|---|
| T1 | First sign-in and access | An imported delegate can sign in for the first time, sign in again and recover access; an unknown email is refused generically (the cross-event My Events view is tested in 1c) | 1, 1b |
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
| E19-1 | Before conference: import and invitations | Import delegates from the registration export (CSV/XLSX), resolve conflicts, issue invitations, share the pre-conference assessment, monitor first sign-in and completion, send agreed communications | P0 | 6 |
| E19-2 | Before conference: summary | Provide M.Bryan a summary of expectations and needs | P1 | 6 |
| E19-3 | Day 1 operations | Record/import attendance, issue Day 1 check-in, share urgent experience issues promptly | P0 | Nov 12 |
| E19-4 | Day 2 operations | Issue Day 2 check-in, support the 30-minute Transfer Planning session, issue the final evaluation | P0 | Nov 13 |
| E19-5 | Named support person | One named developer available throughout the conference including the Transfer Planning session; backup named | P0 | 6 |
| E19-6 | Immediately after | Review records, completion and data quality; prepare and share the initial experience and learning report | P0 | Nov 14+ |
| E19-7 | Send 30-, 60-, 90-day follow-ups, monitor responses and delivery, provide follow-up reports and support summaries | See E12, E16 | P0 | Post |
| E19-8 | Handover pack (S18) | Access to platform and dashboard; guide to viewing delegate information and reports; guide to exporting data; final question list, options and scoring; calculation rules; privacy and data-sharing information; technical and hosting documentation; backup and recovery arrangements; named support contacts; maintenance and support arrangements | P1 | 6 |
| E19-9 | Phase 5 review | Ease of first sign-in and use, completion of assessments and plans, reliability of reminders and follow-ups, report usefulness, data collected, technical issues, changes before another event | P2 | Post |

---

## 4. Increment plan with exit tests

| Inc | Stories | Exit test (M.Bryan can run) |
|---|---|---|
| **1** (Oct 29, delivered) | E0-1 to 7, E0-10, E0-12, E1-1, E1-2, E3-2 to 6, E3-9, E3-11, E17-1 to 4, E17-8 | Staging over HTTPS; push deploys; sign in a seeded delegate with link and code; unknown email refused generically; replayed link rejected; a delegate cannot see another's data; backup restores into an empty database. Delegate import (E2) was not delivered in this increment and moved to 1b |
| **1b** (next) | E2-1 to 5, E2-8 to 11, E2-13, E2-12 once OQ-29 is approved, E3-1, E3-2 (identity-based), E3-7, E17-6; design note D10 | Import an XLSX and a CSV for the same event; preview shows accepted, rejected, duplicate-in-file and conflicting rows with reasons; confirm; re-import the corrected file and confirm no duplicates and preserved ids; import the same person into a second event and confirm one identity; conflict queue resolution audited; no non-admin role can import, read history or resolve conflicts; sign in as the imported delegate; change that delegate's email through the admin workflow (once OQ-29 is approved), verify the new address and sign in with it while the old address and a pre-change link are refused; re-import the earlier export and confirm the old-address row updates in place where linked and is quarantined where not, with no second identity; rehearse the migration on a staging copy with one unverified stale address (Case A: migration completes, address reserved, imports disabled for it until an audited decision and a passing gate rerun), separately with one stored cross-identity collision (Case B1: hard-invariant gate fails, migration rolled back, nothing changed, a decision alone does not clear it, remediation plus a passing rerun does), and with one proposed conflicting row after a passing migration (Case B2: row quarantined, action refused, stored records unchanged); deactivate and reactivate a delegate account and confirm sessions are revoked and the delegate must sign in afresh with an eligible registration; force the migration report write to fail once and confirm imports stay disabled until a rerun writes a pass report; existing auth suite still green |
| **1c** (with Inc 2) | E3-10; design note D7 | Sign in as a delegate present in two events and see both in My Events with registration status and "attendance not recorded"; another delegate's event ids return 404 |
| **2** (Oct 31) | E1-3, E1-4 (stages), E1-7, E2-7, E4-1 to 9, E4-11, E4-12, E5-1 to 9 | Complete the pre-conference assessment on a phone, leave and resume; exclusivity rule blocks invalid answers on client and server; knowledge scoring and immediate result correct; admin sees completion count |
| **3** (Nov 2) | E2-6, E6-1 to 5, E7-1 to 4, E8-1 to 9, E8-11, E13-1 | Scan a session QR, sign in, land on the right form; repeat submission updates rather than duplicates; Day 1 Q3 appears in the admin attention view and email; attendance corrections audited; support request creates a record |
| **4** (Nov 4) | E3-8, E9-1 to 12, E10-1 to 6, E11-1 to 4, E11-6, E11-8 to 14, E14-1 to 3, E14-5 | Create a plan on Day 1, edit on Day 2, submit, edit again and confirm version 1 is preserved; physical and virtual delegates get different questions; expectation flows (with and without a pre-conference answer); reminder preferences saved. **Go/no-go check this evening** |
| **5** (Nov 6) | E0-8, E0-9, E4-10, E5-10, E6-6, E8-10, E10-7 to 12, E11-5, E11-7, E11-15, E12-1 to 6, E12-8 to 15, E13-2 to 6, E14-4, E15-1 to 18, E16-1, E16-2, E16-3, E16-6, E16-8, E16-9, E17-2, E17-4, E17-5, T2 to T16 | Dashboard matches the known-results dataset exactly; reminder sent once after worker restart; load test passes; restore test passes; access-control and duplicate tests pass; follow-up forms show the plan. **Code freeze** |
| **6** (Nov 7) | E0-7, E0-11, E17-7, E17-9, E19-1, E19-2, E19-5, E19-8 | Production smoke test of full sign-in-to-submission path; every alert triggered once and received; invitations ready to send; named support contacts confirmed; test-data gate passed under production configuration: no test registrations, test-only accounts or test-only identities, no session obtainable for a test-only identity, and the staging-only allowance refused (D8 item 8) |

**If the Nov 4 check fails, cut in this order:** E14-3 file upload (keep text evidence), E16-3 follow-up report, E15-13 to 16 panel polish, E8-10 speaker view, E13-5 barrier tagging. Core P0 items are not cut.

---

## 5. Open questions (decisions needed; owner: M.Bryan)

| ID | Question | Why it matters | Needed by |
|---|---|---|---|
| **OQ-1** | **Final content freeze.** Are all questions, options and scoring final? | Late changes are the largest rework risk | Oct 30 |
| **OQ-2** | **Immediate right/wrong feedback on knowledge questions (S7.5).** The workplan says delegates see the result immediately. Showing the correct answer before the post-test lets delegates learn the answer from the pre-test and inflates the "change" figure. Options: (a) show correct/incorrect only, never the correct option; (b) show correct/incorrect in the pre-assessment only and not repeat it in the final assessment; (c) as specified. Which? | Affects validity of the paired-change indicator | **Resolved 2026-10-30: (c), as specified; the correct option is shown and the answer locked. The paired-change report (E11-4) must state that the pre-test showed the answers** |
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
| **OQ-13** | **Consent to share identifiable comments.** Is consent captured per delegate at first sign-in, or asked when a comment is selected for sharing? (S6.4) | Reports and sponsor sharing | Nov 4 |
| **OQ-14** | **Phase 1 vs scope.** S17 Phase 1 says the complete conference and follow-up workflow must be built and tested by Nov 7. This backlog builds follow-up forms (E12-1 to E12-6) by Nov 6 but defers the 180-day scheduling and PDF/DOCX reports. Confirm acceptable | Scope of Nov 7 | Oct 30 |
| **OQ-15** | **Team capacity.** Number of developers, weekend availability, and the M.Bryan acceptance contact for each increment | The plan assumes at least two or three developers working in parallel | Oct 28 |
| **OQ-16** | **Support contact and data region.** Confirm hosting region and the named support person for the conference | Privacy and live support | Nov 2 |
| **OQ-17 / OD-1** | **Platform identity model.** Decided 2026-10-29: one platform-wide delegate identity per person across events, each event keeping its own registration record. The table shape in D6 (identity table created at import) is an implementation detail for the dev team | Closed | Done |
| **OQ-18 / OD-2** | **Name mismatch on an email match.** Decided 2026-10-29: the established identity name is preserved and never overwritten by an import. Matching rule (D5): one deterministic normalisation (trim, collapse whitespace, Unicode NFC, case folding); only an identical normalised name links automatically; any other difference (accents, order, transliteration, abbreviation, spelling) is quarantined for admin review; names that look similar never merge identities | Closed | Done |
| **OQ-19 / OD-3** | **Shared email addresses.** Decided 2026-10-29: each identity has a unique email; shared-email conflicts are quarantined for admin resolution; one delegate's records are never exposed to another (D5) | Closed | Done |
| **OQ-20 / OD-4** | **Registration platform exports.** Still open: which platform(s) export the files, whether each carries a stable registration id per row, and a sample export per platform. Source-specific header synonyms and mapping behaviour are finalised only after the sample exports arrive; until then the admin maps columns by hand under an explicitly selected source. Decided already: ids are scoped to their event and source and ids from unrelated sources are never compared to merge identities | Field mapping, re-import correctness | Before source-specific mappings are built |
| **OQ-21 / OD-5** | **Saved mappings.** Decided 2026-10-29: saved per registration source, reused when the file structure matches, re-confirmed when it changes; preview and confirmation always required (D4) | Closed | Done |
| **OQ-22 / OD-6, OD-7** | **Import limits decided; source-file retention open.** Limits decided 2026-10-29: 10 MB and 5,000 rows, larger files rejected with split guidance, `.csv` and `.xlsx` only. Unresolved: the retention duration for original uploaded files and the deletion trigger (for example, a period after the run reaches a terminal state, or after the event is archived). No value is assumed. Temporary safeguard (D9): production refuses to enable uploads without an explicit retention setting taken from the approved policy, so files cannot accumulate under an undefined rule; deletion failures are retried, alerted and reported. Import audit history and row reports have a separate lifecycle. Approval by the product owner and the legal or privacy stakeholders is required before production go-live | Privacy, storage | Before go-live |
| **OQ-23 / OD-8, OD-9** | **Parsing strategy and XLSX library.** Implementation decisions for the dev team, not product decisions, and genuinely open: neither synchronous request handling nor asynchronous worker processing is prescribed anywhere in this backlog. The decided limits (10 MB, 5,000 rows, `.csv` and `.xlsx` only, `.xls` and other types refused, formulas, macros and links never executed) do not by themselves establish safe runtime behaviour. Before the parser implementation is finalised the team evaluates both approaches with representative files in staging, measuring peak memory, processing time, request timeouts, concurrent imports, retries, failure recovery, and safe preview and confirmation behaviour (fingerprint kept, revalidation at confirmation, no writes before confirmation), and records the chosen strategy and any size or row threshold as an architecture decision supported by that evidence. The XLSX library must read values only and goes through the project's new-dependency review | Dev team, evidence from staging | Before the parser is finalised |
| **OQ-24** | **Attendance columns in registration exports.** Decided 2026-10-29: ignored. Registration imports carry registration data only; attendance is recorded inside the platform (E6) | Closed | Done |
| **OQ-25** | **My Events visibility (ordering decided).** Decided 2026-10-29: upcoming events first (soonest first), then past events with the most recent first; registration status and attendance status shown separately (D7). Open for approval: visibility of archived events and cancelled registrations. Recommended default, not yet approved: show cancelled registrations with their status once the identity has authenticated normally; hide archived events from the default list while keeping their records and enforcing server-side authorisation on any request for them | Delegate experience (E3-10) | Before 1c starts |
| **OQ-26** | **Support role.** Decided 2026-10-29: not part of the approved requirements; removed, not replaced. Existing support accounts in the code are reviewed and revoked or migrated under the explicit plan in D8 item 7, never silently promoted to admin | Closed | Done |
| **OQ-27** | **Sign-in for test records.** Decided 2026-10-29: test registrations and test accounts never authorise production delegate access; production requires a genuine, eligible imported registration. Development and staging may use test data for rehearsals and automated tests. Pre-go-live verification added (D8 item 8, Increment 6 exit test, Appendix D). Enabling test sign-in is not a product feature | Closed | Done |
| **OQ-28** | **Virtual-platform attendance report import (E6-2).** Decided 2026-10-29: attendance is recorded and managed inside the platform; no external attendance report creates or updates attendance records; E6-2 revised accordingly. Flag for the product owner: source S8.1 says "record or import" for virtual attendance; if that is read as requiring an attendance-writing import, it conflicts with this decision | Closed (S8.1 wording flagged) | Done |
| **OQ-30** | **Event start and end dates (E1-1).** The brief of 2026-10-30 (section 4) proposes deriving them from the earliest and latest selected dates, "subject to confirmation". Implemented that way: `starts_on`/`ends_on` follow the selected dates and are never edited directly. Confirm, or specify an explicit start and end | Open (2026-10-30) | Blocks nothing; confirm before go-live |
| **OQ-31** | **Assessment target group (E1-4).** A stage can target "a defined participant group" with a name, but which registrations belong to the group is not defined. Until decided, the platform serves such a stage to every delegate of the event like "all delegates" and shows the group name to admins only | Open (2026-10-30) | Decide before a group-targeted stage opens |
| **OQ-29** | **Email-change verification policy (approval required before E2-12 is implemented).** No policy is approved yet. Recommended process for approval: the admin checks the request against the original registration record (name, organisation, registration details supplied by the requester) or confirms it through a trusted organisational contact such as the nominating organisation, records the method used, and only then approves the change; possession of the proposed new address is never sufficient on its own, and a request arriving from the registered address is one input, not proof. The product owner must approve this or an alternative before E2-12 is built; the rest of Increment 1b is not blocked | Identity integrity | Before E2-12 implementation |

Decided rows stay in the table for traceability. Items that are implementation decisions for the development team rather than product decisions, to be taken on evidence: the identity table shape (D6), the preview fingerprint mechanics (D3.5), the parsing strategy and XLSX library (OQ-23), the migration mechanics (D6.1), the retention-job mechanics (D9), and the exact import-run and import-row structures.

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
| Registration file quality (missing or shared emails, inconsistent columns) | Delegates cannot sign in or are duplicated | Mapping step, row-level preview, conflict queue, sample exports requested (OQ-20) |
| Silent identity merge across events | One person sees another's records | Conflicts held for admin resolution, never auto-merged; cross-delegate access tests in 1b and 1c |
| Import files hold personal data | Leak through storage or logs | Object storage with retention, admin-only access, logs carry counts and row numbers only |
| Delegate import slips past Oct 30 | Invitations and pre-assessment cannot start | 1b is the only work before Inc 2; cut saved-mapping reuse (manual mapping stays) first |

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
| Platform first-sign-in rate | Imported delegates who have signed in at least once / total valid registered delegates x 100 |
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
- [ ] Each imported delegate can sign in to one individual account that shows every event they are part of; no public sign-up exists
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
- [ ] Test-data gate passed before go-live: no test registrations, test-only accounts or test-only identities in production, no delegate session obtainable for a test-only identity, staging-only allowance refused (D8 item 8)
- [ ] The development team is ready to operate and support the platform during ITTEC and the agreed follow-up period