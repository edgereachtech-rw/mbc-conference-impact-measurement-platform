#!/usr/bin/env sh
# End-to-end test of the backup system on a laptop (backlog E17-7 "restore tested end to end").
#
#   cd deploy && sh backup/test-local.sh
#
# What it does, against the local Compose stack:
#   1. builds the backup image and generates a throwaway age key pair (never written to the repo)
#   2. starts db, the primary Garage and a second Garage ("offsite") that stands in for the
#      off-site bucket, initialises both (layout, key, bucket)
#   3. migrates and seeds the database (ITTEC 2026 event + 10 test delegates), uploads a sample
#      object to the primary bucket
#   4. runs backup.sh, lists what arrived off-site
#   5. runs restore.sh with --expect-match: the row counts of the restore_test database must equal
#      the live database, and the encrypted object copy must decrypt to the sample
# Exit code 0 = PASS. Requires deploy/.env (copy .env.example) and the api image (docker compose build api).
# Single-quoted snippets below expand inside the container on purpose.
# shellcheck disable=SC2016
set -eu
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: do not rewrite /backup/... arguments

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "deploy/.env missing: cp .env.example .env"; exit 1; }
set -a
# shellcheck source=/dev/null
. ./.env
set +a

rand() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

# Test-only secrets for the stand-in off-site store, generated fresh on every run.
OFFSITE_RPC_SECRET="$(rand 32)"; export OFFSITE_RPC_SECRET
OFFSITE_ADMIN_TOKEN="$(rand 32)"; export OFFSITE_ADMIN_TOKEN
OFFSITE_ACCESS_KEY="GK$(rand 12)"; export OFFSITE_ACCESS_KEY
OFFSITE_SECRET_KEY="$(rand 32)"; export OFFSITE_SECRET_KEY
OFFSITE_BUCKET="offsite-backups"; export OFFSITE_BUCKET
TEST_CRYPT_PASSWORD="$(rand 16)"; export TEST_CRYPT_PASSWORD
TEST_AGE_PUBLIC_KEY="pending"; export TEST_AGE_PUBLIC_KEY

COMPOSE="docker compose -f docker-compose.yml -f backup/docker-compose.test.yml"
export COMPOSE
step() { printf '\n=== %s\n' "$*"; }

step "1. build the backup image"
$COMPOSE build backup

step "1b. generate a throwaway age key pair"
KEYS="$($COMPOSE run --rm --no-deps -T backup age-keygen 2>/dev/null)"
TEST_AGE_PUBLIC_KEY="$(printf '%s\n' "$KEYS" | sed -n 's/^# public key: //p')"
TEST_AGE_IDENTITY="$(printf '%s\n' "$KEYS" | grep '^AGE-SECRET-KEY-')"
[ -n "$TEST_AGE_PUBLIC_KEY" ] && [ -n "$TEST_AGE_IDENTITY" ] || { echo "age-keygen failed"; exit 1; }
export TEST_AGE_PUBLIC_KEY
echo "public key: $TEST_AGE_PUBLIC_KEY"

step "2. start database and both object stores"
$COMPOSE up -d db garage offsite

step "2b. initialise the primary object store"
COMPOSE="$COMPOSE" sh scripts/garage-init.sh

step "2c. initialise the stand-in off-site store"
COMPOSE="$COMPOSE" GARAGE_SERVICE=offsite GARAGE_KEY_ID="$OFFSITE_ACCESS_KEY" \
  GARAGE_KEY_SECRET="$OFFSITE_SECRET_KEY" GARAGE_BUCKET="$OFFSITE_BUCKET" \
  GARAGE_KEY_NAME=backup GARAGE_CAPACITY=1G sh scripts/garage-init.sh

step "3. migrate and seed the database"
$COMPOSE run --rm --no-deps -T api ./node_modules/.bin/prisma migrate deploy
$COMPOSE run --rm --no-deps -T -e NODE_ENV=staging -e SEED_TEST_DELEGATES=true \
  -e ADMIN_EMAIL=backup-test-admin@example.com api node dist/seed.js

step "3b. upload a sample object to the primary bucket"
$COMPOSE run --rm --no-deps -T backup sh -c '
  . /backup/remotes.sh
  printf "backup e2e sample %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | rclone rcat "source:$S3_BUCKET/uploads/backup-test.txt"
  rclone ls "source:$S3_BUCKET"'

step "4. run backup.sh"
$COMPOSE run --rm -T backup /backup/backup.sh

step "4b. what arrived off-site (encrypted names under objects/ are expected)"
$COMPOSE run --rm -T backup sh -c '. /backup/remotes.sh && rclone lsf -R "offsite:$BACKUP_S3_BUCKET"'

step "5. run restore.sh and compare counts with the live database"
$COMPOSE run --rm -T -e BACKUP_AGE_IDENTITY="$TEST_AGE_IDENTITY" backup \
  /backup/restore.sh --latest --expect-match

step "5b. decrypt the object copy"
SAMPLE="$($COMPOSE run --rm -T backup sh -c '. /backup/remotes.sh && rclone cat offsitecrypt:uploads/backup-test.txt')"
case "$SAMPLE" in
  "backup e2e sample "*) echo "object copy decrypts: $SAMPLE" ;;
  *) echo "object copy did not decrypt to the sample: '$SAMPLE'"; exit 1 ;;
esac

step "6. clean up the scratch database"
$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -c 'DROP DATABASE IF EXISTS restore_test;'

printf '\nPASS: backup, off-site upload, encrypted object copy and restore all verified.\n'
printf 'The offsite stand-in keeps running; stop it with: %s stop offsite\n' "$COMPOSE"
