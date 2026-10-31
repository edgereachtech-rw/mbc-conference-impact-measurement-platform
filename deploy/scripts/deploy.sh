#!/usr/bin/env sh
# Deploys one image tag on this server (run by the GitHub Actions deploy workflow, or by hand).
#
#   usage: sh deploy/scripts/deploy.sh <image_tag> [--no-migrate]
#   env:   IMAGE_PREFIX  (optional) registry prefix, e.g. ghcr.io/org/repo; stored in .env when given
#
# Steps: record the tag in deploy/.env -> pull images -> prisma migrate deploy (one-off container)
#        -> docker compose up -d -> wait until the API's /api/health answers on its own origin.
# On failure it prints the service status and the last log lines, then exits 1.
set -eu

TAG="${1:?usage: deploy.sh <image_tag> [--no-migrate]}"
MIGRATE=1
[ "${2:-}" = "--no-migrate" ] && MIGRATE=0

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "deploy/.env not found"; exit 1; }

COMPOSE="docker compose -f docker-compose.yml"

set_env() {
  key="$1"; val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

[ -n "${IMAGE_PREFIX:-}" ] && set_env IMAGE_PREFIX "$IMAGE_PREFIX"
set_env IMAGE_TAG "$TAG"
PREFIX="$(grep '^IMAGE_PREFIX=' .env | cut -d= -f2-)"
echo "==> deploying ${PREFIX}/{web,api,backup}:${TAG}"

fail() {
  echo "!!! deploy failed: $1"
  $COMPOSE ps || true
  $COMPOSE logs --no-color --tail=200 api web worker || true
  exit 1
}

echo "==> pulling images"
$COMPOSE pull --quiet web api backup || fail "image pull"

if [ "$MIGRATE" -eq 1 ]; then
  echo "==> running migrations (one-off container)"
  $COMPOSE run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy || fail "prisma migrate deploy"
else
  echo "==> skipping migrations (--no-migrate)"
fi

echo "==> starting services"
$COMPOSE up -d --remove-orphans || fail "docker compose up"

# The API has its own origin now; API_PUBLIC_URL is what the browser uses, so probe that.
# Falls back to APP_DOMAIN for an older .env that predates the proxy removal.
BASE="$(grep '^API_PUBLIC_URL=' .env | cut -d= -f2- || true)"
[ -n "$BASE" ] || BASE="$(grep '^APP_DOMAIN=' .env | cut -d= -f2-)"
case "$BASE" in
  http://*|https://*) URL="$BASE/api/health" ;;
  *) URL="https://$BASE/api/health" ;;
esac

echo "==> smoke test: $URL"
attempt=1
while [ "$attempt" -le 30 ]; do
  body="$(curl -fsS --max-time 10 "$URL" 2>/dev/null || true)"
  case "$body" in
    *'"status":"ok"'*) echo "==> healthy: $body"; $COMPOSE ps; exit 0 ;;
  esac
  sleep 3
  attempt=$((attempt + 1))
done
fail "smoke test ($URL did not return status ok within 90 s)"
