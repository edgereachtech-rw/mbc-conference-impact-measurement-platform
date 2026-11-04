# shellcheck shell=sh
# Defines rclone remotes from environment variables. Sourced by backup.sh and restore.sh:
#   . /backup/remotes.sh
#
#   offsite:  off-site S3-compatible bucket (BACKUP_S3_*; required)
#
# There is one remote because there is one thing to back up: the database. The platform stores no
# files, so the application-side object remote was removed with Garage on 2026-11-04.
#
# Nothing is written to disk: rclone reads RCLONE_CONFIG_<REMOTE>_<KEY> from the environment.
export RCLONE_CONFIG=/dev/null # no config file; silences the "config not found" notice

for v in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "remotes: $v is not set" >&2; exit 1; }
done

export RCLONE_CONFIG_OFFSITE_TYPE=s3
export RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-auto}"
export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=true
export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
