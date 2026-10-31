# Backup and recovery

Backlog E0-7 (daily encrypted off-site backups, hourly on conference days, heartbeat) and E17-7
(documented process, restore tested end to end before go-live).

## Targets

| Measure                      | Normal operation           | Conference window (12-13 Nov 2026) |
| ---------------------------- | -------------------------- | ---------------------------------- |
| RPO (maximum data loss)      | 24 hours (nightly at 02:00 Africa/Lagos) | 1 hour (`BACKUP_MODE=hourly`) |
| RTO (time to be back)        | 2 hours from the decision to restore | 2 hours                     |
| Retention                    | 14 daily, 8 weekly (Sundays), 12 monthly (1st) and, in hourly mode, 48 hourly |
| Off-site location            | S3-compatible bucket at a different provider and account from the primary storage |
| Verification                 | Restore test before go-live and after every schema change, using the steps below |

What is backed up:

- **PostgreSQL** (`DB_NAME`): `pg_dump` custom format, compressed, encrypted with `age` to the
  public key in `BACKUP_AGE_PUBLIC_KEY` before it is written anywhere, uploaded to
  `db/<tier>/<database>-<UTC timestamp>.dump.age`.
- **Object storage** (uploads, exports): `rclone sync` of the application bucket to
  `objects/` in the off-site bucket, encrypted at rest with an rclone `crypt` remote
  (`BACKUP_RCLONE_CRYPT_PASSWORD`). File names are encrypted too.
- The Compose files and migrations are in git; `deploy/.env` is not backed up by this
  job and must be kept in the password manager (see below).

What is not: TLS certificates (they belong to the terminator in front of the server), container
logs, the pg-boss queue
(jobs are re-created from the database state).

## Where the keys are kept (never on the server)

| Secret                         | Where                                            | Who                      |
| ------------------------------ | ------------------------------------------------ | ------------------------ |
| age **private** key            | Password manager (shared vault "ITTEC platform"), plus one printed copy in the M.Bryan safe | Dev lead and M.Bryan operations lead |
| age public key                 | `deploy/.env` (`BACKUP_AGE_PUBLIC_KEY`)           | Anyone; it only encrypts |
| rclone crypt passphrase        | Password manager, same vault                      | Same two people          |
| Off-site bucket credentials    | `deploy/.env` on the server and in the vault      | Write-capable key on the server; a separate read-only key in the vault for restores from elsewhere |
| `deploy/.env` (whole file)     | Password manager, updated whenever it changes     | Dev lead                 |

Generate the key pair on a laptop, not on the server:

```bash
age-keygen -o ittec-backup.key      # prints "Public key: age1..."
# put the public key in deploy/.env as BACKUP_AGE_PUBLIC_KEY
# store ittec-backup.key in the password manager, then delete the local file
```

The server can therefore produce backups but can never read them. A compromised server does not
expose the backup history.

## How it runs

The `backup` service (image built from `deploy/backup/`) runs busybox `crond` in the container
timezone `Africa/Lagos`:

| `BACKUP_MODE` | Schedule           | Tiers written                                   |
| ------------- | ------------------ | ----------------------------------------------- |
| `nightly`     | `0 2 * * *`        | daily; plus weekly on Sundays, monthly on the 1st |
| `hourly`      | `0 * * * *`        | hourly; the 02:00 run also writes daily/weekly/monthly |

Switch modes by editing `BACKUP_MODE` in `deploy/.env` and running
`docker compose -f docker-compose.yml up -d backup`. Plan: set `hourly` on 11 November 2026 in the
evening, set `nightly` again on 14 November.

Every run pings Healthchecks.io (`HEALTHCHECKS_BACKUP_URL`): `/start` first, the plain URL on
success, `/fail` on any error. Configure the check with a 24 h period (1 h in hourly mode) and a
1 h grace time so a missed or failed backup alerts the on-call phone.

Run one by hand:

```bash
cd /srv/mbc-impact/deploy
docker compose -f docker-compose.yml run --rm backup /backup/backup.sh
docker compose -f docker-compose.yml logs --tail=50 backup   # scheduled runs
```

Logs show file names, sizes and counts only, never data.

## Restore, step by step

Decide first: are we restoring the whole database (disaster) or looking up something in a
scratch copy (data problem)? The scratch copy is always the first step; it is also the restore
test.

### 1. Restore into the scratch database `restore_test`

On the server, with the age private key fetched from the password manager into a temporary file:

```bash
cd /srv/mbc-impact/deploy
umask 077 && cat > /tmp/age.key          # paste the AGE-SECRET-KEY-1... line, then Ctrl-D

# list what is available (tiers: hourly, daily, weekly, monthly)
docker compose -f docker-compose.yml run --rm backup /backup/restore.sh --list --tier daily

# newest daily dump -> restore_test, with a comparison against the live database
docker compose -f docker-compose.yml run --rm -v /tmp/age.key:/run/age.key:ro backup \
  /backup/restore.sh --latest --tier daily --identity /run/age.key

# or a specific dump
docker compose -f docker-compose.yml run --rm -v /tmp/age.key:/run/age.key:ro backup \
  /backup/restore.sh --name mbc_impact-20261112T010000Z.dump.age --tier hourly --identity /run/age.key

shred -u /tmp/age.key
```

`restore.sh` downloads, decrypts, drops and recreates `restore_test`, runs `pg_restore`, then
prints row counts for `user_account`, `delegate`, `audit_log`, `event`, `participation_category`,
`invitation`, `consent_record` and the migration table, live versus restored, and checks that the
`audit_log` append-only trigger exists in the restore. Differences are normal when the live
database has changed since the dump; they tell you what would be lost.

Inspect the copy: `docker compose -f docker-compose.yml exec db psql -U "$DB_USER" restore_test`.

### 2. Data problem: repair from the scratch copy

Prefer copying the affected rows from `restore_test` into the live database over a full restore,
so nothing recorded since the backup is lost. Every correction is written through the application
or with an `audit_log` row explaining it.

### 3. Disaster: replace the live database

Only after a go/no-go decision by the dev lead with M.Bryan informed (expected data loss = time
since the dump).

```bash
cd /srv/mbc-impact/deploy
docker compose -f docker-compose.yml stop api worker web           # stop writers and the site
docker compose -f docker-compose.yml run --rm -v /tmp/age.key:/run/age.key:ro backup \
  /backup/restore.sh --latest --tier hourly --identity /run/age.key   # verified scratch copy first
docker compose -f docker-compose.yml exec db psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME';" -c \
  "ALTER DATABASE \"$DB_NAME\" RENAME TO \"${DB_NAME}_broken_$(date +%Y%m%d%H%M)\";" -c \
  "ALTER DATABASE restore_test RENAME TO \"$DB_NAME\";"
docker compose -f docker-compose.yml run --rm --no-deps api ./node_modules/.bin/prisma migrate status
docker compose -f docker-compose.yml up -d api worker web
curl -fsS https://$APP_DOMAIN/api/health
```

Keep the renamed broken database until the incident review is done, then drop it.

### 4. Object storage

```bash
docker compose -f docker-compose.yml run --rm backup sh -c \
  '. /backup/remotes.sh && rclone sync offsitecrypt: "source:$S3_BUCKET" --dry-run'   # review
docker compose -f docker-compose.yml run --rm backup sh -c \
  '. /backup/remotes.sh && rclone sync offsitecrypt: "source:$S3_BUCKET"'             # restore
```

### 5. Whole server lost

1. Provision a new server (deploy/README.md "first-time setup"), restore `deploy/.env` from the
   password manager, point DNS at the new server.
2. `docker compose -f docker-compose.yml up -d db garage` and `sh scripts/garage-init.sh`.
3. Steps 1 and 3 above with the newest dump, then step 4 for objects, then start the rest.
4. Run the restore test again against the new server before announcing recovery.

## Restore-test checklist (workplan Increment 6, before go-live)

Run on staging first, then on production with a scratch database. Record date, operator, dump
name and results in the runbook.

- [ ] `docker compose logs backup` shows a successful scheduled run in the last 24 h and
      Healthchecks.io shows the check green.
- [ ] `restore.sh --list` shows daily, weekly and monthly tiers with the expected counts.
- [ ] The age private key was retrieved from the password manager and decrypts the newest dump
      (`restore.sh --latest` completes).
- [ ] Row counts for `delegate`, `audit_log`, `user_account` match the live database or differ
      only by rows created after the dump (check `occurred_at` of the newest audit row).
- [ ] `audit_log` append-only trigger present in the restore (printed by the script).
- [ ] A spot check: one delegate looked up by email in `restore_test` matches the live record.
- [ ] Object copy: one recent upload decrypts from `offsitecrypt:` and matches the original.
- [ ] Time from "start" to "restore_test verified" recorded; must be under 2 hours including key
      retrieval.
- [ ] `DROP DATABASE restore_test` afterwards and the temporary key file shredded.
- [ ] Hourly mode switch rehearsed (`BACKUP_MODE=hourly`, `up -d backup`, one run observed) and
      switched back.

Local end-to-end test of the same scripts (used in development): `cd deploy && sh backup/test-local.sh`.
