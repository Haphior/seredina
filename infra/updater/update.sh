#!/usr/bin/env bash
# Installs a Seredina release on this host (docs/adr/0077-in-app-updates.md).
# Run by the updater service from the installation folder, with the version
# tag as its argument and the repository to fetch it from in
# SEREDINA_SOURCE_URL. The same steps as docs/deployment/updates-and-backups.md:
#
#   1. back up the database to backups/
#   2. fetch the tag and check it out
#   3. rebuild and restart every service except the updater itself; the
#      migrate service applies new migrations before the API starts
#   4. wait for the API to answer
set -euo pipefail

VERSION=$1
: "${SEREDINA_SOURCE_URL:?}"
export GIT_TERMINAL_PROMPT=0

say() { echo "[$(date -u +%H:%M:%S)] $*"; }
# The messages follow the installation's language (UPDATE_LANG: es or en).
t() { if [ "${UPDATE_LANG:-es}" = es ]; then echo "$1"; else echo "$2"; fi; }

# The same files and .env the installation was started with.
COMPOSE_FILES=${SEREDINA_COMPOSE_FILES:-infra/docker-compose.yml}
args=(--env-file .env)
IFS=':' read -r -a files <<< "$COMPOSE_FILES"
for f in "${files[@]}"; do args+=(-f "$f"); done
dc() { docker compose "${args[@]}" "$@"; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "$(t "Hay cambios locales en los archivos de Seredina en $(pwd); no se actualiza encima de ellos." "There are local changes to Seredina's files in $(pwd); not updating over them.")"
  git status --short --untracked-files=no
  exit 1
fi

say "$(t "Respaldando la base de datos" "Backing up the database")"
mkdir -p backups
backup="backups/before-$VERSION-$(date -u +%Y%m%d-%H%M%S).dump"
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$backup"
say "$(t "Respaldo guardado" "Backup saved"): $backup ($(du -h "$backup" | cut -f1))"

say "$(t "Descargando" "Fetching") $VERSION"
git fetch --quiet --force "$SEREDINA_SOURCE_URL" "refs/tags/$VERSION:refs/tags/$VERSION"
previous=$(git describe --tags --always)
git -c advice.detachedHead=false checkout --quiet "$VERSION"
say "$(t "Versión $VERSION lista (antes: $previous)" "Checked out $VERSION (was $previous)")"

services=$(dc config --services | grep -vx updater | tr '\n' ' ')
say "$(t "Reconstruyendo y reiniciando" "Rebuilding and restarting"): $services"
# shellcheck disable=SC2086
dc up -d --build $services 2>&1

say "$(t "Esperando a que la API responda" "Waiting for the API")"
for _ in $(seq 1 60); do
  if dc exec -T api node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    say "$(t "Seredina $VERSION está funcionando" "Seredina $VERSION is up")"
    exit 0
  fi
  sleep 5
done
say "$(t "La API no respondió en 5 minutos. Revisa: docker compose logs api migrate" "The API did not come back within 5 minutes. Check: docker compose logs api migrate")"
say "$(t "Para volver atrás: docs/deployment/updates-and-backups.md (respaldo: $backup)" "To roll back: docs/deployment/updates-and-backups.md (backup: $backup)")"
exit 1
