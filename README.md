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

Passwordless sign-in lives in `apps/api/src/auth` and `apps/api/src/routes`:

- `POST /api/v1/auth/magic-link` emails a single-use link and a 6-digit code to a registered
  delegate (any `registration_status` of valid or test in a non-archived event) or to an active
  staff account. The response is always `202` so addresses cannot be enumerated; unknown,
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
  only their own record; admin, analyst and support read any; admin and support correct records
  with an audit entry; only admins manage staff; speakers see only their own sessions,
  anonymised). State-changing requests must carry an `Origin` matching `APP_URL` or
  `AUTH_ALLOWED_ORIGINS`.
- Only hashes of tokens, codes and session identifiers are stored; audit rows record who, when
  and a hashed IP, never a token or an email address.

Web: `/signin` (email, then code entry), `/signin/verify?token=…` (the emailed link; the token is
exchanged with a POST so mail scanners cannot consume it), `/account` (gated). In development the
Next dev server proxies `/api/*` to the API when `API_PROXY_URL` is set; behind Caddy the same
path works without a proxy.
