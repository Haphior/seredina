# Updates and Backups

## Updating your instance

Seredina doesn't update itself: you choose when. Each release is a git tag
(`v0.2.0`, `v0.3.0`...) with its notes on the
[releases page](https://github.com/Haphior/helpdesk-seredina/releases). A
production server should run a release, not whatever `main` holds today.

### Which version is running

```bash
curl -s https://<your address>/api/health     # {"status":"ok","version":"0.2.0"}
git -C /opt/seredina describe --tags            # v0.2.0
```

### Updating to a new release

1. **Read the release notes.** They list what changed and anything to do
   by hand. Check them for every release you skip over, too.
2. **Back up** the database, and have your `.env` copy at hand (see
   [Backups](#backups)):

   ```bash
   docker compose -f infra/docker-compose.yml exec -T postgres \
     pg_dump -U app_migrator -Fc seredina > before-v0.3.0.dump
   ```

3. **Switch to the release and rebuild:**

   ```bash
   git fetch --tags
   git checkout v0.3.0
   docker compose -f infra/docker-compose.yml up -d --build
   ```

   The `migrate` service runs first and applies any new schema migration
   before `api` takes traffic. There's no separate migration step. Expect
   a minute or two of downtime while the containers restart, so do it
   outside working hours.
4. **Check:** `/api/health` shows the new version, and you can sign in.

Every release is checked, before it's published, by upgrading the previous
release with data in it: no existing row may change, and the old data has
to read back through the new version. Skipping releases (0.2 → 0.4) is
fine: the migrations of each release in between run in order.

If you installed from `main` before releases existed, `git checkout v0.2.0`
moves you onto the first release. From then on, follow the steps above.

### Rolling back

Migrations only go forward, so going back to an older release means going
back to the database from before the update as well:

```bash
git checkout v0.2.0
docker compose -f infra/docker-compose.yml down
docker volume rm infra_postgres_data        # the name `docker volume ls` shows
docker compose -f infra/docker-compose.yml up -d postgres
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U app_migrator -d seredina --no-owner --no-privileges < before-v0.3.0.dump
docker compose -f infra/docker-compose.yml up -d --build
```

Anything recorded after the backup is lost. That's why the backup comes
right before the update.

### Updating the agents

Agents are released separately
([Haphior/seredina-agent](https://github.com/Haphior/seredina-agent/releases)),
and agent and server versions don't have to match. On a computer, as
administrator/root:

```bash
seredina-agent update --check    # is there a newer agent?
seredina-agent update            # install it; no enrollment token needed
```

On Windows the agent lives in `C:\Program Files\Seredina Agent\seredina-agent.exe`.

`update` keeps the computer's enrollment and check-in interval. It
verifies the download's SHA-256, and does nothing if the agent is
already current. So you can run it on all your computers from Intune, a
GPO startup script, Jamf or Ansible.

## Backups

Seredina doesn't ship automated backups — it's a standard Postgres
running in a container, and the standard Postgres tools are what you use.

```bash
# Full backup, in Postgres's compressed custom format. Run it from the
# repository root. -T matters: without it docker allocates a terminal and
# can corrupt the binary output.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U app_migrator -Fc seredina > seredina-$(date +%Y%m%d-%H%M).dump
```

Schedule it with cron (or your provider's own backup mechanism) and copy
the file **off the machine** — a backup on the same disk as the database
doesn't survive the disk. For example, nightly at 02:30 keeping 14 days:

```text
30 2 * * * cd /opt/seredina && docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U app_migrator -Fc seredina > /var/backups/seredina/seredina-$(date +\%Y\%m\%d).dump && find /var/backups/seredina -name '*.dump' -mtime +14 -delete
```

If Postgres doesn't run in this compose file (a managed database), use
your provider's snapshots or point the same `pg_dump` at it.

### Restoring

Restore into an **empty** database, then let `migrate` finish the job:
it recreates the `app_tenant` role with the password in your `.env` and
re-applies the row-level security policies and grants, all of which live
outside a plain table dump.

```bash
# 1. Stop everything, empty only the database volume, start only Postgres.
docker compose -f infra/docker-compose.yml down
docker volume rm infra_postgres_data        # the name `docker volume ls` shows
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Load the dump.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U app_migrator -d seredina --no-owner --no-privileges < seredina-20260101-0230.dump

# 3. Bring the rest up; migrate runs first, as on every start.
docker compose -f infra/docker-compose.yml up -d
```

`docker volume rm` deletes the current database. Only run it when you
really mean to replace that data. Don't use `down -v` instead: it also
deletes `caddy_data`, and with the `internal` TLS mode a new CA would be
generated, so browsers and every agent would stop trusting the server. Restore into a test machine now and
then: a backup you've never restored is a guess, not a backup.

Backups also keep personal data that was later
[anonymized](/guide/contacts-and-personal-data) in the live database, until
they rotate out. Keep them only as long as you need them.

### What else you need to back up

A database dump **isn't enough on its own**. Keep a copy of your `.env`
somewhere safe and separate from the dumps — in particular:

- **`ENCRYPTION_KEY`**: every stored secret is encrypted with it
  (AES-256-GCM): email channel passwords and Gmail/Microsoft 365 OAuth
  tokens, SSO client secrets, users' MFA secrets, AI provider keys,
  webhook signing secrets and Telegram bot tokens. Restore a database
  with a different key and all of those are permanently unreadable:
  mailboxes must be reconnected, SSO reconfigured, and **every user with
  MFA must have it reset by an admin**. Guard it like the database
  password itself — and never store it in the same place as the dumps,
  or one stolen backup is enough to read every secret.
- **`JWT_SECRET`**: losing this doesn't lose data, but every active
  session becomes invalid — annoying, not catastrophic.
- **`APP_TENANT_DB_PASSWORD`** and **`POSTGRES_PASSWORD`**: not needed
  to read the dump, but restoring with the same `.env` avoids surprises.
- If you use the `proxy` profile with your own certificate, the files in
  `certs/`. Let's Encrypt certificates are reissued on their own.

### Per-tenant data export

Separate from an infrastructure backup, every tenant has its own complete
export in an open format: **Settings → Data Export** in the console (or
`GET /export` directly) returns a single JSON file with all ~35 tables
that belong to that tenant. It's the honest answer to "data portability":
migrating *away* from Seredina is one click, not a deliberately painful
process like some tools whose business model depends on making it hard to
leave. Secrets (password hashes, API key hashes, encrypted credentials)
are always excluded from the export — they never leave the database.

This is per-tenant data portability, not a replacement for a real
infrastructure backup — use it for migration or audits, not as your only
copy.
