#!/usr/bin/env bash
# Upgrade check: proves that an instance running the previous release can be
# updated to this code without losing or changing any of its data.
#
#   1. Installs the previous release (a git tag) in a scratch worktree and
#      migrates an empty database with that release's own migrate steps.
#   2. Starts that release's API and fills it with data through its API, the
#      way real users would (scripts/upgrade-check/seed.mjs).
#   3. Snapshots every table: row count and a hash of every row.
#   4. Runs *this* code's migrate steps on the same database -- exactly what
#      the `migrate` container does on `docker compose up` after an update.
#   5. Snapshots again, over the same columns, and fails on any difference:
#      new migrations may add tables and columns, never alter existing data.
#   6. Starts this code's API on the upgraded database and checks the old
#      data through it (scripts/upgrade-check/verify.mjs).
#
# See docs/adr/0074-upgrade-check.md. Run by CI on every pull request; runnable
# locally against any Postgres + Redis:
#
#   DATABASE_URL=postgresql://app_migrator:...@localhost:5432/seredina \
#   APP_TENANT_DB_PASSWORD=... REDIS_URL=redis://localhost:6379 \
#   JWT_SECRET=... ENCRYPTION_KEY=... bash scripts/upgrade-check.sh [from-tag]
#
# DATABASE_URL must be a role that can create databases (app_migrator is).
# It creates and drops its own database (seredina_upgrade_check) and never
# touches the one in DATABASE_URL.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO=$(pwd)
HERE="$REPO/scripts/upgrade-check"

: "${DATABASE_URL:?}" "${APP_TENANT_DB_PASSWORD:?}" "${REDIS_URL:?}" "${JWT_SECRET:?}" "${ENCRYPTION_KEY:?}"

# The release to upgrade from: the newest version tag that is an ancestor of
# HEAD, other than one on HEAD itself (so a release commit is checked against
# the release before it).
if [ $# -ge 1 ]; then
  FROM=$1
else
  HEAD_SHA=$(git rev-parse HEAD)
  FROM=""
  for tag in $(git tag --list 'v*' --sort=-v:refname); do
    sha=$(git rev-list -n1 "$tag")
    if [ "$sha" != "$HEAD_SHA" ] && git merge-base --is-ancestor "$sha" HEAD; then
      FROM=$tag
      break
    fi
  done
  if [ -z "$FROM" ]; then
    echo "[upgrade-check] no earlier release tag in this history; nothing to upgrade from"
    exit 0
  fi
fi
echo "[upgrade-check] upgrading from $FROM to $(git describe --tags --always)"

DB=seredina_upgrade_check
BASE_URL=${DATABASE_URL%%\?*}
BASE_URL=${BASE_URL%/*}
ADMIN_URL="$BASE_URL/postgres"
MIGRATOR_URL="$BASE_URL/$DB?schema=public"
# app_tenant's URL: same host, its own role.
HOSTPART=${BASE_URL#*@}
TENANT_URL="postgresql://app_tenant:${APP_TENANT_DB_PASSWORD}@${HOSTPART}/$DB?schema=public"
PORT=${UPGRADE_CHECK_PORT:-4191}
export REDIS_URL="${REDIS_URL%/}/${UPGRADE_CHECK_REDIS_DB:-7}"
export SEREDINA_MODE=self_hosted JWT_SECRET ENCRYPTION_KEY APP_TENANT_DB_PASSWORD

WORK=$(mktemp -d)
OLD="$WORK/old"
API_PID=""

cleanup() {
  status=$?
  [ -n "$API_PID" ] && { kill -- "-$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null || true; }
  if [ "$status" -ne 0 ] && [ -f "$WORK/api.log" ]; then
    echo "::group::last API log"; tail -n 60 "$WORK/api.log" || true; echo "::endgroup::"
  fi
  git -C "$REPO" worktree remove --force "$OLD" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

# Installs dependencies and builds the shared packages of a checkout.
prepare() {
  (cd "$1" && npm ci --no-audit --no-fund --loglevel=error >/dev/null)
  (cd "$1" && npm run build --workspace=packages/shared >/dev/null)
  (cd "$1" && npm run prisma:generate --workspace=packages/db >/dev/null)
  (cd "$1" && npm run build --workspace=packages/db >/dev/null)
  if [ -d "$1/packages/ai-adapters" ]; then (cd "$1" && npm run build --workspace=packages/ai-adapters >/dev/null); fi
}

# The release's own migrate steps (infra/docker/migrate-entrypoint.sh).
migrate() {
  (cd "$1/packages/db" && DATABASE_URL="$MIGRATOR_URL" bash ../../infra/docker/migrate-entrypoint.sh) | sed 's/^/    /'
}

start_api() {
  # Its own process group, so stop_api takes down npx *and* the node it spawns.
  (cd "$1/apps/api" && DATABASE_URL="$TENANT_URL" PORT=$PORT exec setsid npx tsx src/index.ts) > "$WORK/api.log" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:$PORT/health" >/dev/null && return 0
    sleep 1
  done
  echo "[upgrade-check] API from $1 didn't start"
  return 1
}

stop_api() {
  kill -- "-$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  # The port is free again only once the old API is really gone.
  for _ in $(seq 1 30); do
    curl -s -m 1 "http://localhost:$PORT/health" >/dev/null || break
    sleep 1
  done
  API_PID=""
}

echo "[upgrade-check] 1/6 installing $FROM"
git worktree add --detach "$OLD" "$FROM" >/dev/null 2>&1
prepare "$OLD"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
migrate "$OLD"

echo "[upgrade-check] 2/6 filling $FROM with data through its API"
start_api "$OLD"
API="http://localhost:$PORT" node "$HERE/seed.mjs" > "$WORK/seed.json"
stop_api

echo "[upgrade-check] 3/6 snapshot before"
bash "$HERE/snapshot.sh" "$MIGRATOR_URL" "$WORK/before.txt"

echo "[upgrade-check] 4/6 migrating to this code"
if [ "${UPGRADE_CHECK_SKIP_PREPARE:-}" != "1" ]; then prepare "$REPO"; fi
migrate "$REPO"

echo "[upgrade-check] 5/6 snapshot after, over the same columns"
bash "$HERE/snapshot.sh" "$MIGRATOR_URL" "$WORK/after.txt" "$WORK/before.txt.cols"
# Tables this release changes on purpose are listed, with a reason, in
# allow-data-changes.txt; they're left out of the comparison.
ALLOWED=$(grep -v '^\s*#' "$HERE/allow-data-changes.txt" | awk 'NF {print $1}' || true)
filter() {
  if [ -z "$ALLOWED" ]; then cat "$1"; else grep -v -w -F -f <(echo "$ALLOWED") "$1"; fi
}
if [ -n "$ALLOWED" ]; then echo "    not compared, changed on purpose: $(echo $ALLOWED)"; fi
if ! diff -u <(filter "$WORK/before.txt") <(filter "$WORK/after.txt"); then
  echo "[upgrade-check] FAIL: the upgrade changed or lost existing data (diff above)."
  echo "    If that's intended, list the table in scripts/upgrade-check/allow-data-changes.txt with the reason."
  exit 1
fi
echo "    $(wc -l < "$WORK/after.txt") tables, existing data unchanged"

echo "[upgrade-check] 6/6 checking the old data through this code's API"
start_api "$REPO"
API="http://localhost:$PORT" SEED="$WORK/seed.json" node "$HERE/verify.mjs"
stop_api

echo "[upgrade-check] OK: $FROM upgrades cleanly"
