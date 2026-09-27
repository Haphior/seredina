# Getting Started

This guide covers the agent console: how to use every feature from the
inside, once you already have an instance running. If you haven't
installed Seredina yet, start with
[Installing with Docker](/deployment/).

## Creating your organization

Visit `/register` on your instance and fill out the form — organization
slug, your name, email, and password. That first registration
automatically makes you an administrator — there's no separate CLI
bootstrap step.

::: tip One registration in self-hosted mode
If your instance runs `SEREDINA_MODE=self_hosted` (the default mode),
only one organization can register — this is intentional, see
[Cloud mode](/deployment/cloud-mode) if you need more than one.
:::

## Initial setup

Right after you register, the console opens a five-step setup. Every step
can be skipped, and **Settings → Initial setup** reopens it later.

1. **Your organization** — its name, its language (for emails to
   customers and the default names of statuses and categories) and your
   working hours, from presets like "Monday to Friday, 9:00 to 18:00" or
   "24/7", with the time zone. Switching the language renames the default
   statuses, unless you've already renamed them yourself.
2. **Email** — connect the support mailbox: Microsoft 365 or Google with
   their sign-in, or any other provider with a username and password. For
   common providers (Gmail, Outlook.com, Yahoo, iCloud, Zoho) the servers
   are filled in from the address.
3. **Kind of support** — pick *Internal IT*, *Customer support* or
   *Plant / manufacturing*. Seredina creates teams, a **Category** field
   with fitting options, SLA targets for each priority, saved replies
   (macros), and service catalog items. Anything you already have with the
   same name is left alone, so it's safe on a workspace that's in use.
4. **Team** — paste a list of people, one per line (`Ana Pérez
   <ana@company.com>` or just the address), pick their role and team, and
   invite them all. Invitations need the mailbox from step 2.
5. **Done** — what's set up, and what to do next.

Until the setup is finished or skipped, administrators see a reminder at
the top of the dashboard.

## The getting-started checklist

The dashboard also shows a "Get started" widget: connect a mailbox,
customize your ticket statuses, set an SLA policy, create a macro, and
invite a teammate. It's a guide, not a forced flow, and you can hide it at
any time with the eye icon in the widget's corner.

## Inviting your team

From **Settings → Users**, invite people by email so they choose
their own password (needs a connected email channel), or create the
account with an initial password and share it yourself. See
[Users and roles](/guide/administration#users-and-roles).

With [single sign-on](/guide/administration#single-sign-on-sso) and
automatic account creation turned on, you don't create accounts at all:
people sign in with their Microsoft or Google account and get the role you
chose.

## How this guide is organized

In the console, the sidebar holds the day-to-day work (tickets, contacts,
processes, the knowledge base and the CMDB). Everything that configures the
workspace is under **Settings**, at the bottom of the sidebar, grouped and
searchable. On a phone, the sidebar opens from the menu button at the top.

This guide's chapters:

- **[Tickets](/guide/tickets)** — the queue, ticket detail, macros, merging, bulk actions
- **[SLA & Escalation](/guide/sla-and-escalation)**
- **[CMDB & Assets](/guide/cmdb-and-assets)** — assets, agent-enrolled devices, contracts and warranties, equipment catalog
- **[Knowledge Base](/guide/knowledge-base)**
- **[Service Catalog](/guide/service-catalog)**
- **[Processes, Changes & Problems](/guide/processes-and-templates)**
- **[AI Copilot](/guide/ai-copilot)**
- **[Inbound Channels](/guide/channels)** — email, API, widget, Telegram, Slack/Teams, alerts
- **[Reports & Dashboard](/guide/reports-and-dashboard)**
- **[CSAT Surveys](/guide/csat-surveys)**
- **[Administration](/guide/administration)** — users, roles, single sign-on, two-factor sign-in, audit log, API keys, appearance, language
- **[Public Portal](/guide/public-portal)** — the customer portal, the public knowledge base and the status page
- **[Contacts & Personal Data](/guide/contacts-and-personal-data)** — correcting, exporting and erasing a contact's data, and automatic retention
