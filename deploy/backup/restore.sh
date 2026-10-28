#!/usr/bin/env sh
# Restore test / recovery (backlog E17-7). POSIX sh; runs inside the backup container:
#
#   docker compose -f docker-compose.yml run --rm \
#     -v /path/to/age-private.key:/run/age.key:ro \
#     backup /backup/restore.sh --latest --identity /run/age.key
#
# Steps: download the chosen dump from the off-site bucket, decrypt it with the age private key
# supplied at run time, restore it into a scratch database (default "restore_test") on the same
# PostgreSQL server, run the verification queries and print a comparison with the live database.
#
# Options:
#   --latest              newest dump in the tier (default) ...
#   --tier <hourly|daily|weekly|monthly>   ... from this tier (default daily)
#   --name <file>         a specific dump file name (as printed by --list)
#   --identity <file>     age private key file (or set BACKUP_AGE_IDENTITY to the key text)
#   --target-db <name>    scratch database (default restore_test); it is dropped and recreated
#   --expect-match        exit 1 when any restored count differs from the live database
#   --list                list the dumps in the tier and exit
set -eu
umask 077

log() { printf '%s restore: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

TIER="daily"
NAME=""
IDENTITY_FILE=""
TARGET_DB="restore_test"
EXPECT_MATCH=false
LIST_ONLY=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --latest) ;;
    --tier) TIER="$2"; shift ;;
    --name) NAME="$2"; shift ;;
    --identity) IDENTITY_FILE="$2"; shift ;;
    --target-db) TARGET_DB="$2"; shift ;;
    --expect-match) EXPECT_MATCH=true ;;
    --list) LIST_ONLY=true ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done

for v in PGHOST PGUSER PGPASSWORD PGDATABASE; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || die "$v is not set"
done
[ "$TARGET_DB" != "$PGDATABASE" ] || die "refusing to restore over the live database $PGDATABASE"
# shellcheck source=remotes.sh
. "$(dirname "$0")/remotes.sh"
BUCKET="$BACKUP_S3_BUCKET"
RCLONE="rclone --quiet --retries 3"

if [ "$LIST_ONLY" = "true" ]; then
  $RCLONE lsf "offsite:$BUCKET/db/$TIER/" --files-only --format "tsp" | sort
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

# ---------------------------------------------------------------- private key, for this run only
if [ -z "$IDENTITY_FILE" ]; then
  [ -n "${BACKUP_AGE_IDENTITY:-}" ] || die "supply --identity <file> or BACKUP_AGE_IDENTITY"
  IDENTITY_FILE="$WORK/identity"
  printf '%s\n' "$BACKUP_AGE_IDENTITY" > "$IDENTITY_FILE"
fi
[ -r "$IDENTITY_FILE" ] || die "cannot read identity file $IDENTITY_FILE"

# ---------------------------------------------------------------- choose and download
if [ -z "$NAME" ]; then
  NAME="$($RCLONE lsf "offsite:$BUCKET/db/$TIER/" --files-only | sort | tail -n 1)"
  [ -n "$NAME" ] || die "no dumps found in db/$TIER/"
fi
log "downloading db/$TIER/$NAME"
$RCLONE copyto "offsite:$BUCKET/db/$TIER/$NAME" "$WORK/$NAME" || die "download failed"

log "decrypting"
age -d -i "$IDENTITY_FILE" -o "$WORK/dump.custom" "$WORK/$NAME" || die "decryption failed (wrong key?)"
pg_restore --list "$WORK/dump.custom" > /dev/null || die "dump is not a valid pg_dump custom archive"

# ---------------------------------------------------------------- restore into the scratch database
log "recreating database $TARGET_DB"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" \
  -c "CREATE DATABASE \"$TARGET_DB\";" || die "could not recreate $TARGET_DB"
pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_DB" "$WORK/dump.custom" \
  || die "pg_restore failed"
log "restored into $TARGET_DB"

# ---------------------------------------------------------------- verification queries
TABLES="user_account delegate audit_log event participation_category invitation consent_record"
count() { psql -At -q -d "$1" -c "SELECT count(*) FROM \"$2\";"; }
MIGRATIONS_LIVE="$(psql -At -q -d "$PGDATABASE" -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;')"
MIGRATIONS_RESTORED="$(psql -At -q -d "$TARGET_DB" -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;')"
LATEST_AUDIT="$(psql -At -q -d "$TARGET_DB" -c "SELECT coalesce(max(occurred_at)::text, 'none') FROM audit_log;")"

mismatch=0
printf '\n%-24s %12s %12s  %s\n' "table" "live" "restored" "status"
printf '%-24s %12s %12s  %s\n' "------------------------" "------------" "------------" "------"
for t in $TABLES; do
  live="$(count "$PGDATABASE" "$t")"
  restored="$(count "$TARGET_DB" "$t")"
  if [ "$live" = "$restored" ]; then status="match"; else status="DIFFERS"; mismatch=$((mismatch + 1)); fi
  printf '%-24s %12s %12s  %s\n' "$t" "$live" "$restored" "$status"
done
if [ "$MIGRATIONS_LIVE" = "$MIGRATIONS_RESTORED" ]; then mstatus="match"; else mstatus="DIFFERS"; mismatch=$((mismatch + 1)); fi
printf '%-24s %12s %12s  %s\n' "_prisma_migrations" "$MIGRATIONS_LIVE" "$MIGRATIONS_RESTORED" "$mstatus"
printf '\nnewest audit_log row in the restore: %s\n' "$LATEST_AUDIT"
printf 'dump: db/%s/%s\n\n' "$TIER" "$NAME"

# Independent of the live database: the append-only trigger must have come back with the schema.
if psql -At -q -d "$TARGET_DB" -c "SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_update_delete';" | grep -q 1; then
  log "audit_log append-only trigger present in the restore"
else
  die "audit_log trigger missing after restore"
fi

log "restore test complete: $mismatch table(s) differ from live (expected when the live database changed after the backup)"
log "drop the scratch database when done: psql -d postgres -c 'DROP DATABASE $TARGET_DB;'"

if [ "$EXPECT_MATCH" = "true" ] && [ "$mismatch" -ne 0 ]; then
  die "--expect-match: $mismatch table(s) differ"
fi
