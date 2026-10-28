# Deployment

Everything runs with Docker Compose on one VPS (backlog E0-2, E0-4, E0-10). The same files serve
local development (with `docker-compose.override.yml`), staging and production.

| Service | Image                     | Role                                                                                         |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| caddy   | caddy:2.11.7-alpine       | TLS, HTTP to HTTPS redirect, `/api/*` to api, rest to web. Only service with published ports |
| web     | built from apps/web       | Next.js standalone server on 3000                                                            |
| api     | built from apps/api       | Express API on 4000                                                                          |
| worker  | same image as api         | pg-boss job runner (`node dist/worker.js`)                                                   |
| db      | postgres:16.15-alpine3.23 | PostgreSQL 16, volume `pgdata`                                                               |
| garage  | dxflrs/garage:v2.5.0      | S3-compatible object storage, volumes `garagemeta`, `garagedata`                             |
| backup  | postgres:16.15-alpine3.23 | Placeholder until E0-7 (encrypted off-site backups)                                          |
| mailpit | axllent/mailpit:v1.32.0   | Development only: catches outgoing email                                                     |

Why Garage and not MinIO: MinIO's Docker images are no longer published (the `minio/minio`
repository was removed from Docker Hub and quay.io has no tags, checked 2026-10-28). Garage is
AGPL-licensed, actively released and speaks the same S3 API. The applications only see the `S3_*`
variables, so an external bucket (Hetzner Object Storage, Backblaze B2, AWS S3) is a `.env`
change plus deleting the `garage` service.

Never run `docker compose down -v` on a server. It deletes the named volumes and with them the
database, the uploaded files and the TLS certificates.

## Local run (laptop)

Prerequisites: Docker Desktop (or Docker Engine 24+ with the Compose plugin).

```bash
cd deploy
cp .env.example .env          # defaults work locally; secrets can stay as placeholders
docker compose up -d          # merges docker-compose.override.yml automatically
docker compose ps             # wait until api, db, garage, web are "healthy"
curl http://localhost/api/health
```

What the override gives you:

- http://localhost through Caddy (plain HTTP, no certificates), http://127.0.0.1:3000 (web) and
  http://127.0.0.1:4000 (api) directly
- hot reload: the repository is bind-mounted; `web` runs `next dev`, `api` runs `tsx watch`,
  `worker` runs `tsx watch src/worker.ts`. Dependencies are installed once by the `deps` service
  into Docker volumes, so your host `node_modules` is untouched
- PostgreSQL on 127.0.0.1:5432, Garage S3 on 127.0.0.1:3900
- Mailpit inbox at http://127.0.0.1:8025; api and worker send mail to it

First start takes a few minutes (dependency install plus the first Next.js compile). On Windows
and macOS the file watchers use polling, so a change can take a second or two to show.

Object storage needs one bootstrap after the first start (creates the layout, key and bucket):

```bash
sh scripts/garage-init.sh
```

To run the production images locally instead of the dev servers:

```bash
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d
curl -k https://localhost/api/health     # Caddy issues a local certificate for "localhost"
```

## Staging and production: first-time setup

Staging and production are identical stacks on separate servers (or at least separate
`deploy/` directories, databases, domains and credentials, backlog E0-5).

1. Server (Ubuntu LTS, backlog E0-10): SSH keys only, `ufw` allowing 22, 80, 443, Fail2ban,
   unattended security updates, a non-root deploy user in the `docker` group. Install Docker
   Engine and the Compose plugin from Docker's repository.
2. DNS: an A (and AAAA) record for `APP_DOMAIN` pointing at the server. Caddy obtains the
   certificate on first request; port 80 must be reachable for the ACME challenge.
3. Clone the repository and create the environment file:
   ```bash
   git clone <repo> /srv/mbc-impact && cd /srv/mbc-impact/deploy
   cp .env.example .env && chmod 600 .env
   # fill every value; generate secrets with: openssl rand -hex 32
   ```
4. Build (or pull CI-built images, see E0-3) and start:
   ```bash
   docker compose -f docker-compose.yml build
   docker compose -f docker-compose.yml up -d
   docker compose -f docker-compose.yml ps
   ```
5. Initialise object storage (once):
   ```bash
   sh scripts/garage-init.sh
   ```
6. Apply database migrations (see below), then open `https://APP_DOMAIN/api/health` and the
   home page.

Always pass `-f docker-compose.yml` on servers so the development override is never merged.
Alternatively set `COMPOSE_FILE=docker-compose.yml` in `.env`.

## Migrations: one-off command, never on container start

The api image contains the Prisma CLI, the schema and `prisma/migrations`. Containers never run
migrations automatically. Run them deliberately, after the new image is built and before the new
api/worker containers start serving:

```bash
docker compose -f docker-compose.yml run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy
```

`--no-deps` reuses the running database. The command uses `DATABASE_URL` from `.env` through
`prisma.config.ts`. Check the result with `docker compose -f docker-compose.yml run --rm --no-deps api ./node_modules/.bin/prisma migrate status`.

## Update (deploy a new version)

```bash
cd /srv/mbc-impact && git pull
cd deploy
docker compose -f docker-compose.yml build                    # or: IMAGE_TAG=<commit> docker compose pull
docker compose -f docker-compose.yml run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy
docker compose -f docker-compose.yml up -d                    # recreates only changed containers
docker compose -f docker-compose.yml ps
curl -fsS https://$APP_DOMAIN/api/health
```

Images are tagged `IMAGE_PREFIX/web:IMAGE_TAG` and `IMAGE_PREFIX/api:IMAGE_TAG`. Use the git
commit as `IMAGE_TAG` (CI does this in E0-3) so every running version is identifiable.

## Rollback

Rollback is redeploying the previous image tag:

```bash
IMAGE_TAG=<previous-commit> docker compose -f docker-compose.yml up -d web api worker
```

If the release included a migration that the previous code cannot run against, restore the
database from the last backup first (E0-7 runbook) or write a down migration. Keep migrations
additive during the conference window so rollback never needs a restore.

## Everyday operations

```bash
docker compose -f docker-compose.yml logs -f --tail=200 api     # logs (json-file, rotated 5 x 10 MB)
docker compose -f docker-compose.yml restart worker
docker compose -f docker-compose.yml exec db psql -U "$DB_USER" "$DB_NAME"
docker compose -f docker-compose.yml exec garage /garage status
docker system prune -f                                           # old images only; volumes are kept
```

Memory limits per service are set in `docker-compose.yml` (`deploy.resources.limits`). Watch
`docker stats` after go-live and raise a limit before a service gets OOM-killed.

## CI/CD (GitHub Actions)

| Workflow                                  | Trigger                                       | What it does                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                | every push and pull request                   | `pnpm install` (cached), lint, type-check, Prisma validate + migrate on a PostgreSQL 16 service, test, build                                            |
| `.github/workflows/deploy-staging.yml`    | push to `main`                                | builds `web` and `api` images tagged with the commit SHA, pushes to GHCR, then calls `deploy.yml` for staging                                           |
| `.github/workflows/deploy-production.yml` | manual (`workflow_dispatch`) with `image_tag` | verifies the tag is on `main` and both images exist, then calls `deploy.yml` for production after reviewer approval                                     |
| `.github/workflows/deploy.yml`            | called by the two above                       | SSH to the server, `git checkout <tag>`, `deploy/scripts/deploy.sh <tag>` (pull, migrate one-off, up, smoke test), external smoke test, logs on failure |

Images: `ghcr.io/<owner>/<repo>/web:<sha>` and `ghcr.io/<owner>/<repo>/api:<sha>` (lowercase). The
`:main` tag always points at the latest staging build; deployments only ever use the SHA tag.

### GitHub environments

Create two environments under Settings > Environments: `staging` and `production`. On
`production`, enable **Required reviewers** (at least one person from M.Bryan or the dev lead) and
restrict deployments to the `main` branch. Each environment holds its own variables and secrets:

| Kind     | Name              | Value                                                                                                                               |
| -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| variable | `APP_DOMAIN`      | public hostname, e.g. `staging.impact.example.com` / `impact.example.com`                                                           |
| variable | `DEPLOY_PATH`     | repository checkout on the server, e.g. `/srv/mbc-impact`                                                                           |
| variable | `GHCR_PULL_USER`  | GitHub username that owns the pull token                                                                                            |
| secret   | `SSH_HOST`        | server hostname or IP                                                                                                               |
| secret   | `SSH_USER`        | deploy user on the server (member of the `docker` group, not root)                                                                  |
| secret   | `SSH_KEY`         | private key (ed25519) whose public key is in the deploy user's `~/.ssh/authorized_keys`                                             |
| secret   | `SSH_KNOWN_HOSTS` | output of `ssh-keyscan -H <host>` so the runner verifies the server's host key                                                      |
| secret   | `GHCR_PULL_TOKEN` | classic PAT with `read:packages`, used once per deploy to `docker login ghcr.io` on the server. Optional if the packages are public |

Pushing images uses the workflow's own `GITHUB_TOKEN` (`packages: write`); no extra secret.
After the first push, open the package on GitHub, link it to the repository and keep it private.

Secrets are never printed: the SSH key is written to a file with mode 600 and deleted at the end of
the job, the GHCR token travels over the SSH session's stdin, and `deploy.sh` prints image names
and health output only.

### Server preparation for CI deploys

```bash
# as the deploy user on the server
git clone <repo> /srv/mbc-impact && cd /srv/mbc-impact/deploy
cp .env.example .env && chmod 600 .env     # fill in; set IMAGE_PREFIX=ghcr.io/<owner>/<repo>
sh scripts/garage-init.sh                  # after the first `docker compose -f docker-compose.yml up -d db garage`
```

The workflow then performs `git fetch && git checkout <sha>` in `DEPLOY_PATH` so the Compose files
on the server always match the images being deployed.

### Rollback

```bash
sh deploy/scripts/rollback.sh <previous-sha>
```

This re-runs `deploy.sh` with the previous tag and skips migrations. Equivalent from GitHub: run
`deploy-production.yml` with the previous SHA (that path does run `migrate deploy`, which is a
no-op when the schema is already current).

## Seeding

The seed is idempotent and runs inside the api image (no tsx needed):

```bash
# staging: ADMIN_EMAIL set and SEED_TEST_DELEGATES=true in .env
docker compose -f docker-compose.yml run --rm --no-deps api node dist/seed.js
```

It creates the ITTEC 2026 event, the physical and virtual participation categories, the admin
account for `ADMIN_EMAIL`, and on staging ten delegates flagged `registration_status = test`.
The test delegates are refused when `NODE_ENV=production`, so running the same command on
production only ensures the event, categories and admin.

## Backups

The `backup` service (image from `deploy/backup/`) dumps PostgreSQL with `pg_dump`, encrypts the
dump with `age` to `BACKUP_AGE_PUBLIC_KEY`, uploads it with `rclone` to the off-site bucket
(`BACKUP_S3_*`) and syncs the object bucket to an encrypted copy. Schedule: 02:00 Africa/Lagos, or
hourly with `BACKUP_MODE=hourly`. Retention 14 daily / 8 weekly / 12 monthly (48 hourly).
Every run pings `HEALTHCHECKS_BACKUP_URL`.

```bash
docker compose -f docker-compose.yml run --rm backup /backup/backup.sh            # run now
docker compose -f docker-compose.yml run --rm backup /backup/restore.sh --list    # what exists
sh backup/test-local.sh                                                           # local end-to-end test
```

Restore procedure, key custody and the pre-go-live checklist: [docs/backup-and-recovery.md](../docs/backup-and-recovery.md).
