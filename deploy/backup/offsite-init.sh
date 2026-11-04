#!/usr/bin/env sh
# Initialises the "offsite" Garage instance used by backup/test-local.sh: the local stand-in for
# the off-site S3 bucket (Backblaze B2, Cloudflare R2, ...) that real backups are sent to.
#   1. assigns the single node to the cluster layout
#   2. imports the S3 key pair
#   3. creates the bucket and grants the key read/write/owner on it
# Safe to re-run: every step is skipped when it has already been done.
#
# This is test infrastructure only. The platform itself has no object storage: the Garage service
# was removed from the stack on 2026-11-04 because nothing used it.
#
# Called by backup/test-local.sh, which supplies all of these:
#   COMPOSE          compose command to use
#   OFFSITE_SERVICE  service name (default offsite)
#   OFFSITE_KEY_ID / OFFSITE_KEY_SECRET / OFFSITE_BUCKET / OFFSITE_KEY_NAME / OFFSITE_CAPACITY
set -eu
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep /garage as a container path

cd "$(dirname "$0")/.."

COMPOSE="${COMPOSE:-docker compose}"
SERVICE="${OFFSITE_SERVICE:-offsite}"
KEY_NAME="${OFFSITE_KEY_NAME:-backup}"
CAPACITY="${OFFSITE_CAPACITY:-1G}"
for v in OFFSITE_KEY_ID OFFSITE_KEY_SECRET OFFSITE_BUCKET; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "offsite-init: $v is not set"; exit 1; }
done
KEY_ID="$OFFSITE_KEY_ID"
KEY_SECRET="$OFFSITE_KEY_SECRET"
BUCKET="$OFFSITE_BUCKET"

garage() { $COMPOSE exec -T -e RUST_LOG=error "$SERVICE" /garage "$@"; }

echo "==> waiting for $SERVICE"
for _ in $(seq 1 30); do
  if garage status >/dev/null 2>&1; then break; fi
  sleep 2
done

NODE_ID="$(garage status | awk '/^[0-9a-f]{16}/ {print $1; exit}')"
[ -n "$NODE_ID" ] || { echo "could not read node id from 'garage status'"; exit 1; }

# "layout show" prints the current layout first, then staged changes; only the current part counts.
if garage layout show | sed -n '/CURRENT CLUSTER LAYOUT/,/Current cluster layout version/p' | grep -q "$NODE_ID"; then
  echo "==> layout already assigned"
else
  echo "==> assigning layout to node $NODE_ID (capacity $CAPACITY)"
  garage layout assign -z dc1 -c "$CAPACITY" "$NODE_ID"
  CURRENT="$(garage layout show | sed -n 's/^Current cluster layout version: *//p')"
  garage layout apply --version "$((${CURRENT:-0} + 1))"
fi

if garage key info "$KEY_ID" >/dev/null 2>&1; then
  echo "==> key already imported"
else
  echo "==> importing key $KEY_ID"
  garage key import --yes -n "$KEY_NAME" "$KEY_ID" "$KEY_SECRET" > /dev/null
fi

if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "==> bucket $BUCKET already exists"
else
  echo "==> creating bucket $BUCKET"
  garage bucket create "$BUCKET" > /dev/null
fi

echo "==> granting access"
garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_ID" > /dev/null
garage bucket info "$BUCKET" | head -n 12
echo "==> done"
