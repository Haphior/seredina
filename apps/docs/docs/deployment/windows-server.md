# Windows Server with Docker Desktop

Seredina's containers are Linux containers, so on Windows they run under
Docker Desktop's WSL 2 engine. Everything in
[Production on a company server](/deployment/internal-server) still
applies. This page covers only what's different on Windows.

## 1. What you need

- **Docker Desktop** using the WSL 2 engine, set to Linux containers (its
  default).
- **Git for Windows** ([git-scm.com](https://git-scm.com/download/win)).
  It brings **Git Bash**, which has the `bash` and `openssl` that the setup
  scripts use. Every command on this page runs in Git Bash.
- A fixed IP address for the server, and ideally a name for it in your
  internal DNS (see
  [A name for it](/deployment/internal-server#_2-a-name-for-it)).

::: warning Docker Desktop starts when someone signs in
Docker Desktop, and with it Seredina, only runs while a user is signed in
to the server. For a server that must come back by itself after a reboot:

- turn on **Settings → General → Start Docker Desktop when you sign in**;
- have that account sign in automatically, or keep its session open
  (disconnect from Remote Desktop instead of signing out).

The containers restart on their own once Docker is up.
:::

## 2. Check which ports are free

Seredina uses these ports on the server:

| Port | For | Faces the network |
|---|---|---|
| 443 and 80 | The HTTPS entry point | Yes |
| 8080 | Console | Only until HTTPS is on |
| 4000 | API | Only until HTTPS is on |
| 5432, 6379 | Postgres, Redis | No, `127.0.0.1` only |

In Docker Desktop's **Containers** list, check the **Port(s)** column of
your other containers. If something already uses 80 or 443, or 5432 or 6379
(another database), pick other ports in step 4.

## 3. Install

In Git Bash, in the folder where you keep your Docker projects (here
`C:\DockerData`):

```bash
cd /c/DockerData
git clone --branch v0.3.1 https://github.com/Haphior/seredina.git seredina
cd seredina
./scripts/setup.sh
```

`setup.sh` writes `.env` with random secrets. **Copy `.env` somewhere
safe, off this server** (a password manager). Without its `ENCRYPTION_KEY`,
a backup can't be restored with mailboxes, single sign-on and two-factor
sign-in intact.

::: tip Line endings
Releases from v0.3.1 on force Unix line endings on checkout. Git for
Windows would otherwise turn the scripts into Windows line endings, and
they'd fail inside the containers with errors such as
`/bin/bash^M: bad interpreter`. For an older release, clone with
`git clone -c core.autocrlf=false ...`.
:::

## 4. Address, HTTPS and ports

If ports 80 or 443 were taken in step 2, set others in `.env` first, for
example:

```bash
sed -i 's/^HTTP_PORT=.*/HTTP_PORT=8081/; s/^HTTPS_PORT=.*/HTTPS_PORT=8443/' .env
```

Likewise `POSTGRES_PORT` and `REDIS_PORT` if 5432 or 6379 are taken.

Then choose the address and the certificate, as in
[Certificate and address](/deployment/internal-server#_4-certificate-and-address).
With the server's name (recommended) or its IP:

```bash
./scripts/configure-address.sh --address helpdesk.yourcompany.com --tls internal
# or: --address 192.168.1.31 --tls internal
```

The address, including a non-standard HTTPS port, goes into `WEB_ORIGIN`
and `API_PUBLIC_URL`.

## 5. Start

Every `docker compose` command on Windows adds the Docker Desktop file
`infra/docker-compose.desktop.yml` after the main one. With it, the worker
uses the normal container network instead of host networking, which on
Docker Desktop is Docker's own virtual machine, not your server.

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml up -d --build
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml ps
```

The first build takes several minutes. Then open the address from step 4,
register your organization, and go through the initial setup.

To save typing, keep the two files in a variable for the Git Bash session:

```bash
export COMPOSE_FILE="infra/docker-compose.yml;infra/docker-compose.desktop.yml"
docker compose --env-file .env ps
```

## 6. Windows firewall

Allow the HTTPS port (and 80, which only redirects to HTTPS) from your
network. In PowerShell, as administrator:

```powershell
New-NetFirewallRule -DisplayName "Seredina HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -RemoteAddress 192.168.0.0/16 -Action Allow
New-NetFirewallRule -DisplayName "Seredina HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -RemoteAddress 192.168.0.0/16 -Action Allow
```

Use your own network range and the ports from step 4.

## 7. Backups

The database lives in a Docker volume inside Docker Desktop, not in
`C:\DockerData`. Dump it to a file:

```bash
mkdir -p /c/DockerData/backups
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml \
  exec -T postgres pg_dump -U app_migrator -Fc seredina > /c/DockerData/backups/seredina-$(date +%F).dump
```

To run it every night, save those lines as
`C:\DockerData\seredina-backup.sh`. Then add a task to the Task Scheduler
that runs `"C:\Program Files\Git\bin\bash.exe" -lc "cd /c/DockerData/seredina && /c/DockerData/seredina-backup.sh"`.

Copy the dumps off the server as well. Restoring works as described in
[Backups](/deployment/updates-and-backups#backups).

## 8. Updates

Same as [Updating to a new release](/deployment/updates-and-backups#updating-to-a-new-release),
with the Docker Desktop file added:

```bash
cd /c/DockerData/seredina
git fetch --tags
git checkout v0.3.1        # the new release
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml up -d --build
```

Back up before, and check `https://<address>/api/health` after.
