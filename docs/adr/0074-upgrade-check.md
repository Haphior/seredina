# ADR 0074: Every change is checked against an upgrade from the last release

## Status

Accepted, implemented.

## Context

Since v0.2.0 (ADR 0050), production servers run tagged releases and update
by checking out the next tag and running `docker compose up -d --build`.
The `migrate` container then applies the new migrations to a database full
of real data.

CI tested two things: the test suite on a freshly migrated database, and
the compose stack built and started from nothing. Neither tested the path a
production server actually takes: **an existing release, with data,
upgraded to new code**. A migration that rewrote a column, a backfill with
a bug, or new code that couldn't read rows written by the old code would
all have passed CI.

Before putting the work since v0.2.0 into production, the owner asked for
proof that the program updates cleanly, and for that proof to hold for
every future version.

## Decision

`scripts/upgrade-check.sh`, run by a new `upgrade-check` CI job on every
pull request and push to `main`:

1. **Install the previous release.**
   - It is the newest `v*` tag in HEAD's history that isn't on HEAD itself,
     so a release commit is checked against the release before it.
   - It runs in its own git worktree, with its own `npm ci`, and migrates an
     empty, dedicated database (`seredina_upgrade_check`) with that
     release's own `infra/docker/migrate-entrypoint.sh`.
2. **Fill it through its own API**, like users would
   (`scripts/upgrade-check/seed.mjs`): a tenant, an agent, tickets with
   internal notes and replies, an assignment, a custom status, an SLA
   policy, a custom field, a macro, an API key and a notification choice.
   - Only long-standing endpoints are required.
   - Anything else is tried and skipped if that release lacks it, so the
     seed keeps working as the "from" release moves forward.
3. **Snapshot every table**: row count and an md5 over every row
   (`scripts/upgrade-check/snapshot.sh`). The column list per table is
   saved too.
4. **Run this code's migrate entrypoint** on the same database. This is
   exactly what the `migrate` container does after an update.
5. **Snapshot again over the saved columns** and fail on any difference.
   New migrations may add tables, columns and enum values. They may not
   change or drop a row that existed. A table that gained a column is
   compared on the columns it had.
6. **Start this code's API on the upgraded database** and read the old
   data back (`scripts/upgrade-check/verify.mjs`):
   - old passwords sign in;
   - every ticket and its conversation reads back;
   - the assignment and the notification choice are kept;
   - a new ticket continues the numbering.

**Intended data changes.** A release may need to change existing rows on
purpose, such as a backfill or a data fix. It lists those tables, one per
line with the reason, in `scripts/upgrade-check/allow-data-changes.txt`.
Those tables are left out of step 5 and everything else is still
compared. The list is emptied at each release (ADR 0050's checklist), so
exceptions never accumulate.

**Why "the previous release" is enough.** Migrations only go forward and
Prisma applies all pending ones in order. So skipping versions (0.2 → 0.4)
runs the same migrations as upgrading one release at a time, and each of
those steps was checked when its release was made.

## Consequences

- A migration that alters existing data, or code that can't read what the
  previous release wrote, fails CI before it reaches a release.
- CI takes a few minutes more: a second `npm ci` for the old release, two
  migrations and two API starts.
- The check runs without Docker (a Postgres and a Redis are enough), so it
  also runs locally.
- It covers the database and the API. Frontend-only changes don't need it,
  and the compose-smoke job still covers the images.

## Verified

- Run locally from v0.2.0 to this branch:
  - the 4 new migrations applied;
  - the 55 existing tables were unchanged;
  - all 10 read-back checks passed.
- Run with a deliberately bad migration added
  (`UPDATE tickets SET subject = subject || ' (touched)'`): the check
  failed, showing the `tickets` hash change, and exited 1.
- The allow-list leaves out only the listed table: `ticket_statuses` is
  still compared when `tickets` is listed.
- Found and fixed while building it:
  - The default port 4190 is on the Fetch standard's blocked-port list
    (ManageSieve), so it moved to 4191.
  - Stopping the API killed `npx` but not the node process it spawned.
    That left a connection that blocked dropping the database. The API now
    runs in its own process group, which is stopped as a whole.
- Separately, by hand: the same upgrade from v0.2.0, with data entered
  through v0.2.0's API, then exercised through the new features:
  - Spanish renamed the seeded statuses and kept a custom one.
  - The manufacturing template skipped the existing urgent SLA.
  - A new team got its "ticket in my team" notification.
  - Existing workspaces get the first-run setup reminder.
