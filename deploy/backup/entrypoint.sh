#!/usr/bin/env sh
# Container entrypoint for the backup service.
#   no arguments  -> run the scheduler (busybox crond in the foreground)
#   any arguments -> run that command instead (docker compose run --rm backup /backup/backup.sh)
#
# Schedule (in TZ, which docker-compose.yml sets to the event timezone, Africa/Lagos):
#   BACKUP_MODE=nightly  -> 02:00 every day            (RPO 24 h)
#   BACKUP_MODE=hourly   -> every hour on the hour     (RPO 1 h, conference days 12-13 November)
#   BACKUP_CRON="..."    -> explicit cron expression, overrides the mode
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

MODE="${BACKUP_MODE:-nightly}"
case "$MODE" in
  nightly) SCHEDULE='0 2 * * *' ;;
  hourly) SCHEDULE='0 * * * *' ;;
  *) echo "backup: unknown BACKUP_MODE '$MODE' (use nightly or hourly)" >&2; exit 1 ;;
esac
[ -n "${BACKUP_CRON:-}" ] && SCHEDULE="$BACKUP_CRON"

mkdir -p /etc/crontabs
# Job output goes to the container's stdout so `docker compose logs backup` shows every run.
printf '%s /backup/backup.sh >> /proc/1/fd/1 2>&1\n' "$SCHEDULE" > /etc/crontabs/root

echo "backup: scheduler started (mode=$MODE schedule='$SCHEDULE' TZ=${TZ:-UTC} db=${PGDATABASE:-?}@${PGHOST:-?})"
if [ "${BACKUP_RUN_ON_START:-false}" = "true" ]; then
  /backup/backup.sh || echo "backup: run-on-start failed (see above); scheduler continues"
fi

exec crond -f -l 6 -L /dev/stdout
