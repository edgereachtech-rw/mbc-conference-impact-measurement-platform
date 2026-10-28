# Monitoring and alerts

Backlog E0-6 (error tracking, structured logs), E0-8 (uptime and server alerts), E0-9 (worker
heartbeat), E0-7 (backup heartbeat). Everything below is external to the VPS so an outage of the
server itself is still noticed. Alerts go to the on-call phone (SMS or push) and the dev-team
channel; the named primary and backup contacts live in the runbook (E0-11).

## What the platform exposes

| Signal | Where | Meaning |
| --- | --- | --- |
| `GET /api/health` | through Caddy, public | API process is up (liveness); does not touch the database |
| `GET /api/ready` | through Caddy, public | API can serve: `200 {status:"ok", checks:{database:"ok"}}` or `503 {status:"error", checks:{database:"down"}}` |
| `GET /` and `/signin` | through Caddy, public | Web app renders |
| Container healthchecks | `docker compose ps` | api (`/health`), web (`/`), worker (process), db (`pg_isready`), garage (`garage status`), backup (`crond`) |
| JSON logs | `docker compose logs <service>` | pino (api, worker) with request ids; Caddy access log without query strings, headers or full IPs; rotated 5 x 10 MB per service |
| Sentry events | Sentry project | Unhandled errors from web, api and worker, scrubbed of personal data, tagged with `service` and the image SHA as release |
| Worker heartbeat | Healthchecks.io | One ping every `HEARTBEAT_INTERVAL_SECONDS` (120) while the worker runs |
| Backup heartbeat | Healthchecks.io | `/start`, success or `/fail` on every backup run |

## External checks to configure

### 1. Uptime (UptimeRobot, Better Stack or Healthchecks.io "ping" checks)

| Check | URL | Interval | Alert when |
| --- | --- | --- | --- |
| Sign-in page | `https://<APP_DOMAIN>/signin` | 1 min | not HTTP 200 or no body text "Sign in" for 2 consecutive checks |
| API readiness | `https://<APP_DOMAIN>/api/ready` | 1 min | not HTTP 200 for 2 consecutive checks (database down or API down) |
| One form URL | the Day 1 check-in URL once E7 exists | 1 min, conference days only | not HTTP 200 |
| TLS certificate | `https://<APP_DOMAIN>` | daily | expires in fewer than 14 days (Caddy renews at 30 days, so this fires only if renewal is broken) |

Keep both the staging and the production domains monitored, with the staging alerts going to the
dev channel only.

### 2. Healthchecks.io

| Check | Period | Grace | Source |
| --- | --- | --- | --- |
| `worker-heartbeat` | 2 min (= `HEARTBEAT_INTERVAL_SECONDS`) | 5 min | worker pings `HEALTHCHECKS_WORKER_URL`; alert if missed for 5 minutes (E0-9) |
| `backup-nightly` | 24 h | 1 h | `backup.sh` pings `HEALTHCHECKS_BACKUP_URL`; a `/fail` ping alerts immediately |
| `backup-hourly` (12-13 Nov) | 1 h | 15 min | switch the check (or its period) when `BACKUP_MODE=hourly` is set |

A failed job in the worker (E0-8 "failed-job alert") is reported two ways once jobs exist: pg-boss
failures are logged at error level and sent to Sentry (rule below), and a job that fails three
times moves to the dead-letter queue; the worker will ping `HEALTHCHECKS_WORKER_URL/fail` in that
case so the same check alerts.

### 3. Sentry alert rules

Project with three services tagged `web`, `api`, `worker`; environment `staging` or
`production`; release = image SHA.

| Rule | Condition | Action |
| --- | --- | --- |
| New issue in production | first seen, environment = production | notify dev channel immediately |
| Error burst | more than 20 events in 5 minutes in production | page on-call |
| Worker job failures | tag `service:worker`, any event | notify dev channel; page if more than 5 in 10 minutes |
| Sign-in anomalies (E17) | message matches `signin.` and level warning, more than 50 in 10 minutes | notify dev channel (possible abuse) |
| Regression | resolved issue reappears in a newer release | notify dev channel |

Personal data never reaches Sentry: `sendDefaultPii` is off and every event passes the shared
scrubber (`scrubEventPayload`) which removes emails, names, tokens, cookies, query strings and
request bodies and keeps only a user id.

### 4. Server resources (E0-8)

Install the provider's agent (Hetzner, DigitalOcean, or Netdata/Grafana Cloud agent) on the VPS:

| Metric | Warning | Critical | Note |
| --- | --- | --- | --- |
| CPU (5 min average) | 80% | 85% for 10 min | Next.js build is not run on the server, so sustained load means traffic or a runaway job |
| Memory | 80% | 85% | containers have limits (`deploy.resources.limits`); a service at its limit gets OOM-killed and restarts, which shows in `docker compose ps` |
| Disk | 80% | 85% | Docker images and Postgres grow; `docker system prune -f` reclaims images, never volumes |
| Container restarts | any restart of db, api, caddy in 10 min | 3 restarts | `docker events` or the agent's Docker integration |

### 5. Log review

`docker compose logs --since 24h api worker | grep -E '"level":(50|60)'` once a day during the
conference window, plus the Caddy log for 5xx counts:
`docker compose logs --since 1h caddy | grep -c '"status":5'`.

## Response

- Any page: follow the runbook (E0-11): site down, queue/scheduler stopped, data problem/restore.
- Readiness 503 while health is 200: the database is down or unreachable; check
  `docker compose ps db` and the Postgres log; do not restart api blindly.
- Missed worker heartbeat with api healthy: `docker compose logs worker`, then
  `docker compose restart worker`.
- Backup `/fail`: read `docker compose logs backup`; a failed upload is usually credentials or the
  off-site bucket; re-run `docker compose run --rm backup /backup/backup.sh` after fixing.

## Checklist before go-live (7 November 2026)

- [ ] Uptime checks for `/signin` and `/api/ready` on production, alerting the on-call phone
- [ ] TLS expiry check
- [ ] Healthchecks.io: worker (2 min / 5 min grace) and backup (24 h / 1 h) checks created; URLs in `deploy/.env`
- [ ] Sentry DSN set on web, api and worker; a test error visible with release = deployed SHA; the five rules above enabled
- [ ] Server agent alerts at 80/85% CPU, memory, disk
- [ ] Alert routing tested end to end (one test page received on the phone)
- [ ] Switch to hourly backups and the hourly Healthchecks period scheduled for 11 November evening
