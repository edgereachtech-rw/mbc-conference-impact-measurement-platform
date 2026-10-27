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
