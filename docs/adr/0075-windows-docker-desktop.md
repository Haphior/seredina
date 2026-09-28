# ADR 0075: Supporting Windows Server with Docker Desktop

## Status

Accepted, implemented.

## Context

The first production server is a Windows Server with Docker Desktop: WSL 2
engine, Linux containers, alongside other containers. The deployment docs
and the compose file assumed a Linux host. Two things break or wobble on
Windows:

- **Line endings.** The repository had no `.gitattributes`. Git for
  Windows' default (`core.autocrlf=true`) checks text files out with CRLF.
  Then `infra/docker/migrate-entrypoint.sh`, copied into the `migrate`
  image, fails with `bad interpreter`, so the database is never migrated.
  `scripts/setup.sh` and `configure-address.sh` fail under Git Bash the
  same way.
- **The worker's host networking.** `network_mode: host` lets the worker
  scan the LAN on a Linux host, and reaches Postgres and Redis through the
  host's published ports. On Docker Desktop, "host" is Docker's own VM, not
  the Windows server. It gains nothing there (network discovery happens on
  the endpoint agents since ADR 0055), and it makes the worker's database
  connection depend on how Desktop forwards ports inside its VM.

## Decision

- **`.gitattributes`**: `* text=auto eol=lf`, so every checkout, on every
  OS, has LF endings. All tracked files were already LF, so nothing was
  renormalized.
- **`infra/docker-compose.desktop.yml`**, layered after the main file on
  Docker Desktop: the worker drops `network_mode: host`
  (`!reset null`, Compose ≥ 2.24) and reaches `postgres` and `redis` by
  service name, like the API does. Linux hosts keep the main file alone,
  and host networking with it.
- **CI runs the compose smoke test twice**: the main file, and the main
  file plus the Docker Desktop file (`SMOKE_EXTRA_COMPOSE`). The smoke test
  also now proves the worker reaches Postgres and Redis by connecting from
  inside its container. Before, it only checked that the container was
  still running, and a worker that can't connect retries without exiting.
- **Docs**: a *Windows Server with Docker Desktop* page (en/es) covering:
  - Git for Windows for bash and openssl;
  - Docker Desktop only running while someone is signed in;
  - checking ports against other containers, and moving 80/443 if they're
    taken;
  - the two compose files and `--env-file`;
  - the Windows firewall;
  - nightly `pg_dump` from the Task Scheduler;
  - updates.

## Consequences

- A Windows clone of any release from v0.3.1 on runs as is. Older releases
  need `git clone -c core.autocrlf=false`.
- Windows operators type longer `docker compose` commands, or keep
  `COMPOSE_FILE` set in their session.
- Agentless (worker-side) network scans don't reach the LAN from Docker
  Desktop. They didn't before either; agents cover discovery.

## Verified

- The connectivity check the smoke test runs inside the worker was run
  locally against the dev Postgres and Redis:
  - it exits 0 when both answer;
  - it exits 1 when Postgres is down;
  - it exits 1 when Redis points at a closed port.
- `git ls-files --eol` shows every tracked file as LF, so adding
  `.gitattributes` changes no file.
- The `compose-smoke` and `compose-smoke-desktop` CI jobs build and run
  the full stack with each layout.
