# ADR 0077: In-app updates with configurable sources

## Status

Accepted, implemented.

## Context

Updating a self-hosted install meant, on the server:
1. a `pg_dump`;
2. `git fetch --tags`;
3. `git checkout vX`;
4. `docker compose up -d --build`.

That's easy to get wrong, and easy to put off. Administrators asked to
update from the console. Some also run their own fork, or can only reach an
internal git mirror.

The API container can't do this itself. It has no git, no Docker, and no
access to the installation's files, and it shouldn't have them: it's the
internet-facing part.

## Decision

### An optional `updater` service holds the host access

A small container (`infra/docker/Dockerfile.updater`: Node, git, Docker CLI
with compose) in the `updater` compose profile.

**Mounts:**
- the Docker socket;
- the installation folder, *at its own host path*. Compose then resolves
  relative build contexts and bind mounts (`../certs`, `./caddy`) and the
  project name exactly as on the host.

**Exposure:** it publishes no port and listens only on the compose network.

**Endpoints**, each requiring `UPDATER_TOKEN` (a constant-time comparison):
- `GET /status`: the running or last update and its log, plus
  `git describe`;
- `POST /tags`: `git ls-remote --tags` of a repository, for git sources;
- `POST /update {version, url, lang}`: runs `infra/updater/update.sh`.

**Input checks:** the version must match `vX.Y.Z[-pre]` and the URL
`http(s)://`, `ssh://` or `git@`. Nothing reaches a shell unquoted.

**The script, `update.sh`:**
1. Refuses to run over local changes to tracked files.
2. Dumps the database to `backups/before-<version>-<time>.dump`, via
   `docker compose exec postgres pg_dump`.
3. Fetches the tag from the source URL and checks it out.
4. Runs `docker compose up -d --build` for every service **except the
   updater**. Recreating itself would kill the process running the update.
5. Waits for the API's `/health`.

Its messages follow the installation's language.

**Running the script:**
- It's copied before running, because bash reads a script as it goes and
  the checkout replaces it.
- State and log go to `.seredina-update/state.json`, so they survive the
  API restarting mid-update. Credentials in URLs are redacted from the log.

**Self-update.** The updater reads its code from the mounted installation,
not the image. After a successful update it exits, and `restart:
unless-stopped` brings it back on the new `server.mjs`. Only the tools in
its image need a rebuild, and they rarely change.

**Enabling it.** `scripts/enable-updater.sh`:
- generates the token;
- records `SEREDINA_HOST_DIR`;
- adds the profile;
- starts the updater and restarts the API.

It's opt-in, because the Docker socket is root-equivalent on the host. The
compose file never *requires* its variables, so installs without it are
unaffected. It's Linux-only: Docker Desktop on Windows can't mount a Windows
path at the same path inside a Linux container.

### Sources and checks in the API

`instance_settings` is the first installation-wide table: a key, a JSON
value, and no tenant and no RLS (like `permissions`). It holds:
- **the sources**: the built-in GitHub `Haphior/seredina`, plus any the admin
  adds:
  - a GitHub `owner/repo`;
  - a git URL.
  Each can have a token, encrypted with `ENCRYPTION_KEY`, and can opt into
  pre-releases.
- **the active source.**
- **the last check.**

**Checking:**
- *GitHub*: the releases API, without drafts, and without pre-releases
  unless opted in. It shows the release notes.
- *Git*: the repository's `vX.Y.Z` tags, listed through the updater (the
  API has no git).

Versions compare as semver. Older releases aren't offered.

**Installing.** The API passes the updater the active source's clone URL,
with its token in it for a private repository.

**Access.** The routes (`/system/updates/*`):
- are self-hosted only; a cloud install is updated by its operator;
- require `roles:manage`.

Starting an update and changing sources are audited.

### Console

**Settings → Updates** shows:
- the running version;
- the result of "Check for updates";
- newer releases with their notes (rendered as text; no HTML from a release
  reaches the page);
- an **Install** button with a confirmation listing the steps.

During an update it shows a live log, polling through the API's own restart.
The page also manages sources. Without the updater, it shows the
enable/manual commands.

## Consequences

- Updating is one click once the updater is enabled, always with a backup
  first. Backups accumulate in `backups/`; pruning them is the
  administrator's call.
- Enabling the updater gives a compromised API a path to the host, through
  the token. Its risk is the same as running any web UI with Docker access
  (Portainer, Watchtower). Documented, and off by default.
- The API's outbound `fetch` doesn't use an HTTP proxy from the environment.
  A server that reaches GitHub only through a proxy can still use a git
  source, since git does honor the proxy.
- Rolling back stays manual (restore the backup, check out the old tag), as
  documented: migrations only go forward.
