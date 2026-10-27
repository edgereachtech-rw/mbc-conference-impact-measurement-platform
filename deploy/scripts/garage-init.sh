#!/usr/bin/env sh
# One-time initialisation of the Garage object store after the first `docker compose up -d`:
#   1. assigns the single node to the cluster layout
#   2. imports the S3 key pair from .env (S3_ACCESS_KEY / S3_SECRET_KEY)
#   3. creates S3_BUCKET and grants the key read/write/owner on it
# Safe to re-run: every step is skipped when it has already been done.
#
# Usage (from deploy/):  sh scripts/garage-init.sh
set -eu

cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env not found in $(pwd)"; exit 1; }
set -a
# shellcheck source=/dev/null
. ./.env
set +a

garage() { docker compose exec -T garage /garage "$@"; }

echo "==> waiting for garage"
for _ in $(seq 1 30); do
  if garage status >/dev/null 2>&1; then break; fi
  sleep 2
done

NODE_ID="$(garage status | awk '/^[0-9a-f]{16}/ {print $1; exit}')"
[ -n "$NODE_ID" ] || { echo "could not read node id from 'garage status'"; exit 1; }

if garage layout show | grep -q "$NODE_ID"; then
  echo "==> layout already assigned"
else
  echo "==> assigning layout to node $NODE_ID (capacity ${GARAGE_CAPACITY:-20G})"
  garage layout assign -z dc1 -c "${GARAGE_CAPACITY:-20G}" "$NODE_ID"
  VERSION="$(garage layout show | awk '/version/ {v=$NF} END {print v+0}')"
  garage layout apply --version "$((VERSION + 1))"
fi

if garage key info "$S3_ACCESS_KEY" >/dev/null 2>&1; then
  echo "==> key already imported"
else
  echo "==> importing key $S3_ACCESS_KEY"
  garage key import --yes -n app "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
fi

if garage bucket info "$S3_BUCKET" >/dev/null 2>&1; then
  echo "==> bucket $S3_BUCKET already exists"
else
  echo "==> creating bucket $S3_BUCKET"
  garage bucket create "$S3_BUCKET"
fi

echo "==> granting access"
garage bucket allow --read --write --owner "$S3_BUCKET" --key "$S3_ACCESS_KEY"
garage bucket info "$S3_BUCKET"
echo "==> done"
