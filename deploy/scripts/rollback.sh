#!/usr/bin/env sh
# Rolls the running stack back to a previous image tag (backlog E0-3: rollback = redeploy the
# previous tag). Images stay in GHCR, so this only pulls and restarts; no rebuild.
#
#   usage: sh deploy/scripts/rollback.sh <previous_image_tag>
#
# Migrations are NOT run. If the release being rolled back shipped a migration that the previous
# code cannot work with, restore the database from backup first (E0-7 runbook).
set -eu

TAG="${1:?usage: rollback.sh <previous_image_tag>}"
cd "$(dirname "$0")/.."

CURRENT="$(grep '^IMAGE_TAG=' .env 2>/dev/null | cut -d= -f2- || true)"
echo "==> rolling back from '${CURRENT:-unknown}' to '$TAG'"
echo "    migrations are skipped; the schema stays at the newer version"

exec sh "$(dirname "$0")/deploy.sh" "$TAG" --no-migrate
