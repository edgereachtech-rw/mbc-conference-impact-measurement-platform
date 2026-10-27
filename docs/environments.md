# Environments

Two long-lived environments exist (backlog E0-5). They run the same Docker Compose stack
(`deploy/docker-compose.yml`), the same image tags, and differ only in where they run and in their
configuration.

| Aspect            | Staging                                                     | Production                                                  |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Purpose           | Verify every commit on `main` before it reaches delegates    | The live platform used by ITTEC 2026 delegates              |
| Deploys           | Automatic on every push to `main` (`deploy-staging.yml`)    | Manual `deploy-production.yml` run with an image tag, after reviewer approval |
| Image tag         | Commit SHA of the push                                      | A commit SHA that already ran on staging                    |
| Server            | Own VPS (or at least its own Compose project and directory) | Own VPS                                                     |
| Subdomain         | `staging.<domain>`                                          | `<domain>` (the public hostname delegates receive)          |
| Database          | Own PostgreSQL instance and `pgdata` volume                 | Own PostgreSQL instance and `pgdata` volume                 |
| Object storage    | Own bucket and keys                                         | Own bucket and keys                                         |
| Credentials       | Separate `.env`: database password, S3 keys, `SESSION_SECRET`, SMTP, Garage secrets | Separate `.env`; nothing is shared with staging |
| Email             | Real SMTP relay, but only to internal test addresses        | Real SMTP relay to delegates                                |
| Error tracking    | Sentry project or environment tag `staging`                 | Sentry environment `production`                             |
| Backups           | Daily, short retention                                      | Daily, hourly on 12-13 November 2026, off-site, long retention |
| Seed data         | Seeded with test delegates, sessions and responses flagged `is_test = true` | Never seeded with test data; `is_test` rows are not allowed |
| Uptime monitoring | Optional                                                    | Required (sign-in page, one form URL, worker heartbeat)     |

## Separation rules

- Never point a staging `.env` at the production database, bucket or SMTP credentials, and never
  the reverse. A staging value that works in production is a leak, not a convenience.
- `SESSION_SECRET` differs per environment so a staging session cookie is meaningless on
  production.
- Staging and production use different Healthchecks.io checks, so a failing staging backup does
  not look like a production outage.
- The same migration files run in both; staging runs them first, automatically. Production runs
  them only through the one-off command in the deploy script.

## Test data and `is_test`

Every record that belongs to an event can carry `is_test`. Staging is seeded with test delegates
and responses marked `is_test = true` so the full journey (sign-in, assessments, follow-ups,
dashboards, exports) can be exercised. Dashboards and exports exclude `is_test` rows by default.
Production is never seeded; if a rehearsal on production is unavoidable, the rehearsal records
must be created with `is_test = true` and deleted before go-live on 7 November 2026.

## Promotion flow

1. Merge to `main`. CI runs lint, type-check, tests and build.
2. `deploy-staging.yml` builds `web` and `api` images tagged with the commit SHA, pushes them to
   GHCR, deploys them to staging, runs migrations, and smoke-tests `/api/health`.
3. Check staging (the change itself, a form submission, the dashboard).
4. Run `deploy-production.yml` with that commit SHA. A required reviewer approves the
   `production` environment; the workflow verifies the images exist and the commit is on `main`,
   then deploys.
5. If something is wrong, roll back: `sh deploy/scripts/rollback.sh <previous-sha>` on the server,
   or run `deploy-production.yml` again with the previous SHA.

## Conference window (12-13 November 2026)

Production is frozen except for hot fixes approved by M.Bryan. Any hot fix still goes through
staging first. Backups run hourly during the two days.
