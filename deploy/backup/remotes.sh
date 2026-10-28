# shellcheck shell=sh
# Defines rclone remotes from environment variables. Sourced by backup.sh and restore.sh:
#   . /backup/remotes.sh
#
#   offsite:       off-site S3-compatible bucket            (BACKUP_S3_*; required)
#   source:        application object storage, read side   (S3_*; only when S3_ENDPOINT is set)
#   offsitecrypt:  encrypted view of offsite:<bucket>/objects (only when BACKUP_RCLONE_CRYPT_PASSWORD is set)
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

if [ -n "${S3_ENDPOINT:-}" ]; then
  export RCLONE_CONFIG_SOURCE_TYPE=s3
  export RCLONE_CONFIG_SOURCE_PROVIDER=Other
  export RCLONE_CONFIG_SOURCE_ENDPOINT="$S3_ENDPOINT"
  export RCLONE_CONFIG_SOURCE_REGION="${S3_REGION:-garage}"
  export RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}"
  export RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}"
  export RCLONE_CONFIG_SOURCE_FORCE_PATH_STYLE=true
  export RCLONE_CONFIG_SOURCE_NO_CHECK_BUCKET=true
fi

if [ -n "${BACKUP_RCLONE_CRYPT_PASSWORD:-}" ]; then
  export RCLONE_CONFIG_OFFSITECRYPT_TYPE=crypt
  export RCLONE_CONFIG_OFFSITECRYPT_REMOTE="offsite:${BACKUP_S3_BUCKET}/objects"
  export RCLONE_CONFIG_OFFSITECRYPT_FILENAME_ENCRYPTION=standard
  export RCLONE_CONFIG_OFFSITECRYPT_DIRECTORY_NAME_ENCRYPTION=true
  RCLONE_CONFIG_OFFSITECRYPT_PASSWORD="$(rclone obscure "$BACKUP_RCLONE_CRYPT_PASSWORD")"
  export RCLONE_CONFIG_OFFSITECRYPT_PASSWORD
fi
