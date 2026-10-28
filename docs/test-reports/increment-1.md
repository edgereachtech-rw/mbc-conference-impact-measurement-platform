# Increment 1 test report

Independent test run on 2026-10-28 (commit `51a61d5` plus the uncommitted working tree) on the
developer laptop (Windows 11, Docker Desktop 29.8, Node 24.19, pnpm 10.18). Every check below was
executed; evidence lines are quoted from real command output. Screenshots are in
`docs/test-reports/screenshots/`. No application code, configuration or tests were changed.

## 1. Results

| ID | Check | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Clean `pnpm install` | PASS | node_modules deleted (0 left), `pnpm install --frozen-lockfile` → "Done in 1m 45.1s", exit 0 |
| A2 | lint, typecheck, test, build | PASS | all four exit 0; tests 3 + 22 + 6 passed, `next build` compiled |
| A3 | Workspaces exist; web and api import the same Zod schema from shared | FAIL | `apps/web`, `apps/api` (worker at `apps/api/src/worker.ts`), `packages/shared` exist, but `grep "from '@mbc/shared'" apps/web/src` returns nothing; only api imports `APP_NAME`, and `healthResponseSchema` is used only by an api test |
| A4 | GET /health → `{status:"ok", time}` | PASS | inside api container: `{"status":"ok","time":"2026-10-28T16:49:47.016Z"}` |
| A5 | Worker logs "worker ready" | PASS | `docker compose logs worker` → "Conference Impact Measurement Platform worker ready" |
| A6 | .nvmrc, Prettier, ESLint, Husky hook reject a bad file | PASS | files present, `core.hooksPath=.husky/_`; commit of a file with an unused variable → "husky - pre-commit script failed (code 1)", HEAD unchanged. Note: a file that is only badly formatted is auto-fixed by lint-staged (`export const tidy = 1;`) rather than rejected |
| B1 | design-tokens.md lists hex values with a source each | FAIL | 27 hex values; 20 brand tokens have a live-site or logo source, but 9 are "Derived" without a site source: primary-strong `#001D42`, secondary-strong `#6F1616`, success `#2E7A3B`, warning-text `#7A4F00`, danger `#B42318`, footer `#061D3F`, footer-foreground `#D9DFE8`, footer-muted `#9FB0C8`, muted `#5B6672` (site uses `#555`) |
| B2 | Logos are real images | PASS | `file`: ittec2026.png 160x81 RGBA, logo-white.png 334x169, mbryan-logo.png 203x103; no placeholders. Note: 160px source is upscaled in the 512px PWA icon |
| B3 | Screenshots at 360/768/1280; no horizontal scroll; header logos; footer content | PASS | 12 screenshots saved; all routes HTTP 200; `scrollWidth` 360/768/1280 = viewport (no horizontal scroll); header has 2 logo images; footer contains venue, dates, contact email and "Copyright © 2026 M.Bryan Consulting." (rendered uppercase by CSS) |
| B4 | Event text from `config/event.ts` matches | PASS | `shortName: 'ITTEC 2026'`, dates `display: '12-13 November 2026'`, venue `Lagos Oriental Hotel`, `Victoria Island`, `Lagos`, format label `Hybrid Conference`; footer/hero render these values |
| B5 | WCAG contrast of text/background and button pairs | PASS | 24 pairs in use computed from `globals.css`: lowest text pair 5.18:1 (muted on surface), buttons 9.21:1 (red) and 14.07:1 (navy), input border 3.46:1 ≥ 3:1. Two token pairs fail but are not used for text: white on amber 1.75:1 (amber always carries navy text), logo green on white 4.18:1 (decorative) |
| B6 | Tap targets ≥ 44px at 360px | PASS | Playwright scan of every a/button/input on /, /signin, /account, /admin at 360px: "small targets: none" |
| B7 | manifest.webmanifest valid and served | PASS | HTTP 200 `application/manifest+json`, name "ITTEC 2026", display standalone, theme_color #002a5e, 3 icons all HTTP 200 image/png |
| B8 | Reusable components exist | PASS | `sticky-action-bar.tsx`, `save-status.tsx`, `step-progress.tsx`, `rating-group.tsx`, `form-section.tsx`, `empty-state.tsx`, `error-state.tsx` (+ page-container, section-heading) |
| C1 | `docker compose -f deploy/docker-compose.yml config` valid | PASS | `config --quiet` → "config valid: yes" |
| C2 | No `:latest` or unpinned image | PASS | images: caddy:2.11.7-alpine, postgres:16.15-alpine3.23, dxflrs/garage:v2.5.0, node:24.22.1-alpine3.23, axllent/mailpit:v1.32.0; grep for `:latest`/unpinned → none |
| C3 | Only caddy publishes ports | PASS | config JSON: caddy `80->80 443->443 443/udp`; api, backup, db, garage, web, worker `ports: (none)` (expose only); `docker compose ps` shows published ports on caddy alone |
| C4 | build succeeds; `up -d` healthy within 3 min | PENDING | see note under failures if still pending at publication |
| C5 | Through Caddy: / 200, /api/health ok, security headers | PASS | `GET / -> HTTP 200`; `/api/health` → `{"status":"ok",...}`; headers present: Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Content-Security-Policy, X-Frame-Options |
| C6 | Containers non-root | PASS | `id` in web, api, worker → `uid=1000(node) gid=1000(node)` |
| C7 | Named volumes, log rotation, memory limits | PASS | volumes mbc-impact_pgdata, caddy_data, caddy_config, garagemeta, garagedata (object storage is Garage, so `miniodata` is `garagemeta`+`garagedata`); every service: json-file max-size 10m max-file 5; memory limits 256M–1G |
| C8 | .env.example complete; no secrets in repo or history | FAIL | missing from `deploy/.env.example`: `MAIL_EVENT_NAME` (code fallback), `MAILPIT_HOST`/`MAILPIT_PORT` (dev), `PORT`. Secret scan of tree and `git log -p --all`: no private keys, cloud keys, tokens or non-placeholder passwords; only `.env.example` files are tracked; `deploy/.env` (ignored) holds locally generated values |
| C9 | Migrations not run on container start | PASS | api CMD `node dist/server.js`; `grep migrate docker-compose.yml apps/api/Dockerfile` → only comments; migrations run via `deploy.sh` one-off `prisma migrate deploy` |
| C10 | MinIO image tag and licence status | PASS | MinIO is not used: `hub.docker.com/v2/repositories/minio/minio` → HTTP 404 (repository removed), quay.io → 401; stack uses `dxflrs/garage:v2.5.0`, licence AGPL-3.0 (see flag below) |
| D1 | actionlint clean | PASS | `rhysd/actionlint:1.7.12` on 4 workflows → exit 0 |
| D2 | ci.yml runs lint, typecheck, test with Postgres, build | PASS | steps "Lint", "Type-check", "Validate Prisma schema and apply migrations", "Test", "Build"; `services.postgres` postgres:16.15-alpine3.23; real run 40728303711 succeeded in 1m17s |
| D3 | staging tags with SHA, one-off migration, smoke test fails job; production manual + approval environment | PASS | tags `…:${{ github.sha }}`; `deploy.sh` runs `prisma migrate deploy` via `run --rm`; smoke test `*'"status":"ok"'*` else `exit 1`; production `workflow_dispatch` with `environment: production` |
| D4 | rollback.sh passes shellcheck, takes a tag | PASS | shellcheck exit 0; without argument → "usage: rollback.sh <previous_image_tag>", exit 1 |
| D5 | Secrets and environments documented; none printed | PASS | deploy/README.md documents SSH_HOST/USER/KEY/KNOWN_HOSTS, GHCR_PULL_TOKEN, vars APP_DOMAIN/DEPLOY_PATH/GHCR_PULL_USER; grep for `echo ${{ secrets` → none; staging run log shows "token over stdin, never printed" |
| D6 | A push to main deploys to staging | FAIL | real run 40728303636: web, api and backup images built and pushed to GHCR; job "Deploy … to staging" failed at "Check out the matching commit on the server and deploy", exit 255; log shows `APP_DOMAIN:` and `DEPLOY_PATH:` empty → staging environment variables/secrets and server are not configured (server provisioning is P0-8, deferred) |
| E1 | `prisma migrate deploy` on a new Postgres, twice | PASS | fresh `postgres:16.15-alpine3.23` on 5434: run 1 "All migrations have been successfully applied", run 2 "No pending migrations to apply" |
| E2 | Tables, columns, indexes | PASS | tables: event, participation_category, user_account, delegate, invitation, consent_record, audit_log (+ _prisma_migrations); 26 indexes incl. `delegate_event_email_lower_key`, `user_account_email_lower_key`; full column list in section 7 |
| E3 | Unique email rule | PASS | as app user `mbc`: second `ada@example.com` in same event → `duplicate key value violates unique constraint "delegate_event_email_lower_key"`; same email in another event → inserted; after marking the first `duplicate`, `ADA@example.com` inserted again |
| E4 | audit_log UPDATE/DELETE rejected | PASS | as `mbc`: UPDATE → "audit_log is append-only: UPDATE is not allowed"; DELETE and TRUNCATE rejected the same way |
| E5 | Seed twice, correct event, categories, admin, test delegates | PASS | two runs; counts: events 1, categories 2 (physical, virtual), admins 1 (`tester-admin@example.com`), test delegates 10 of 10; event `2026-11-12`–`2026-11-13`, `Africa/Lagos`, "Lagos Oriental Hotel, Victoria Island, Lagos, Nigeria", hybrid, active; `NODE_ENV=production` → "refusing to seed test delegates" |
| E6 | No form/question/response tables | PASS | table list contains none of them |
| F1 | Personal data redacted from logs | FAIL | probe `GET /api/health?email=pii-tester@example.com&name=…` with Authorization, Cookie and X-Name headers: api/worker/web logs contain nothing (api has no request logger); Caddy access log records the full `uri` with the email and the `X-Name` header verbatim (Authorization/Cookie are "REDACTED") |
| F2 | /health ok with DB down; /ready reflects DB | NOT BUILT | with `db` stopped `/api/health` still `{"status":"ok"}` HTTP 200; `/api/ready` → HTTP 404 both with DB down and up; no `/ready` route in code |
| F3 | Unhandled error → `{error:{code,message,requestId}}` | NOT BUILT | unknown route and malformed JSON return Express default HTML pages (`<pre>Cannot GET …</pre>`, `<pre>Bad Request</pre>`); no stack trace; no error middleware or requestId in `apps/api/src` |
| F4 | Sentry off when DSN unset; beforeSend scrubs | NOT BUILT | no `@sentry/*` dependency or `beforeSend` in apps/packages; app starts without `SENTRY_DSN` (it is unused) |
| F5 | Worker heartbeat to HEALTHCHECKS_WORKER_URL | NOT BUILT | `worker.ts` has 0 references to `HEALTHCHECKS_WORKER_URL`; compose passes the variable but nothing reads it |
| F6 | docs/monitoring.md lists alerts | NOT BUILT | `ls docs/monitoring.md` → No such file |
| G1 | Documented end-to-end backup against the local stack | PASS | `sh backup/test-local.sh` → "PASS: backup, off-site upload, encrypted object copy and restore all verified", wall time 1m38s; off-site target is a second Garage (MinIO images are unavailable) |
| G2 | Uploaded dump is encrypted | PASS | raw object starts with `age-encryption.org/v1`; `pg_restore --list` → "input file does not appear to be a valid archive"; `grep test-delegate-01@example.com` → 0; `strings | grep -ci delegate` → 0 |
| G3 | restore.sh into restore_test with run-time key; counts match; time | PASS | fresh key pair, backup then restore with `BACKUP_AGE_IDENTITY` supplied at run time: user_account 1/1, delegate 10/10, audit_log 3/3 match; restore wall time 9 s |
| G4 | Failure → non-zero exit and failure ping | PASS | wrong S3 secret: "backup: FAILED with exit code 1", listener received `/check-g4a/start` then `/check-g4a/fail` (success run received `/start` then plain URL); corrupted newest object → `restore.sh --latest` "decryption failed", exit 1 |
| G5 | Retention 14 daily / 8 weekly / 12 monthly | PASS | seeded 25 daily, 10 weekly, 14 monthly objects → after one run 14/8/12 (oldest pruned, e.g. `pruned db/monthly/…20221020…`). Note: retention is count-based (newest N kept), equivalent to days/weeks/months when the schedule runs as configured |
| G6 | BACKUP_MODE=hourly; nothing hard-coded | PASS | hourly container crontab `0 * * * * /backup/backup.sh` and log "mode=hourly schedule='0 * * * *' TZ=Africa/Lagos"; grep of backup scripts for URLs, key ids, age keys, bucket literals → none |
| G7 | Real off-site provider; restore on a clean server | NOT VERIFIED | needs a provider account and a second server; see manual checks |
| H1 | `mail:test` delivers to Mailpit | PASS | from host: "provider response: 250 2.0.0 Ok: queued as 2Y5171bbqP7Gw2EnkBZtef, accepted: 1"; inside Docker network with the api image: queued as 3Bwso2JOtiALYiFV78XpSx; messages visible in Mailpit (`email-inbox.png`) |
| H2 | Templates render with brand tokens, absolute links, text part, no placeholders | PASS | for invitation, magic-link, test-delivery via Mailpit API: links 3 each, non-absolute 0, text part 722–1040 chars, placeholders false, `#002A5E` and `#8B1C1C` present, logo from `/brand/logo-white.png`; screenshots `email-*-light/dark.png` |
| H3 | Template tests pass without sending | PASS | `vitest run src/mail` → 8 passed with no SMTP variables; tests use `MemoryMailer` only |
| H4 | email-setup.md has SPF, DKIM, DMARC and checklist | PASS | sections "SPF", "DKIM", "DMARC" (`p=none` then `p=quarantine`), "Bounce and complaint handling", "Manual deliverability checklist" (11 steps) |
| H5 | Delivery to Gmail, Outlook, corporate, iCloud | NOT VERIFIED | needs real mailboxes and the authenticated sending domain |
| I1 | E1-1/E1-2 event + categories viewable/editable by admin | NOT BUILT | `/admin` renders "Coming soon"; `/api/v1/events` → 404; only route in api is `/health` |
| I2 | E2-1 CSV import with dry run | NOT BUILT | `/api/v1/delegates/import` → 404; no import code |
| I3 | E2-3/E2-5 duplicate review and valid counts | NOT BUILT | database flags exist (`registration_status`, `duplicate_of_id`) but no UI or API |
| I4 | E2-4/E17-4 edit delegate with audit | NOT BUILT | `audit()` helper and append-only table exist (E4 PASS); no delegate edit route |
| I5 | E3-1 invitation link lifecycle | NOT BUILT | invitation table and template exist; no send/accept route (`/api/v1/auth/*` → 404) |
| I6 | E3-2 sign-up linked to registration; no enumeration | NOT BUILT | `/signin` renders "Coming soon" |
| I7 | E3-3/4/5 magic link, expiry, rate limit, cookie flags | NOT BUILT | `/api/v1/auth/magic-link` → 404 |
| I8 | E3-6 roles per route; cross-delegate access 403/404; 401 without session | NOT BUILT | no protected routes exist; route table: `GET /health`, `GET /api/health` only |
| I9 | E3-7/E17-6 privacy consent recorded | NOT BUILT | `consent_record` table exists; no sign-up flow |
| I10 | E3-9 staff accounts create/deactivate | NOT BUILT | `user_account.status` exists; no admin UI or route |
| I11 | E17-1 CSRF and input validation | NOT BUILT | no state-changing routes; malformed JSON to `/api/health` returns Express default "Bad Request" HTML |
| J1 | `pnpm audit` high/critical | PASS | "1 vulnerabilities found, Severity: 1 low", exit 0 |
| J2 | Logs/error responses free of personal data | FAIL | api, worker, web and backup logs: 0 lines with test personal data; Caddy access log: 1 line containing the F1 probe email and name (same root cause as F1) |
| J3 | No endpoint returns another delegate's data | NOT BUILT | no data endpoints exist (see I8) |

C4 note: the image rebuild plus timed cold start was still running at the time of writing; the
result is appended in section 7 if it completed, otherwise it is NOT VERIFIED (build timed out
over 10 minutes on this laptop because the dependency layer rebuilt after a lockfile change).

## 2. Totals

| Status | Count |
| --- | --- |
| PASS | 43 |
| FAIL | 6 |
| NOT BUILT | 17 |
| NOT VERIFIED | 2 (+ C4 if pending) |
| SKIPPED | P0-8 |

## 3. Failures

**A3 (minor).** The web app no longer imports anything from `packages/shared`; the shared Zod
schema (`healthResponseSchema`) is consumed only by an API test. Likely cause: the app shell
replaced the `APP_NAME` import with `apps/web/src/config/event.ts`. Look at
`apps/web/src/app/layout.tsx` and `packages/shared/src/index.ts`. Not blocking for the demo, but
the E0-1 acceptance criterion ("shared Zod schemas imported by both apps") is not met until
Increment 2 forms use shared schemas.

**B1 (minor).** Nine tokens in `docs/design-tokens.md` are marked "Derived" (hover shades,
success/warning/danger states, footer shades, muted text) and have no live-site or logo source.
They are documented with a rationale (WCAG contrast), but the brief forbids inventing palette
colours. Likely cause: the site has no state colours to copy. Look at `docs/design-tokens.md`
"Colours" table. Resolution: design-owner sign-off on the derived set, or replace with site values
and re-run the contrast check.

**C8 (minor).** `deploy/.env.example` omits `MAIL_EVENT_NAME`, `MAILPIT_HOST`, `MAILPIT_PORT`
and `PORT`, all read by code or compose. Likely cause: variables added with the mail module and the
dev override without updating the server example. Look at `apps/api/src/mail/branding.ts`,
`apps/api/src/mail/config.ts`, `deploy/.env.example`. No secrets were found anywhere.

**D6 (major, blocked by P0-8).** The real push to `main` built and pushed all three images to
GHCR but the staging deploy failed in 3 s: the job log shows `APP_DOMAIN` and `DEPLOY_PATH` empty
and SSH exit 255. Likely cause: the `staging` GitHub environment has no variables or secrets and
no server exists yet (server provisioning is deferred). Look at GitHub → Settings → Environments
→ staging, and `.github/workflows/deploy.yml`. The workflow mechanics up to SSH are correct.

**F1 (major).** Personal data in logs: Caddy's access log stores the full request URI, so an
email address in a query string, and any custom header, is written to the log. Authorization and
Cookie are redacted by Caddy's default. The API itself logs nothing per request today, so the
exposure is limited to the proxy log, but the rule "never log personal data" is violated as soon
as a form or sign-in link carries data in the URL. Look at `deploy/Caddyfile` (`log` block) and
add request-field filtering (Caddy `log { format filter { request>uri query … } }`) or drop query
strings; and give the API a redacting logger before any route takes personal data (F-section
work).

**J2 (minor, same cause as F1).** One Caddy log line from the probe contains the test email and
name. Application logs are clean.

## 4. Manual checks needed

1. **D6 staging deploy.** Create the `staging` environment in GitHub with variables `APP_DOMAIN`,
   `DEPLOY_PATH`, `GHCR_PULL_USER` and secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY`,
   `SSH_KNOWN_HOSTS`, `GHCR_PULL_TOKEN`; provision the staging server (P0-8); push to `main` (or
   re-run run 40728303636) and confirm the "Smoke test from outside the server" step prints
   `healthy: {"status":"ok"…}`. Then open `https://<staging domain>/api/health`.
2. **D6 production approval.** Run "Deploy to production" with the staging SHA and confirm the
   job pauses for a reviewer and refuses a SHA that is not on `main`.
3. **G7 real off-site.** Create the Backblaze/R2/S3 bucket and a write-only key, put them in
   `deploy/.env`, run `docker compose -f docker-compose.yml run --rm backup /backup/backup.sh`,
   confirm the object appears in the provider console and that Healthchecks.io shows the ping.
4. **G7 clean-server restore.** On a fresh server follow `docs/backup-and-recovery.md` step 5
   ("Whole server lost") with the age private key from the password manager; record the elapsed
   time against the 2-hour RTO.
5. **H5 deliverability.** After SPF/DKIM/DMARC are live, run the 11-step checklist in
   `docs/email-setup.md` against Gmail, Outlook, a corporate mailbox and an iCloud address; record
   inbox-versus-spam and header results.
6. **F4 Sentry.** Once Sentry is integrated, set a DSN on staging, raise a test error and confirm
   the event arrives with email/name scrubbed.
7. **C4 (if still pending).** From `deploy/`, run `docker compose -f docker-compose.yml build`
   then `docker compose -f docker-compose.yml stop && time docker compose -f docker-compose.yml up -d`
   and confirm `docker compose ps` shows every healthchecked service healthy within 3 minutes.

## 5. Verdict

**Not ready for the Increment 1 demo.** The foundation is in good shape and verified by real
commands: clean install and all quality gates pass, the branded mobile shell renders without
horizontal scroll with compliant contrast and tap targets, the Docker stack publishes only Caddy's
ports with hardened headers, migrations and the append-only audit log behave correctly, backups
encrypt, upload, prune and restore in under ten seconds, and email renders and delivers to the
development inbox. What blocks the demo is that none of the Increment 1 application features
exist yet: every E1, E2, E3 and E17 story (I1–I11) is NOT BUILT, so there is nothing for an admin
to set up, no import, no invitation or sign-in, no roles to test. Two further items need attention
before staging can be shown: the staging deployment fails because the GitHub environment and
server are not configured (D6), and the proxy log records query strings and custom headers,
which will hold personal data once sign-in links and forms exist (F1). The observability stories
(F2–F6) are absent and should be scheduled alongside the feature work.

P0-8 (server provisioning, runbook, go-live checklist): SKIPPED, deferred.
