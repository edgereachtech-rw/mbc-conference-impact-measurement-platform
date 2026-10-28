#!/usr/bin/env sh
# One-time initialisation of a Garage object store after the first `docker compose up -d`:
#   1. assigns the single node to the cluster layout
#   2. imports the S3 key pair (S3_ACCESS_KEY / S3_SECRET_KEY from .env)
#   3. creates S3_BUCKET and grants the key read/write/owner on it
# Safe to re-run: every step is skipped when it has already been done.
#
# Usage (from deploy/):  sh scripts/garage-init.sh
#
# Overrides (used by backup/test-local.sh for the "offsite" instance):
#   COMPOSE="docker compose -f ... -f ..."   compose command to use
#   GARAGE_SERVICE=offsite                    service name (default garage)
#   GARAGE_KEY_ID / GARAGE_KEY_SECRET / GARAGE_BUCKET / GARAGE_KEY_NAME
set -eu
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep /garage as a container path

cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env not found in $(pwd)"; exit 1; }
set -a
# shellcheck source=/dev/null
. ./.env
set +a

COMPOSE="${COMPOSE:-docker compose}"
SERVICE="${GARAGE_SERVICE:-garage}"
KEY_ID="${GARAGE_KEY_ID:-$S3_ACCESS_KEY}"
KEY_SECRET="${GARAGE_KEY_SECRET:-$S3_SECRET_KEY}"
BUCKET="${GARAGE_BUCKET:-$S3_BUCKET}"
KEY_NAME="${GARAGE_KEY_NAME:-app}"
CAPACITY="${GARAGE_CAPACITY:-20G}"

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
