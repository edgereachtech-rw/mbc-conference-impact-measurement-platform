#!/usr/bin/env sh
# Encrypted off-site backup of the platform (backlog E0-7). POSIX sh; runs inside the backup
# container (crond) or from host cron with the same environment variables.
#
#   1. pg_dump (custom format, compressed) of PGDATABASE, encrypted with age to BACKUP_AGE_PUBLIC_KEY
#      before it is written anywhere. The private key is never on the server.
#   2. Upload with rclone to the off-site S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS S3,
#      ...): db/<tier>/<database>-<UTC timestamp>.dump.age
#   3. Sync the application object bucket (S3_*) to <offsite>/objects/, encrypted at rest with an
#      rclone crypt remote when BACKUP_RCLONE_CRYPT_PASSWORD is set.
#   4. Retention per tier: hourly 48 (hourly mode only), daily 14, weekly 8, monthly 12.
#   5. Healthchecks.io: /start at the beginning, the plain URL on success, /fail on any error.
#      The exit code is non-zero on any error.
#
# Required: PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_AGE_PUBLIC_KEY
#           BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
# Optional: BACKUP_MODE (nightly|hourly) BACKUP_S3_PROVIDER (Other|AWS|Cloudflare) BACKUP_S3_REGION
#           BACKUP_KEEP_HOURLY/DAILY/WEEKLY/MONTHLY BACKUP_OBJECTS (true|false)
#           S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY (source objects)
#           BACKUP_RCLONE_CRYPT_PASSWORD HEALTHCHECKS_BACKUP_URL
# Logs contain file names, sizes and counts only: never database content or personal data.
set -eu
umask 077

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

for v in PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_AGE_PUBLIC_KEY; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || die "$v is not set"
done
# shellcheck source=remotes.sh
. "$(dirname "$0")/remotes.sh"

MODE="${BACKUP_MODE:-nightly}"
KEEP_HOURLY="${BACKUP_KEEP_HOURLY:-48}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"
HC_URL="${HEALTHCHECKS_BACKUP_URL:-}"
BUCKET="$BACKUP_S3_BUCKET"
RCLONE="rclone --quiet --retries 3 --low-level-retries 10"

WORK="$(mktemp -d)"
ping() {
  [ -n "$HC_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_URL}${1}" || log "warning: Healthchecks ping '${1:-success}' failed"
}
on_exit() {
  rc=$?
  rm -rf "$WORK"
  if [ "$rc" -eq 0 ]; then
    ping ""
    log "finished successfully"
  else
    ping "/fail"
    log "FAILED with exit code $rc"
  fi
  exit "$rc"
}
trap on_exit EXIT INT TERM

ping "/start"
log "starting (mode=$MODE database=$PGDATABASE target=$BACKUP_S3_ENDPOINT/$BUCKET)"

# ---------------------------------------------------------------- 1. dump + encrypt
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="${PGDATABASE}-${STAMP}.dump.age"
DUMP="$WORK/$NAME"

# No pipefail in POSIX sh: pg_dump records its own failure through a marker file.
(
  pg_dump --format=custom --compress=6 --no-owner --no-privileges "$PGDATABASE" \
    || echo "$?" > "$WORK/pg_dump.failed"
) | age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$DUMP"
[ ! -f "$WORK/pg_dump.failed" ] || die "pg_dump failed with exit code $(cat "$WORK/pg_dump.failed")"
SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
[ "$SIZE" -gt 1024 ] || die "dump is implausibly small ($SIZE bytes)"
log "dump encrypted: $NAME ($SIZE bytes)"

# ---------------------------------------------------------------- 2. upload to tiers
# Tier selection uses local time (TZ = event timezone), so "02:00" and "Sunday" are Lagos time.
HOUR="$(date +%H)"
DOW="$(date +%u)" # 1 = Monday ... 7 = Sunday
DOM="$(date +%d)"

if [ "$MODE" = "hourly" ]; then
  TIERS="hourly"
  [ "$HOUR" = "02" ] && TIERS="$TIERS daily"
else
  TIERS="daily"
fi
case " $TIERS " in
  *" daily "*)
    [ "$DOW" = "7" ] && TIERS="$TIERS weekly"
    [ "$DOM" = "01" ] && TIERS="$TIERS monthly"
    ;;
esac

for tier in $TIERS; do
  $RCLONE copyto "$DUMP" "offsite:$BUCKET/db/$tier/$NAME" || die "upload to db/$tier failed"
  log "uploaded db/$tier/$NAME"
done

# ---------------------------------------------------------------- 3. retention
prune() {
  tier="$1"; keep="$2"
  listing="$WORK/list-$tier"
  { $RCLONE lsf "offsite:$BUCKET/db/$tier/" --files-only 2>/dev/null || true; } | sort > "$listing"
  total="$(wc -l < "$listing" | tr -d ' ')"
  excess=$((total - keep))
  if [ "$excess" -gt 0 ]; then
    head -n "$excess" "$listing" | while IFS= read -r old; do
      [ -n "$old" ] || continue
      $RCLONE deletefile "offsite:$BUCKET/db/$tier/$old" || die "could not delete db/$tier/$old"
      log "pruned db/$tier/$old"
    done
  fi
  kept="$total"; [ "$kept" -gt "$keep" ] && kept="$keep"
  log "retention db/$tier: keep $keep, now $kept"
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
prune monthly "$KEEP_MONTHLY"
[ "$MODE" = "hourly" ] && prune hourly "$KEEP_HOURLY"

# ---------------------------------------------------------------- 4. object storage sync
if [ "${BACKUP_OBJECTS:-true}" = "true" ] && [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ]; then
  if [ -n "${BACKUP_RCLONE_CRYPT_PASSWORD:-}" ]; then
    DEST="offsitecrypt:"
    log "objects: syncing $S3_BUCKET to encrypted off-site path objects/"
  else
    DEST="offsite:$BUCKET/objects"
    log "objects: syncing $S3_BUCKET to off-site path objects/ UNENCRYPTED (set BACKUP_RCLONE_CRYPT_PASSWORD)"
  fi
  $RCLONE sync "source:$S3_BUCKET" "$DEST" --transfers 4 --checkers 8 || die "object sync failed"
  COUNT="$($RCLONE size "$DEST" --json 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p')"
  log "objects: synced (${COUNT:-?} objects off-site)"
else
  log "objects: skipped (BACKUP_OBJECTS=false or S3_* not set)"
fi
