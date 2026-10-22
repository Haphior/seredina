<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Seredina logo">
</p>

<h1 align="center">Seredina</h1>
<p align="center"><b>Open-source ITSM that meets you in the middle.</b></p>
<p align="center">
  <a href="https://github.com/Haphior/seredina/actions/workflows/ci.yml"><img src="https://github.com/Haphior/seredina/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/Haphior/seredina/releases"><img src="https://img.shields.io/github/v/release/Haphior/seredina?include_prereleases&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://haphior.github.io/seredina/"><img src="https://img.shields.io/badge/docs-haphior.github.io%2Fseredina-informational" alt="Documentation"></a>
</p>

Ticketing, asset management/CMDB and NOC/SOC alert intake in one helpdesk,
with an AI copilot that drafts and a human who approves. "Seredina"
(середина) is Slavic for "the middle": email, the portal, API calls and
monitoring alerts arrive from different places and land in the same ticket.

Self-host it with Docker or run it as a multi-tenant cloud service: same
codebase, same containers. Full source under AGPL-3.0, with no separate
"enterprise" edition holding features back.

**Documentation: [haphior.github.io/seredina](https://haphior.github.io/seredina/)**
(English and Spanish) covers every feature from the console, deployment, and
the API, webhooks and MCP server.

## Features

**Service desk**
- Tickets from email (IMAP/SMTP, or Gmail and Microsoft 365 over OAuth),
  the customer portal, an embeddable chat widget, Slack, Teams, Telegram,
  the API and monitoring alerts (Grafana, Zabbix, any webhook).
- Tenant-defined statuses, custom fields, macros, saved views, SLA policies
  with business hours and escalation, on-call schedules, CSAT surveys.
- Service catalog, change, problem and release management, IT processes and
  templates, a knowledge base with semantic search, a public status page.
- **Customer portal**: customers sign in with an emailed link to follow and
  answer their own tickets and request catalog items.

**Assets and inventory**
- CMDB of IT equipment with an equipment catalog of hardware models, and a
  directory of the companies you work with and their people.
- Contracts, warranties and licenses linked to assets, with payment and
  renewal reminders.
- Agentless network discovery (TCP and SNMP).
- **Endpoint agent** for Windows, macOS and Linux
  ([Haphior/seredina-agent](https://github.com/Haphior/seredina-agent)): one
  binary that runs as a service and reports hardware down to serial numbers,
  software, updates, security posture (antivirus/EDR, encryption, firewall),
  and a server's services, ports, roles and VMs. Inventory only: it never
  runs commands sent from the server.

**AI, opt-in**
- Bring your own key: Anthropic, OpenAI or a local Ollama. With none set,
  the AI features stay off.
- Reply suggestions and summaries grounded in the knowledge base, triage of
  new tickets (priority and team).
- An autonomous mode and an MCP server for your own agents, both gated by a
  per-tenant Autonomy Policy: actions that change data wait for a human
  unless explicitly allowed, and every call is audited.

**Security and administration**
- Tenant isolation with PostgreSQL Row-Level Security.
- Two-factor sign-in (TOTP and recovery codes), single sign-on over OpenID
  Connect (Microsoft Entra ID, Google Workspace, any OIDC provider), custom
  roles, an append-only audit log.
- Personal data tools: correct, export or anonymize a contact, and optional
  automatic retention (Chile's Ley 21.719, GDPR).
- Updates from the console (Linux hosts), dashboards and reports, data
  export, console in English and Spanish.

See [CHANGELOG.md](CHANGELOG.md) for what each release changed and
[docs/ROADMAP.md](docs/ROADMAP.md) for what's planned and deliberately left out.

## Install

Requires Docker. On Linux:

```bash
git clone https://github.com/Haphior/seredina.git
cd seredina
git checkout "$(git tag --sort=-v:refname | head -1)"   # the latest release
./scripts/setup.sh                                       # writes .env with fresh secrets
docker compose -f infra/docker-compose.yml up -d
```

`migrate` applies the schema and exits, then `api`, `worker` and `web`
start. Open `http://localhost:8080` (`WEB_PORT` in `.env`) and register your
organization at `/register`.

- **Windows Server with Docker Desktop**: see
  [Windows Server](https://haphior.github.io/seredina/deployment/windows-server).
- **HTTPS, a company server, a domain**: see
  [Production on a company server](https://haphior.github.io/seredina/deployment/internal-server).
- **Every variable**: [`.env.example`](.env.example) and
  [Environment variables](https://haphior.github.io/seredina/deployment/environment-variables).

> [!WARNING]
> Back up `.env` separately from the database. `ENCRYPTION_KEY` encrypts every
> stored secret (mailbox passwords and OAuth tokens, SSO settings, MFA secrets,
> AI keys); without it they can't be read. `setup.sh` never overwrites an
> existing `.env`.

If a container doesn't become healthy, start with
`docker compose -f infra/docker-compose.yml logs api` (or `worker`): both
check every required variable at startup and list everything missing at once.

## Updating

Back up, check out the new tag, rebuild:

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U app_migrator -Fc seredina > before-update.dump
git fetch --tags
git checkout v0.4.0            # the new release
docker compose -f infra/docker-compose.yml up -d --build
```

Migrations run on their own before the API takes traffic. Read the release
notes of every version you skip. On Linux you can also update from
Settings → Updates after `bash scripts/enable-updater.sh`. Details, rollback
and backups: [Updates and backups](https://haphior.github.io/seredina/deployment/updates-and-backups).

## Stack

| Part | Technology |
|---|---|
| API | Node.js, TypeScript, Fastify, Prisma, PostgreSQL with Row-Level Security |
| Console | React, Vite, Tailwind |
| Worker | BullMQ on Redis: discovery, outbound email, webhooks, notifications, SLA timers; inbound email polling with a per-mailbox lock |
| AI | `packages/ai-adapters` (Anthropic, OpenAI, Ollama), local embeddings with pgvector |
| MCP | `apps/mcp-server`, stdio and Streamable HTTP |
| Docs | VitePress in `apps/docs`, published to GitHub Pages |

The reasoning behind the main decisions is in [docs/adr/](docs/adr/).

## Repository layout

```
apps/
  api/          Fastify API; domain logic in src/modules/*/service.ts
  web/          Agent and admin console
  worker/       Background jobs: discovery, email in and out, deliveries, timers
  mcp-server/   MCP server with the AI copilot's tool catalog
  docs/         User guide, deployment and API reference (VitePress)
packages/
  db/           Prisma schema, migrations, RLS policies, withTenantTx
  shared/       Types, zod DTOs, permissions, crypto, SSRF guard, queue contracts
  ui/           Shared React components
  ai-adapters/  LLM provider interface and implementations
  config/       Shared tsconfig and eslint
infra/          Dockerfiles, docker-compose files, Caddy, the updater
scripts/        setup, compose smoke test, upgrade check, updater setup
docs/           Roadmap, ADRs, product and design notes
```

## Integrations

### MCP server

`apps/mcp-server` exposes the copilot's ticket tools (get, reply, status,
assign, macro, escalate) to your own MCP client: Claude Desktop, an n8n
workflow, a script. Create an API key in Settings → API Keys, then pick a
transport with `MCP_TRANSPORT`:

- **stdio** (default): the client starts it per session.
  ```bash
  docker build -f infra/docker/Dockerfile.mcp-server -t seredina-mcp-server .
  docker run -i --rm -e SEREDINA_API_KEY=<key> -e DATABASE_URL=... -e ENCRYPTION_KEY=... seredina-mcp-server
  ```
- **http**: an always-on service, authenticated per request with
  `Authorization: Bearer <key>`:
  `docker compose -f infra/docker-compose.yml --profile mcp up -d mcp-server-http`.

Changes go through the tenant's Autonomy Policy (Operations → AI Agent
Activity) like the copilot's. See `docs/adr/0033-ai-tool-catalog-and-autonomy.md`
and `docs/adr/0035-mcp-http-transport.md`.

### Chat widget

```html
<script src="https://<your-instance>/api/widget.js" data-tenant="<tenant-slug>"></script>
```

Visitors get a chat bubble on your site; each conversation is a ticket
(`channel: "widget"`). See `docs/adr/0040-embeddable-widget.md`.

## Development

Requires Docker (Postgres and Redis) and Node.js 22 or later.

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres redis
npm run dev:api                               # API on :4000
npm run dev --workspace=apps/web              # console on :5173
npm run dev --workspace=apps/worker           # only for discovery/email; needs REDIS_URL, DATABASE_URL, ENCRYPTION_KEY
```

- The console reads the API address from `VITE_API_URL`
  (`apps/web/.env.example`, default `http://localhost:4000`).
- Database: `npm run prisma:generate|prisma:migrate|prisma:deploy|prisma:seed --workspace=@seredina/db`.
- `./scripts/compose-smoke.sh` builds every image and boots the whole stack
  in its own compose project, as CI's `compose-smoke` job does.
- Error tracking uses the Sentry SDK and stays off until `SENTRY_DSN` /
  `VITE_SENTRY_DSN` is set (Sentry or a self-hosted GlitchTip).

More background: [docs/PRD.md](docs/PRD.md) (product requirements),
[docs/PRODUCT.md](docs/PRODUCT.md), [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)
and [docs/BRAND.md](docs/BRAND.md).

## Contributing

- Keep commits small and focused: one migration, one route, one screen.
- Sign off every commit (`git commit -s`): the
  [Developer Certificate of Origin](DCO.md), checked by CI on every pull
  request.
- Read the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues
  privately as described in [SECURITY.md](SECURITY.md), never in a public
  issue.

## License

[AGPL-3.0-only](LICENSE).
