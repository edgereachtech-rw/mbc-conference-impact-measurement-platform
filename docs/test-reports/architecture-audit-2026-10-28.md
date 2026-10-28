# Architecture, implementation and readiness audit

Audited on 2026-10-28 against commit `51a61d5` plus the uncommitted working tree (31 changed or
new paths, mostly the observability work done the same day). Requirements source:
`docs/backlog.md` (19 epics, 189 stories, question bank and indicator definitions) with
`CLAUDE.md` as the engineering rules. Companion evidence: `docs/test-reports/increment-1.md`
(independent Increment 1 test run, same day). No application code, configuration or data was
changed by this audit; all commands were non-destructive and ran against local containers only.

## 1. Executive summary

The repository is a well-built **foundation**, not a product. What exists and is behaviourally
verified: a pnpm/TypeScript monorepo with working quality gates (lint, type-check, 50 tests,
production builds), a branded mobile-first web shell with four placeholder pages, an Express API
exposing only liveness/readiness endpoints with structured, redacted logging and JSON error
handling, a PostgreSQL schema for seven foundation tables with an append-only audit log and a
case-insensitive unique-email rule, an idempotent seed, a transactional email layer with three
templates delivered to a development inbox, a hardened single-VPS Docker Compose stack behind
Caddy, encrypted off-site backups with a tested restore, and CI/CD workflows that build and push
images (the deploy itself fails for lack of a configured staging environment).

None of the delegate-facing or organiser-facing business functionality exists: no sign-up or
sign-in, no registration import, no assessments, check-ins, session feedback, Transfer Plan,
reminders, follow-ups, dashboards or exports. Every requirement in areas A to G and most of H
and I is **Not implemented**. The platform cannot be trusted for the pilot today, and with the
pilot target of 7 November 2026 ten days away and six backlog increments planned for the same
window, the schedule is the dominant risk.

## 2. Repository architecture (as found)

| Area | What is actually there | Evidence |
| --- | --- | --- |
| Workspace | pnpm 10.18.3 workspaces `apps/*`, `packages/*`; root scripts `dev`, `build`, `lint`, `typecheck`, `test` (sequential per package), `screenshots`, `mail:test`, `email:screenshots` | `pnpm-workspace.yaml`, `package.json:8-22` |
| `apps/web` (`@mbc/web`) | Next.js 16.4.3 App Router, Tailwind 4, shadcn/ui on Base UI; routes `/`, `/signin`, `/account`, `/admin` (three are "Coming soon"); event facts in `src/config/event.ts`; Sentry hooks in `src/instrumentation*.ts`; 45 source files, 2 212 lines | `apps/web/src/app/*/page.tsx`, `apps/web/src/lib/session.ts:15-16` (`getSession` always returns `null`) |
| `apps/api` (`@mbc/api`) | Express 5; one app factory with request-id, pino-http, JSON body limit 1 MB, `/health`, `/ready`, 404/error handlers; worker entry (`src/worker.ts`) boots pg-boss with **no jobs registered**; mail module; seed; 29 source files, 2 120 lines | `apps/api/src/app.ts:52-96`, `apps/api/src/worker.ts` (grep for `boss.work` → none) |
| `packages/shared` (`@mbc/shared`) | `APP_NAME`, a placeholder `healthResponseSchema`, and the personal-data scrubber; built to `dist/` on install | `packages/shared/src/index.ts:4-17`, `packages/shared/src/scrub.ts` |
| Data layer | Prisma 7 with the `pg` driver adapter; one migration `20261027235019_init`; models Event, ParticipationCategory, UserAccount, Delegate, Invitation, ConsentRecord, AuditLog; hand-written SQL for `lower(email)` uniqueness and the append-only trigger | `apps/api/prisma/schema.prisma:108-253`, `apps/api/prisma/migrations/20261027235019_init/migration.sql` (tail) |
| Auth / authz | None. No session, token, password, cookie, CSRF or rate-limiting code; no `helmet`, `express-rate-limit`, `csurf` or `cors` packages | grep across `apps/*/src`; `apps/api/package.json` dependencies |
| Background jobs | pg-boss client started; heartbeat to Healthchecks.io; no queues, schedules, retries or delivery records | `apps/api/src/worker.ts:27-45` |
| Integrations | SMTP via Nodemailer (relay or Mailpit), Sentry (optional, DSN-gated), Healthchecks.io pings, S3 API (Garage) for backups only; the application itself has no object-storage code yet | `apps/api/src/mail/*`, `apps/api/src/lib/sentry.ts`, `deploy/backup/*` |
| Deployment | Docker Compose: caddy (only published ports), web, api, worker (same image), db (Postgres 16.15), garage (S3-compatible, AGPL-3.0), backup; dev override with hot reload and Mailpit; GitHub Actions CI, staging deploy on push to `main`, manual production deploy with approval environment; deploy/rollback scripts | `deploy/docker-compose.yml`, `deploy/docker-compose.override.yml`, `.github/workflows/*.yml`, `deploy/scripts/*.sh` |
| Observability | pino JSON logs with scrubbing hook; request ids; Caddy access log filtered (no query strings, headers, full IPs); Sentry with `beforeSend` scrub; worker heartbeat; `docs/monitoring.md` | `apps/api/src/lib/logger.ts`, `deploy/Caddyfile:51-69`, `docs/monitoring.md` |
| Documentation | README, deploy README, backup and recovery, environments, email setup, design tokens, monitoring, backlog | `docs/` |

**Boundaries and dependencies.** Responsibilities are clear (web renders, api serves, worker
runs jobs, shared holds cross-cutting code) and there are no circular dependencies: shared
depends on zod only; web and api depend on shared. Two boundary weaknesses: (1) `packages/shared`
holds almost nothing domain-related yet, so "rules written once" (E0-1) is aspirational; web
imports only the scrubber; (2) event facts live in `apps/web/src/config/event.ts` as code while
the API reads them from the database, so the two can drift (see F-07). Type safety across the
API boundary does not exist yet because there is no API contract beyond health; when routes
arrive, request/response schemas must live in shared or drift will follow.

**Configuration consistency.** Production and dev differ only through the Compose override
(hot reload, Mailpit, HTTP on localhost, `'unsafe-eval'` in CSP). Environment variables are
read ad hoc (`process.env.X` in `server.ts:10`, `worker.ts:12-35`, `db.ts:16`); only the mail
module validates with Zod (`apps/api/src/mail/config.ts:13`). A missing `DATABASE_URL` is
caught at first use; a malformed one is not caught until a query runs.

## 3. Implementation inventory

| Feature | Status | Notes |
| --- | --- | --- |
| Monorepo, tooling, quality gates, pre-commit | Implemented, verified | A1-A6 in the test report |
| Branded web shell, design tokens, PWA manifest, reusable components | Implemented, verified | B1-B8; components are unused by any feature yet |
| API liveness/readiness, request ids, JSON errors, redacted logging | Implemented, verified by unit tests; live probes pending (see §5) | added 2026-10-28 |
| Sentry (web/api/worker), heartbeat | Implemented, unit-tested; not exercised against a real Sentry project | |
| Database schema (7 tables), migration, seed, audit helper | Implemented, verified (migrate twice, constraints, trigger, seed idempotence) | no application writes other than the seed |
| Email templates and transport | Implemented, verified against Mailpit | no sending from any workflow yet |
| Docker stack, Caddy, security headers | Implemented, verified locally | |
| Backups, restore, retention, failure pings | Implemented, verified locally with a Garage stand-in | real off-site provider untested |
| CI, image publish, deploy/rollback scripts | Implemented; CI verified on GitHub; staging deploy fails (environment unconfigured) | |
| Event setup (E1) | Not implemented | tables and seed only |
| Delegate import, duplicates, status (E2) | Not implemented | columns only |
| Sign-up, sign-in, sessions, roles, consent, staff accounts (E3) | Not implemented | tables only |
| Question engine, versions (E4) | Not implemented | |
| Pre-conference assessment (E5), attendance (E6), check-ins (E7), session feedback (E8) | Not implemented | |
| Transfer Plan (E9), reminders (E10), end-of-conference evaluation (E11), follow-ups (E12) | Not implemented | |
| Transfer support (E13), business measures/evidence (E14) | Not implemented | |
| Dashboard/indicators (E15), reports/exports (E16) | Not implemented | |
| Security, privacy, audit (E17) | Partially: audit table and `audit()` helper, redacted logs, backups/restore; no CSRF, rate limiting, export permissions, correction/deletion workflows | |
| Testing and acceptance (E18), live operation (E19) | Not implemented beyond the Increment 1 test report | |

## 4. Requirements traceability matrix

Status vocabulary: Verified, Partially implemented, Implemented unverified, Not implemented,
Defective, Blocked, Not applicable.

### A. Delegate identity and registration (E2, E3)

| Requirement | Relevant implementation | Evidence | Test evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- | --- |
| Sign-up linked to registration (E3-2) | none; `apps/web/src/app/signin/page.tsx` renders ComingSoon | `curl /api/v1/auth/magic-link` → 404 | none | Not implemented | whole delegate journey blocked |
| Passwordless sign-in, expiry, rate limit, cookie flags (E3-3/4/5) | none | no session/cookie code (grep) | none | Not implemented | |
| Secure account recovery (E3-5) | none | | none | Not implemented | |
| Unique delegate accounts (E2-2) | `user_account.email` + `user_account_email_lower_key`; `delegate_event_email_lower_key` partial index | migration SQL tail; E3 test in report | `apps/api/src/db/unique-email.test.ts` (4 tests, pass) | Verified (database rule only) | no application flow uses it yet |
| Import registrations with dry run (E2-1) | none | `/api/v1/delegates/import` → 404 | none | Not implemented | |
| Link registration to authenticated delegate (E2-2) | `delegate.user_account_id` nullable FK | schema line 163 | none | Partially implemented (schema only) | |
| Duplicates and email edge cases (E2-3) | `registration_status` enum incl. `duplicate`, `duplicate_of_id`; partial unique index excludes duplicates | report E3 | unique-email tests | Partially implemented (data model only) | detection/admin review absent |
| Access restrictions between delegates (E3-6) | none | no protected routes | none | Not implemented | |
| Mobile usability and validation | shell components (RatingGroup, StickyActionBar, FormSection) at 44 px targets | test report B3/B6 | `rating-group.test.tsx` | Partially implemented (components only) | no forms exist |
| Missing/invalid/expired invitation links (E3-1) | `invitation` table (`token_hash`, `expires_at`, status enum) and `renderInvitation` template | schema 192-209; `apps/api/src/mail/templates/index.ts` | template tests | Partially implemented | no issuance/acceptance route |

### B. Pre-conference assessment (E4, E5, Appendix A1)

| Requirement | Relevant implementation | Evidence | Test evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- | --- |
| Baseline assessment exists (E5-1) | none | no form/question/response tables (report E6) | none | Not implemented | |
| Five knowledge questions, wording and scoring per Appendix A1 (E5-3, A1) | none | | none | Not implemented | OQ-2 (immediate feedback) still open in backlog |
| Confidence questions (E5-4) | none | | none | Not implemented | |
| Persistence, N/A and unanswered handling (E4-5, E5-6) | none | | none | Not implemented | |
| Association with delegate and conference | `event_id` convention on all tables | schema | | Not applicable yet | |
| Repeat submissions, history, question version stored (E4-6) | none | | none | Not implemented | design rule in CLAUDE.md "questions are data, versioned" not yet realised |

### C. Check-ins and session feedback (E6, E7, E8)

| Requirement | Relevant implementation | Evidence | Test evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- | --- |
| Day 1 / Day 2 check-ins (E7) | none | | none | Not implemented | |
| Session identification, QR links (E8-1/2) | none | | none | Not implemented | |
| Required ratings, optional text (E8-3) | `RatingGroup` component | component test | 3 tests | Partially implemented (UI primitive only) | |
| Five-minute window, accessible afterwards (E8-5) | none | | none | Not implemented | |
| Eligibility via attendance (E6, E8-6) | none; mechanism unspecified | | none | Not implemented | **ambiguity**: backlog does not say whether unverified attendees may submit |
| Duplicate prevention, latest response counts (E8-7) | none | | none | Not implemented | |

### D. Individual Transfer Plan (E9, Appendix A5)

| Requirement | Relevant implementation | Evidence | Test evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- | --- |
| 14-field plan, validation, draft Day 1, resume Day 2, submit, versions (E9-1..12) | none; `SaveStatus`, `StepProgress`, `StickyActionBar` components exist | `apps/web/src/components/*` | none | Not implemented | largest single workflow; Increment 4 (Nov 4) |

### E. Reminders and follow-up scheduling (E10, E12)

| Requirement | Relevant implementation | Evidence | Test evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- | --- |
| Delegate reminder preferences (E10-1..6) | none | | none | Not implemented | |
| 30/60/90/180-day follow-ups (E12) | none | | none | Not implemented | |
| Job execution, retries, idempotency (E10-7..12) | pg-boss started, no jobs | `worker.ts` | heartbeat test only | Not implemented | |
| Time zones | `event.timezone` default `Africa/Lagos`; UTC storage | schema 114 | | Partially implemented (data only) | |
| Real provider vs mock | SMTP transport real; nothing schedules sends | `apps/api/src/mail/smtp-mailer.ts` | Mailpit delivery (report H1) | Partially implemented | |

### F. Workplace application and impact (E12, E13, E14, Appendix B)

All items: **Not implemented**. No status enum, history, evidence upload, measures or support
request code exists. Nothing in the codebase computes or overstates impact because nothing
computes anything.

### G. Measurement and reporting (E15, E16, Appendix C)

All items: **Not implemented**. There is no reporting layer, dashboard, export or calculation.
The indicator definitions in `docs/backlog.md:726-746` (paired knowledge change on delegates
with all five answers at both stages, N/A exclusion, "X of Y respondents") are clear enough to
implement; the risk is schedule, not ambiguity.

### H. Roles, access control, privacy, auditability (E3-6, E17)

| Requirement | Relevant implementation | Evidence | Test evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- | --- |
| Roles delegate / admin / analyst / support / speaker | `user_role` enum only | schema 55-63 | none | Partially implemented (enum only) | no enforcement anywhere |
| Server-side authorization | none | no middleware | none | Not implemented | |
| Cross-delegate data access by ID | no data endpoints | report I8/J3 | none | Not applicable yet | must be tested the moment routes exist |
| Session/password/token handling | none | | | Not implemented | |
| Input validation, output encoding | JSON body limit; Zod only in mail config; templates HTML-escape | `app.ts:71`, `templates/layout.ts:escapeHtml` | template test "escapes user-provided text" | Partially implemented | no request schemas |
| Sensitive data in logs (E17-3, CLAUDE.md) | pino scrub hook; Caddy log filter | `logger.ts`, `Caddyfile:51-69`; report F1 re-run | `logger.test.ts` (3), `scrub.test.ts` (4) | Verified (unit + proxy probe) | |
| Secrets management | `.env` ignored; examples only; GitHub secrets documented | report C8 | | Verified | |
| Transport/storage protection | TLS via Caddy, HSTS, CSP; dumps age-encrypted; object copy rclone-crypt | report C5, G2 | | Verified | CSP allows `'unsafe-inline'` scripts (Next without nonces) |
| Export permissions, audit of exports (E16, E17-4) | `audit()` helper and append-only table | `apps/api/src/lib/audit.ts`; report E4 | 5 audit tests | Partially implemented | no exports exist |
| Correction and deletion workflows (E17-5) | none | | | Not implemented | |
| Privacy notice and consent (E3-7, E17-6) | `consent_record` table | schema 211-229 | | Partially implemented (table only) | |
| Sponsor sharing permission (E17) | none | | | Not implemented | |
| Retention and evidence upload controls | none; object storage not used by app | | | Not implemented | |

### I. Reusability for future events (E1, E4, CLAUDE.md rule)

| Requirement | Relevant implementation | Evidence | Status | Risk / gap |
| --- | --- | --- | --- | --- |
| Event configuration in data | `event` table + seed; email branding read from DB (`apps/api/src/mail/branding.ts:54-65`) | report E5 | Partially implemented | web shell reads `apps/web/src/config/event.ts` (code), see F-07 |
| Question/assessment/session configuration, versions | none | | Not implemented | |
| Data separation by event | `event_id` on delegate/categories/audit; partial unique index per event | migration | Partially implemented | no query layer enforces it |
| Report filtering by event/organisation | none | | Not implemented | |
| ITTEC assumptions in reusable logic | only comments and the seed; email templates and footer take branding as parameters | grep (`seed.ts:13-27` is data, others are comments) | Verified for current code | |

### J. Operations and delivery readiness (E0, E17-7, E19)

| Requirement | Evidence | Test evidence | Status | Gap |
| --- | --- | --- | --- | --- |
| Build reproducibility | clean install 1m45s, `pnpm build` ok, pinned images, lockfile frozen in CI and Docker | report A1/A2/C2 | Verified | |
| Migration consistency | migrate deploy twice on fresh DB; `migrate dev` reports no drift | report E1 | Verified | single migration so far |
| Env validation | Zod for mail only | `mail/config.ts:13` | Partially implemented | F-05 |
| Health/readiness | `/health` (liveness), `/ready` (DB `SELECT 1`, 2 s timeout, 503) | `app.ts:74-93`; 9 app tests pass | Verified by unit tests; live probe pending image rebuild | |
| Structured logging, error handling | pino + scrub, JSON errors with request id, no stacks | `logger.test.ts`, `app.test.ts` | Verified by unit tests | |
| Backups and recovery | encrypted dump, retention, failure ping, restore in 9 s with matching counts | report G1-G6 | Verified locally | real provider and clean-server restore untested (G7) |
| CI and coverage | CI green on GitHub (run 40728303711); no coverage reporting | report D2 | Verified (pipeline), coverage unknown | |
| Containers and dependencies | all healthy in 41 s cold start; non-root web/api/worker | report C4/C6 | Verified | caddy, db, garage, backup run as root (expected for those images) |
| Deployment and rollback | scripts shellcheck-clean; staging deploy run fails: environment unconfigured | report D6 | Blocked | P0-8 deferred |
| Monitoring and alerting | `docs/monitoring.md`; heartbeat code; Sentry wiring | unit tests | Implemented, unverified (no external accounts) | |
| Developer setup | README local run; Compose override | followed during the test run | Verified | |
| Runbooks, handover (E0-11, E19) | none | | Not implemented | P0-8 deferred |

## 5. Verification results

Commands run on 2026-10-28 (all non-destructive; database checks used throwaway containers
`tester-pg`/`mbc-dev-pg` and the local Compose stack).

| Command | Result | Proves | Does not prove |
| --- | --- | --- | --- |
| `rm -rf **/node_modules && pnpm install --frozen-lockfile` | ok, 1m45s | lockfile is complete and installable | runtime correctness |
| `pnpm lint` (eslint + prettier) | ok | style and static rules | behaviour |
| `pnpm typecheck` (3 packages, Prisma generate first) | ok | type-level consistency | runtime |
| `pnpm test` with `DATABASE_URL` set to a migrated container | 50 tests pass: shared 7, api 37 (8 files), web 6 | unit behaviour listed in §8; DB constraints; seed idempotence | any business workflow (none exist) |
| `pnpm build` | ok (`next build` compiled; api `tsc`) | production bundles build | business correctness |
| `prisma migrate deploy` ×2 on fresh Postgres 16.15 | applied, then "No pending migrations" | migration is self-contained and idempotent | future migrations |
| Raw SQL as app user `mbc`: duplicate email variants, UPDATE/DELETE/TRUNCATE on `audit_log` | rejected as designed | database rules | application enforcement |
| `docker compose -f deploy/docker-compose.yml config`, `build`, `stop && up -d` | valid; built; all healthy in 41 s | stack assembles | behaviour under load |
| `curl -k https://localhost/api/health`, headers, `/api/v1/*` probes | 200 ok; HSTS/CSP/nosniff present; all feature routes 404 | proxy and headers; feature absence | |
| Personal-data probe through Caddy after log filter | log line has `"uri":"/api/health"`, no headers, IP `172.18.0.0` | proxy log is clean | application logs for routes that do not exist yet |
| `sh deploy/backup/test-local.sh` (3 runs), retention and failure tests | PASS; restore 9 s; counts match; prune 14/8/12; exit 1 + `/fail` ping | backup system locally | real provider, clean-server restore |
| `mail:test` to Mailpit (host and in-network) | `250 2.0.0 Ok` ×2; templates checked via Mailpit API | SMTP transport and templates | deliverability to real mailboxes |
| actionlint (4 workflows), shellcheck (8 scripts) | clean | syntax and common errors | pipeline success |
| `gh run list/view` | CI success; staging deploy failed (empty `APP_DOMAIN`/`DEPLOY_PATH`, ssh exit 255) | pipeline runs for real; deploy blocked by configuration | |
| `pnpm audit --audit-level=high` | 1 low, 0 high/critical | dependency advisories today | |

Not run: any end-to-end workflow test (none exist), real Sentry delivery, real SMTP deliverability,
real off-site backup, load or soak tests. Live probes of the new `/ready`, JSON 404/500 and
heartbeat behaviour were waiting on an image rebuild at the time of writing; the unit tests for
each pass.

## 6. Defects and risks

| ID | Severity | Title |
| --- | --- | --- |
| F-01 | P0 | No delegate-facing or organiser functionality exists (areas A-G) ten days before the pilot target |
| F-02 | P0 | No authentication, session or authorization layer; every future route starts unprotected |
| F-03 | P1 | Staging deployment fails: GitHub `staging` environment has no variables/secrets and no server (P0-8 deferred) |
| F-04 | P1 | No request validation framework or API contract in `packages/shared`; `healthResponseSchema` is the only schema |
| F-05 | P2 | Environment variables are read ad hoc without validation outside the mail module |
| F-06 | P2 | No rate limiting, CSRF or CORS policy in the API; CSP permits `'unsafe-inline'` scripts |
| F-07 | P2 | Event facts duplicated: database (`event` row) vs code (`apps/web/src/config/event.ts`) |
| F-08 | P2 | `updated_at` columns have no database default; raw inserts (support scripts, imports done in SQL) fail unless they set it |
| F-09 | P2 | `is_test` requirement (E0-5) is modelled as `registration_status = 'test'` on delegates only; other tables have no test flag |
| F-10 | P2 | Backup retention is count-based, not age-based; a schedule stall silently keeps stale dumps |
| F-11 | P3 | Nine derived design tokens lack a live-site source (test report B1) |
| F-12 | P3 | Pre-commit auto-fixes formatting instead of rejecting it; only lint errors block |
| F-13 | P3 | Garage is AGPL-3.0; acceptable for unmodified network use but needs a licence note in the handover |
| F-14 | P3 | Observability code (readiness, error handler, Sentry, heartbeat) is unit-tested but has not been exercised in the running stack at audit time |

**F-01 (P0).** Evidence: `apps/api/src/app.ts:74-93` are the only routes; `apps/web/src/app/{signin,account,admin}/page.tsx` render `ComingSoon`; every `/api/v1/*` probe returns 404. Expected: Increment 1 stories E1-1/2, E2-1..5, E3-1..7/9, E17-1..4/6/8 (backlog line 445) delivered by 29 October. Impact: nothing can be demonstrated or piloted. Fix: build the increments in backlog order, starting with E3 (identity) because every other feature depends on a signed-in delegate. Tests needed: end-to-end sign-up → sign-in → protected route; import dry-run and commit; authorization matrix.

**F-02 (P0).** Evidence: grep for session/cookie/jwt/authoriz across `apps/*/src` finds only logging and scrub code; `apps/web/src/lib/session.ts:15-16` returns `null`. Threat: when routes are added without a middleware chain already in place, the first delegate data endpoint will ship open; the backlog requires 403/404 for cross-delegate access (E3-6) and httpOnly/Secure/SameSite sessions (E3-3). Fix: implement E3-3..6 as a single layer (session store in Postgres, magic-link issuance via `invitation`/token tables, `requireRole()` middleware, delegate-scoped repository functions that always filter by `delegate_id`/`event_id`) before any data route. Tests: as delegate A request B's record (403/404), no session (401), role matrix per route.

**F-03 (P1).** Evidence: run 40728303636 job log shows `APP_DOMAIN:` and `DEPLOY_PATH:` empty, ssh exit 255; images were pushed. Fix: provision staging (P0-8), configure the environment, re-run; acceptance: smoke step prints `healthy`.

**F-04 (P1).** Evidence: `packages/shared/src/index.ts` exports one placeholder schema; the API has no request parsing beyond `express.json`. Impact: CLAUDE.md requires server-side Zod validation and shared schemas; without them the Increment 2 forms will validate on the client only. Fix: add `packages/shared/src/schemas/*` per resource with `safeParse` middleware; acceptance: a malformed body to any POST returns `422 validation_failed` with field paths and never reaches Prisma.

**F-05 (P2).** Evidence: `apps/api/src/db.ts:16`, `worker.ts:12-35`, `server.ts:10`. Impact: typos in `.env` surface as runtime exceptions deep in a request. Fix: one `env.ts` with a Zod schema loaded at startup for api and worker; acceptance: starting with an invalid `DATABASE_URL` exits with a single clear message.

**F-06 (P2).** Evidence: `apps/api/package.json` dependencies; `deploy/Caddyfile:26`. Impact: magic-link endpoints need rate limiting (E3-3); state-changing routes need CSRF (E17-1); `'unsafe-inline'` weakens CSP. Fix: `express-rate-limit` keyed by IP and email, SameSite=Strict cookies plus origin check (or double-submit token) for POST, Next.js nonces via middleware when feasible.

**F-07 (P2).** Evidence: `apps/web/src/config/event.ts:53-99` vs `apps/api/src/seed.ts:13-27`. Impact: the rule "no ITTEC-specific constants in code" (CLAUDE.md) is violated by design during Increment 1; dates/venue edited in one place will not change the other. Fix: E1-1 admin event settings plus a `GET /api/v1/events/current` consumed by the web layout; acceptance: changing the venue in the admin UI changes the footer.

**F-08 (P2).** Evidence: migration SQL `"updated_at" TIMESTAMPTZ(3) NOT NULL` ×5 with no default (Prisma `@updatedAt` is client-side). Repro: `INSERT INTO event(slug,name,starts_on,ends_on) VALUES (...)` fails with NOT NULL violation (the audit had to supply `updated_at` manually). Fix: add `DEFAULT now()` in the next migration and a trigger or keep Prisma-only writes.

**F-09 (P2).** Evidence: `apps/api/prisma/schema.prisma:80-87, 172`; E0-5 says "seeded with test data flagged `is_test`". Impact: once responses, plans and follow-ups exist, excluding test data from indicators (Appendix C) needs a flag on each table or a join to delegate. Decision needed from the product owner: per-row `is_test` or derive from `delegate.registration_status`.

**F-10 (P2).** Evidence: `deploy/backup/backup.sh` `prune()` keeps the newest N files; test report G5. Impact: if cron stops, nothing prunes but nothing alerts either beyond Healthchecks (which does alert on missed pings, so the exposure is limited). Fix: optional age-based guard plus the Healthchecks period already documented.

**F-14 (P3).** Evidence: §5. Fix: run the Increment 1 test report F2/F3/F5 probes after the image rebuild (in progress) and keep them in CI as integration tests.

## 7. Requirement gaps and ambiguities

Missing implementation: everything in areas A-G and most of H and I (see §4).

Unclear or undecided requirements (do not implement until answered):

1. **OQ-2** (backlog line 461): immediate right/wrong feedback on knowledge questions inflates paired change. Needs a decision before E5.
2. **Attendance verification for session feedback** (C): the backlog requires "only eligible attendees" in E8-6 but does not state the mechanism when attendance is virtual or unrecorded.
3. **`is_test` placement** (F-09).
4. **Five-minute feedback window** (E8-5): whether it is a soft prompt or a hard cut-off, and what "accessible afterwards" means for editing versus viewing.
5. **Sponsor sharing permission** (E17): which field records consent to share identifiable comments and whether it is per comment or per delegate.
6. **Object storage usage**: the backlog assumes MinIO for evidence uploads (E14-3); Garage is now the target. No application code uses S3 yet, so the switch costs nothing now but should be confirmed.

## 8. Test coverage assessment

Existing tests (50) cover: health and readiness responses, request ids, JSON 404/400/500
shapes without stack traces, log redaction, scrub rules, heartbeat success/failure paths,
Sentry disabled-by-default and event scrubbing, email template links/text/placeholders/escaping,
database uniqueness and append-only rules, seed idempotence and production guard, home page
content and absence of registration links, footer content from config, RatingGroup behaviour.

Critical workflows and rules with **no tests because no implementation exists**: sign-in and
session security, authorization matrix, import dry-run and duplicate handling, assessment
exclusivity rule (E4-7), knowledge scoring and paired change (T7), confidence pairing with N/A
exclusion, Transfer Plan versioning, reminder scheduling idempotency, follow-up stage linking,
application-rate denominator, dashboard counts using latest responses, export permissions and
audit entries. Line coverage is not measured in CI; adding it would not change this picture.

## 9. Pilot-readiness assessment (target 7 November 2026)

Not ready, and the plan is at risk. The backlog schedules Increments 1 to 6 between 29 October
and 7 November; Increment 1 (identity, import, invitations) has not started beyond the data
model, and Increments 2 to 5 contain the entire product (assessment, check-ins, feedback,
Transfer Plan, reminders, follow-ups, dashboard, exports). Critical path: E3 identity and
authorization (F-02) → E1/E2 setup and import → E4/E5 question engine and pre-assessment (must be
live before delegates receive invitations) → E6-E8 for the conference days (12-13 November) →
E9 Transfer Plan (Day 1) → E10/E12 after the conference. Dependencies outside the code: staging
and production servers, DNS and sending domain (E0-12), Healthchecks/Sentry accounts, product
decisions in §7. The foundation work is done well and is not on the critical path.

## 10. Prioritized remediation plan

**Immediate blockers**
1. Provision staging and configure the GitHub environment (F-03). Depends on P0-8. Acceptance: push to `main` ends with the smoke step printing `healthy`.
2. Implement E3-1..7 identity, sessions, roles middleware (F-02). Depends on nothing. Acceptance: authorization tests (401/403/404 matrix) pass in CI; a delegate cannot read another delegate's record by id.
3. Decide OQ-2, attendance eligibility and `is_test` placement (§7). Owner: M.Bryan.

**Required before pilot**
4. E1 event settings and E2 import with dry run and duplicate review (F-01, F-07). Acceptance: the Increment 1 exit test in backlog line 445 passes on staging.
5. Shared Zod request/response schemas and `env.ts` validation (F-04, F-05). Acceptance: every route validates with a shared schema; invalid env fails fast.
6. E4/E5 question engine with versioning and the pre-conference assessment; scoring tests with known fixtures (T7).
7. E6-E8 conference-day flows; E9 Transfer Plan with version history.
8. Rate limiting, CSRF, `updated_at` default (F-06, F-08).
9. E15 dashboard with the Appendix C definitions and fixture-based calculation tests; E16 exports with audit entries.
10. Real off-site backup target and clean-server restore rehearsal (G7); sending-domain DNS and deliverability checklist (H5); Sentry and Healthchecks accounts wired (monitoring checklist).

**Important after pilot**
11. E10 reminder engine refinements, E12 follow-up stages 60/90/180 (the 30-day stage falls after the pilot start anyway).
12. Correction/deletion workflows and sponsor-sharing permissions (E17-5, §7 item 5).

**Future enhancements**
13. CSP nonces instead of `'unsafe-inline'`; coverage reporting; age-based backup guard; per-service `SERVICE_NAME`.

## 11. Final verdict

- **Genuinely implemented:** monorepo and quality gates; branded mobile web shell; foundation
  database schema with audit log and email-uniqueness rules; seed; API skeleton with health,
  readiness, request ids, JSON errors and redacted logging; Sentry and heartbeat wiring; email
  templates and transport; Docker/Caddy stack; encrypted backups with restore; CI and deploy
  scripts; operations documentation.
- **Behaviourally verified:** all of the above except the Sentry/heartbeat/readiness code in the
  running stack (unit-tested only at audit time) and anything requiring external accounts.
- **Incomplete:** every delegate and organiser workflow (areas A-G), authorization and privacy
  controls beyond logging, runbooks and handover.
- **Defective:** no business behaviour is defective because none exists; the confirmed defects
  are the failing staging deploy (configuration), the missing `updated_at` defaults, and the
  code/database duplication of event facts.
- **Cannot yet be verified:** deliverability to real mailboxes, real off-site backup and
  clean-server restore, Sentry delivery, alert routing, production deployment.
- **Before the system can be trusted:** identity and authorization must exist and be tested
  first; then each increment must ship with the fixture-based calculation tests the backlog
  already specifies, and the staging pipeline must run green end to end.
