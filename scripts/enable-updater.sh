#!/bin/bash
# Turns on updates from the console (docs/adr/0077-in-app-updates.md):
# generates UPDATER_TOKEN, records where this installation lives, adds the
# `updater` compose profile, and starts the updater (and restarts the API so
# it knows the token). Run once, from the installation folder, on a Linux
# host. --disable turns it back off.
#
#   bash scripts/enable-updater.sh
#   bash scripts/enable-updater.sh --disable
#
# The updater gets the Docker socket, which is root on this machine. It
# publishes no port and answers only the API; see the ADR before enabling it
# where that trade-off matters.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "[enable-updater] no .env here -- run scripts/setup.sh first" >&2; exit 1; }

env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
env_set() {
  if grep -qE "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

COMPOSE_FILES=$(env_get SEREDINA_COMPOSE_FILES)
COMPOSE_FILES=${COMPOSE_FILES:-infra/docker-compose.yml}
args=(--env-file .env)
IFS=':' read -r -a files <<< "$COMPOSE_FILES"
for f in "${files[@]}"; do args+=(-f "$f"); done

OTHER_PROFILES=$(env_get COMPOSE_PROFILES | tr ',' '\n' | grep -vx 'updater' | grep -v '^$' | paste -sd, - || true)

if [ "${1:-}" = "--disable" ]; then
  docker compose "${args[@]}" stop updater >/dev/null 2>&1 || true
  docker compose "${args[@]}" rm -f updater >/dev/null 2>&1 || true
  env_set COMPOSE_PROFILES "$OTHER_PROFILES"
  env_set UPDATER_TOKEN ""
  docker compose "${args[@]}" up -d api
  echo "[enable-updater] Updates from the console are off."
  exit 0
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "[enable-updater] The updater runs on Linux hosts. On Windows, update by hand: docs/deployment/updates-and-backups.md" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "[enable-updater] openssl is needed to generate the token" >&2; exit 1; }

[ -n "$(env_get UPDATER_TOKEN)" ] || env_set UPDATER_TOKEN "$(openssl rand -hex 32)"
env_set SEREDINA_HOST_DIR "$(pwd)"
env_set COMPOSE_PROFILES "$( [ -n "$OTHER_PROFILES" ] && echo "$OTHER_PROFILES,updater" || echo updater )"

docker compose "${args[@]}" up -d --build updater api
echo "[enable-updater] Done. Settings -> Updates in the console can now install releases."
