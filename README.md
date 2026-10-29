# M.Bryan Conference Impact Measurement Platform

A platform that follows each conference delegate from a pre-conference baseline, through the
conference days (check-ins, session feedback, Transfer Planning), to 30/60/90/180-day follow-ups,
so M.Bryan can measure what delegates actually applied after the event.

First pilot: ITTEC 2026, 12-13 November 2026, Lagos (hybrid). Production go-live: 7 November 2026.
The platform is event-agnostic: every record belongs to an event and event-specific values live in
the database, not in code, so future M.Bryan events reuse it.

The product backlog in [docs/backlog.md](docs/backlog.md) is the source of truth for stories,
acceptance criteria and the question bank. Engineering rules live in [CLAUDE.md](CLAUDE.md).

## Stack

- TypeScript everywhere, Node.js 24 LTS, pnpm workspaces
- `apps/web`: Next.js (App Router) + Tailwind CSS, built with `output: "standalone"`
- `apps/api`: Express 5 REST API (`/api/v1` from the next increment) with Zod validation and Prisma
- Worker: pg-boss job runner, shipped as a second entry point of `apps/api` (see below)
- `packages/shared`: Zod schemas, types and definitions shared by web, api and worker
- PostgreSQL 16, MinIO, SMTP relay, Caddy, Docker Compose (deployment arrives in a later increment)

## Prerequisites

- Node.js 24 (see `.nvmrc`; `nvm use` picks it up)
- pnpm 10 (`npm install -g pnpm@10.18.3`, or `corepack enable pnpm` where permitted)
- PostgreSQL 16 only when you run the worker or Prisma migrations. The API, the web app and all
  current tests run without a database.

## Running locally

```bash
pnpm install          # installs all workspaces, builds packages/shared, installs git hooks
cp .env.example .env  # then set DATABASE_URL to the compose database (DB_* values in deploy/.env)
cp .env apps/api/.env && cp .env apps/web/.env  # each app loads the .env in its own folder
pnpm dev              # runs shared (tsc --watch), api (tsx watch) and web (next dev) in parallel
```

| URL                          | What                                       |
| ---------------------------- | ------------------------------------------ |
| http://localhost:3000        | Web app (Next.js)                          |
| http://localhost:4000/health | API health check: `{ status: "ok", time }` |

To run the worker (needs PostgreSQL reachable at `DATABASE_URL`):

```bash
pnpm --filter @mbc/api dev:worker   # logs "Conference Impact Measurement Platform worker ready"
```

### Quality checks

```bash
pnpm lint        # ESLint + Prettier check across the repo
pnpm typecheck   # tsc --noEmit in every workspace (web first runs `next typegen`)
pnpm test        # Vitest in every workspace
pnpm build       # shared -> api (tsc) and web (next build, standalone output)
```

A Husky pre-commit hook runs lint-staged (ESLint fix + Prettier) on staged files.

### Database (Prisma 7)

Prisma lives in `apps/api`. The connection string comes from `DATABASE_URL`, read by
[apps/api/prisma.config.ts](apps/api/prisma.config.ts); without it `prisma generate` still works
but any command that connects fails. The generated client is written to `apps/api/src/generated`
(git-ignored) by `prisma generate`, which the api `build`, `typecheck` and `test` scripts run first.

```bash
pnpm --filter @mbc/api db:migrate   # prisma migrate dev: create and apply migrations locally
pnpm --filter @mbc/api db:deploy    # prisma migrate deploy: apply committed migrations (CI, servers)
pnpm --filter @mbc/api db:seed      # idempotent: ITTEC 2026 event, categories, ADMIN_EMAIL admin,
                                    # plus 10 test delegates when SEED_TEST_DELEGATES=true
```

Identity migration gate (Increment 1b, backlog D6.1 and D9): `pnpm --filter @mbc/api identity:backfill --dry-run`
classifies every registration and delegate account, verifies invariants H1 to H5 and rolls back
without writing a report; without `--dry-run` it commits and then writes one durable
`migration.identity_backfill` audit row (counts and ids only, exit code 0 only for a reported pass).
Runs are serialised by an advisory lock and numbered by `identity_backfill_run_seq`; the import
gate reads the report of the highest run number and stays closed while any run has no report.
Run it with the API stopped (sign-ins during a run fail H5). Imports stay disabled in this increment.

Database tests (`apps/api/src/db/*.test.ts` and `src/seed.test.ts`) run only when `DATABASE_URL`
points at a migrated database; otherwise they are skipped. Quick local database:

```bash
docker run -d --name mbc-dev-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mbc_impact_test \
  -p 127.0.0.1:5433:5432 postgres:16.15-alpine3.23
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/mbc_impact_test
pnpm --filter @mbc/api db:deploy && pnpm test
```

Schema conventions: UUID keys from `gen_random_uuid()`, snake_case tables, timestamps in UTC.
Three rules live as SQL inside the migration because the Prisma schema language cannot express
them: case-insensitive unique emails on `user_account`, one email per event for delegates not
marked `duplicate`, and the trigger that makes `audit_log` append-only. Services write audit rows
with `audit()` from [apps/api/src/lib/audit.ts](apps/api/src/lib/audit.ts) inside the same
transaction as the change they describe.

### Email

Outgoing mail goes through `apps/api/src/mail`: a `Mailer` interface, the Nodemailer SMTP
implementation (relay on servers, Mailpit locally with `MAIL_TRANSPORT=mailpit`) and an
in-memory mailer for tests. Templates (`invitation`, `magic-link`, `test-delivery`) share one
layout that renders HTML and plain text from the same content, using the brand tokens.

```bash
pnpm mail:test you@example.com                       # sends the delivery test, prints the SMTP response
pnpm mail:test you@example.com --template invitation
pnpm email:screenshots                               # renders what is in Mailpit to docs/screenshots/
```

DNS records, relay configuration, bounce handling and the deliverability checklist are in
[docs/email-setup.md](docs/email-setup.md).

## Folder map

```
.
├── apps/
│   ├── api/                  Express API + worker (one package, two entry points)
│   │   ├── prisma/schema.prisma
│   │   ├── prisma.config.ts  Prisma 7 config: schema path, migrations path, DATABASE_URL
│   │   └── src/
│   │       ├── app.ts        createApp(): Express app without a bound port (used by tests)
│   │       ├── server.ts     API entry point: listens on PORT (default 4000)
│   │       └── worker.ts     Worker entry point: boots pg-boss and logs "worker ready"
│   └── web/                  Next.js App Router app (mobile-first)
│       └── src/app/          layout.tsx, page.tsx, globals.css, page.test.tsx
├── packages/
│   └── shared/               @mbc/shared: Zod schemas, types, APP_NAME (built to dist/)
├── docs/                     Backlog and workplan (source of truth)
├── eslint.config.mjs         Single flat ESLint config for all workspaces
├── tsconfig.base.json        Shared compiler options; each workspace extends it
├── pnpm-workspace.yaml       Workspace globs and allowed dependency build scripts
└── .env.example              Documented environment variables (never commit .env)
```

## Design notes

**Why the worker lives inside `apps/api`.** The backlog describes the worker as "same codebase/image
as api". Keeping it as a second entry point (`src/worker.ts` next to `src/server.ts`) means one
`package.json`, one `tsconfig`, one Prisma client, one test suite and, later, one Dockerfile whose
command is either `node dist/server.js` or `node dist/worker.js`. A separate `apps/worker` package
would duplicate all of that for no benefit while the worker only shares code with the API.

**Why `packages/shared` is built to `dist/`.** The API is compiled with plain `tsc` to run on Node
without a bundler, so it consumes shared as ordinary compiled ESM with type declarations. A
`postinstall` script builds shared once after `pnpm install`, `pnpm build` rebuilds it first
(pnpm runs workspace scripts in dependency order) and `pnpm dev` keeps it rebuilding with
`tsc --watch`.

**Version choices.** TypeScript stays on 5.9 because typescript-eslint does not yet support the
7.x line. Prisma is pinned to 7.10.1 because 8 is still a release candidate. ESLint 10 is in use;
the Next.js ESLint plugins declare peer support only up to ESLint 9 but run correctly, so pnpm
prints peer warnings at install time that can be ignored until those plugins update.

## Design foundation (apps/web)

The web app carries the ITTEC brand extracted from the live conference website. The full token
table, contrast results and asset notes are in [docs/design-tokens.md](docs/design-tokens.md).

- Tokens live in `apps/web/src/app/globals.css` as `--brand-*` CSS variables, exposed to Tailwind
  (`bg-brand-primary`, `shadow-card`, `min-h-tap`, ...) and mapped onto the shadcn/ui variables.
- Fonts: Poppins (body, headings) and Oswald (buttons, labels, hero) via `next/font`.
- shadcn/ui components are in `apps/web/src/components/ui` (Base UI primitives, 44px tap targets).
  Add more with `pnpm dlx shadcn@4.23.0 add <name>` from `apps/web`, then re-check sizes.
- App shell: `components/layout/site-header.tsx` and `site-footer.tsx`; event facts come from
  `apps/web/src/config/event.ts` until E1 moves them to the database.
- Reusable building blocks in `apps/web/src/components`: PageContainer, SectionHeading,
  FormSection, StickyActionBar, SaveStatus, StepProgress, RatingGroup, EmptyState, ErrorState.
- PWA: `app/manifest.ts` serves `/manifest.webmanifest`; icons are generated from the logo in
  `public/icons`.
- Screenshots: `pnpm build && pnpm screenshots` writes 360/768/1280px captures of `/`, `/signin`,
  `/account` and `/admin` to `docs/screenshots/`.

## Authentication and access control (Increment 1)

There is no public registration: delegate records come only from registration files an admin
imports per event (backlog E2, design note after E3), and a person keeps one platform identity
across events. Sign-in is for those imported identities and for staff accounts created by an admin.
Registration imports carry registration data only; attendance is recorded inside the platform as
its own workflow and is never derived from an imported file.
The import, identity linking and the delegate "My Events" view are the next increments (backlog
D10); the sign-in flow below is what Increment 1 delivered. A delegate who changes email contacts
the M.Bryan admin, who verifies the request under a policy still to be approved (backlog OQ-29),
updates the existing identity, revokes its sessions and outstanding links, and audits the change
(backlog E2-12); no new identity is created and the new address must verify before it signs in.

Passwordless sign-in lives in `apps/api/src/auth` and `apps/api/src/routes`:

- `POST /api/v1/auth/magic-link` emails a single-use link and a 6-digit code to a registered
  delegate (`registration_status` active in a non-archived event) or to an active staff account.
  The Increment 1 code also accepts `test` registrations; the requirements (backlog OQ-27, decided
  2026-10-29) confine that to development and staging, so Increment 1b removes it for production. The response is always `202` so addresses cannot be enumerated; unknown,
  cancelled and inactive addresses receive nothing. Rate limits (code defaults): 3 requests per
  email per 15 minutes; 10 link requests and 20 failed verifications per client address per hour.
  Production values are set in `deploy/.env` (`AUTH_RATE_LIMIT_PER_IP`, `AUTH_VERIFY_LIMIT_PER_IP`)
  and remain conditional on the confirmed venue headcount and network layout, because physical
  delegates share the venue's egress address; see the sizing note in `deploy/.env.example`.
- `POST /api/v1/auth/verify` takes `{ token }` or `{ email, code }`, consumes the token once
  (expiry `MAGIC_LINK_TTL_MINUTES`, default 15), links the registration to the account on first
  use, and sets the `mbc_session` cookie (HttpOnly, SameSite=Lax, Secure outside development,
  host-only, `SESSION_TTL_DAYS` absolute and `SESSION_IDLE_DAYS` idle lifetime).
- `GET /api/v1/auth/me` returns the signed-in user; `POST /api/v1/auth/sign-out` revokes the
  server-side session. Deactivating an account revokes all of its sessions.
- Authorization is server-side: `requireAuth`, `requireRole(...)` and `requireDelegate` in
  `apps/api/src/auth/middleware.ts`, with the pure rules in `auth/policies.ts` (delegates read
  only the records of their own identity; admins read any and correct records with an audit
  entry; only admins manage staff and create `admin` or `speaker` accounts; speakers see only
  their own sessions, anonymised). The `analyst` and `support` roles are retired (backlog D8
  item 7): an account still carrying one cannot request a link, cannot verify, holds no usable
  session (`/auth/me` answers 401) and cannot be assigned; the enum values remain until no
  account carries them, and the identity backfill report lists such accounts. State-changing
  requests must carry an `Origin` matching `APP_URL` or `AUTH_ALLOWED_ORIGINS`.
- Eligibility is identity-based (backlog D8 items 1 to 4): a link or code is issued, and a
  verification succeeds, only when the address is the _current_ address of a platform identity
  that holds a registration with status active in a non-archived event (or the address belongs to
  an active staff account). Historical and provisional addresses never authenticate, even with a
  link issued before the change. Registrations with status `test` qualify only with
  `AUTH_ALLOW_TEST_REGISTRATIONS=true`, which production refuses to start with. The first
  verification links the account to the identity once; later events need no sign-in action, and
  `signed_up_at` is set per event record on the first sign-in while that record exists. The
  session principal carries the identity and every eligible record it owns, so a delegate can
  read only those. Run the identity backfill before this version serves an existing database.
- Only hashes of tokens, codes and session identifiers are stored; sign-in audit rows record who,
  when and a hashed IP, never a token or an email address.

Web: `/signin` (email, then code entry), `/signin/verify?token=…` (the emailed link; the token is
exchanged with a POST so mail scanners cannot consume it), `/account` (gated). In development the
Next dev server proxies `/api/*` to the API when `API_PROXY_URL` is set; behind Caddy the same
path works without a proxy.

## My Events, invitations and delegate accounts (Increments 1b and 1c)

- `GET /api/v1/me/events` and `GET /api/v1/me/events/:eventId` (backlog E3-10, D7): the events
  with a registration linked to the session's identity, resolved on the server, ordered upcoming
  first (soonest first) then past (most recent first); each carries the caller's own registration
  (status, attendance format, capacity, organisation, job title, country, first sign-in) and
  `attendance: not_recorded` until an attendance record exists (E6). Another identity's event id
  answers 404, staff accounts 403, an unlinked delegate account an empty list. Pending OQ-25,
  cancelled registrations and archived events are left out (`MY_EVENTS_VISIBILITY` in
  `apps/api/src/routes/me-events.ts`). `/account` renders this list.
- `POST /api/v1/events/:eventId/invitations` (E3-1, admin only; body `{ delegateIds? }`): sends
  the invitation email to every eligible registration of the event (or the listed ones) with a
  single-use link `/signin?invite=<token>` that pre-fills the email on the normal sign-in page;
  resending revokes the earlier link; the first sign-in marks the invitation accepted;
  `invitation.sent` / `invitation.send_failed` are audited without addresses. Requires
  `INVITATION_TTL_DAYS`. `GET /api/v1/auth/invitations/:token` resolves a link for the sign-in page
  without consuming it.
- `PATCH /api/v1/delegate-accounts/:accountId` (E2-13, admin only; body `{ status, reason }`):
  deactivation revokes every session at once, reactivation only clears the status; success writes
  `identity.account_status_changed`, a refusal (unknown or staff account, no change)
  `identity.account_status_refused`, a failure after acceptance `identity.account_status_failed`.
- `PATCH /api/v1/delegates/:id` (E2-4, E2-5) now also accepts `capacity` and `registrationStatus`
  (`active`, `pending` or `cancelled`; `duplicate` and `test` are never set this way; pending cannot
  sign in and is hidden from My Events), audited with old and new
  values.

## Messages to delegates (Increment 1b, backlog E2-14)

Admin-only emails to selected registrations of an event, from the event page
(`/admin/events/:eventId`): tick delegates in the table (or the whole page, then "Select all N
matching" to extend to every registration matching the status filter and search), choose Send
email, write the subject and body, preview, confirm.

- Body format is a small markdown subset rendered by `packages/shared/src/message-body.ts` for
  the email HTML, the plain-text part and the on-screen preview alike: `**bold**`, `*italic*`,
  `#`/`##` headings, `-` and `1.` lists, `[label](https://…)` links (http(s) and mailto only),
  blank line between paragraphs. Placeholders `{{firstName}}`, `{{name}}`, `{{email}}`,
  `{{organisation}}` and `{{eventName}}` are filled per recipient in the subject and the body;
  an unknown placeholder is refused. Everything is escaped before markup is added.
- `POST /api/v1/events/:eventId/messages` (body `{ subject, body, recipients }` where
  `recipients` is `{ delegateIds }` or `{ filter: { status?, attendanceFormat?, q? } }`): refuses
  archived events (409), registrations of other events or merged duplicates (404), a duplicate
  filter, an empty audience or more than 2,000 recipients (422); sends one branded email per
  distinct address through the configured mailer; answers `{ messageId, total, sent, failed,
skipped }` (201). Rows: `delegate_message` (subject, body, selection used, counts, status
  `sent` / `partially_failed` / `failed`) and `delegate_message_recipient` (per-recipient
  status, provider message id). Audit: `message.sent` with counts and the selection kind,
  `message.send_failed` per failed recipient; never an address.
- `GET /api/v1/events/:eventId/messages` lists the event's messages (newest first, who sent them);
  `GET /api/v1/events/:eventId/messages/:messageId` adds the body and the per-recipient outcome.
  The event page shows both under Messages.
- Sending runs inside the request (like invitations). A few hundred recipients take seconds over
  SMTP; the worker queue takes over when the reminder engine (E10-8) introduces jobs.

## Registration imports (Increment 1b)

Admin-only CSV/XLSX import of an event's registrations (backlog E2-1, E2-8 to E2-11; design note
D3 to D9). Every route is under `/api/v1`, requires an `admin` session, and is refused for every
other role, delegates and anonymous callers. Nothing in a file is executed: CSV is read with a
strict RFC 4180 reader, XLSX cells are read as values only (formula cells contribute their cached
result), and the original file is not retained (parsed rows live in `import_row`).

- `POST /events/:eventId/imports` (multipart `file` + `source`): parses the file (10 MB, 5,000
  rows, `.csv` or `.xlsx`; `.xls` and larger files are refused with split guidance), stores the
  rows, and returns the headers, a suggested mapping, the attendance-record columns that are always
  ignored, and the saved mapping for the source when its headers match exactly.
- `POST /imports/:runId/preview` (mapping, optional run-wide `attendanceFormatDefault`,
  `saveMapping`): validates the mapping, normalises every row, classifies it (accepted, updated,
  updated with no change, linked to an existing identity, duplicate in file, rejected, conflict with
  a reason code) and stores the preview with a fingerprint of the file, the mapping and the matched
  records. Nothing else is written. A preview expires after 30 minutes.
- `POST /imports/:runId/confirm`: inside one transaction serialised per event and per address, it
  re-runs validation and matching, refuses with `preview_out_of_date` or `preview_expired` when
  anything differs, and otherwise creates identities and current addresses, creates or updates
  registrations, quarantines conflicts (which create and change nothing), and writes
  `import.committed` plus one `identity.created`, `identity.linked`, `delegate.imported` or
  `delegate.updated_by_import` per changed record. A failure rolls everything back and writes
  `import.commit_failed`; confirming an already committed run returns the same result and changes
  nothing. Imports never change an email, never merge identities on names, and never create or
  infer attendance.
- `POST /imports/:runId/discard`, `GET /events/:eventId/imports` (history),
  `GET /imports/:runId[?outcome=…]` (rows), `GET /imports/:runId/report.csv` (audited download,
  formula-like cells neutralised), `GET /events/:eventId/imports/conflicts` (open conflict queue),
  `GET /imports/status`.

Conflict resolution (D5): `POST /imports/rows/:rowId/resolve` with one of `link_existing`
(needs `identityId` and `samePerson: true`), `create_identity` (needs `differentPerson: true`),
`reject` or `correct_source`. The server re-reads the row, the event, the ownership of the address
and the event's registrations under a per-row and per-address lock, applies only an action valid
for the conflict reason and the ownership rule, and writes `import.conflict_resolved` inside the
transaction; a refusal answers 409 with a reason category and writes `import.resolution_refused`,
a failure after acceptance writes `import.resolution_failed`. Linking an unowned address reserves
it to the identity as history (admin decision), never as a sign-in address; creating a person gives
the new identity a current address by admin decision. Repeating the same decision is idempotent.

Admin screen: `/admin/imports` (linked from `/admin`) walks through event and file, column mapping,
preview and confirmation, and lists past runs, their rows, the CSV report and open conflicts. The
page renders only for an admin session; the API authorises every request on its own.

Configuration: `IMPORT_UPLOADS_ENABLED=true` is required to accept uploads anywhere. In production
the startup validation also requires `IMPORT_FILE_RETENTION_DAYS` from the approved retention
policy (OQ-22), and every upload and confirmation additionally requires a passing identity
migration gate; a refused upload writes `import.upload_refused`. Not in this increment: the admin
screen, the retention job for original files
(OQ-22), source-specific header synonyms (OQ-20), and the parsing-strategy decision record (OQ-23;
parsing is synchronous within the request under the decided limits).
