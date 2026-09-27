# ADR 0072: A first-run setup wizard with starting templates

## Status

Accepted, implemented.

## Context

A new workspace was set up one Settings page at a time, from a four-item
checklist on the dashboard. The review that led to ADR 0071 found three
problems with that:

- **The most important step wasn't on the list.** Without a mailbox, no
  request arrives by email, no reply reaches a customer, and invitations
  and email notifications can't be sent. The checklist didn't mention it.
- **Everything started empty.** Teams, categories, SLA targets, saved
  replies and catalog items all had to be invented from nothing, by someone
  who doesn't know yet what the product expects.
- **A Spanish-speaking company got English defaults.** Status names were
  seeded in English, whatever the company's language.

The ROADMAP backlog also lists an AI-assisted setup. It stays in the
backlog: every run costs a model call, and a conversation is harder to
make predictable than a form. The wizard below is the deterministic base
such an assistant could later drive.

## Decision

### Five steps, all skippable

`/setup` in the console. A new registration lands there; admins of a
workspace that hasn't finished it see a reminder on the dashboard until
they finish or dismiss it; **Settings → Initial setup** reopens it anytime.

1. **Organization**: name, language, working hours and time zone. The
   hours are presets (office 9–18, early 8–17:30, shifts Mon–Sat 24h,
   24/7, or decide later) rather than the full weekly editor, which stays
   on Settings → Business hours.
2. **Email**: links into the existing Email Channels flow with the provider
   preselected (`?new=microsoft_oauth|google_oauth|password&from=setup`),
   rather than a second copy of that form. The "back to setup" link
   survives an OAuth round trip through `sessionStorage`. The password
   form now fills in the IMAP/SMTP servers of common providers from the
   address's domain.
3. **Kind of support**: a template (below).
4. **Team**: one person per line, invited through the existing
   `POST /users` and added to a team through `PATCH /teams/:id`; no new
   endpoint. Disabled with an explanation until a mailbox exists, since
   invitations are emailed.
5. **Done**: what got set up, and links to the next things worth doing.

### Server side

`apps/api/src/modules/setup`, `tickets:manage_all`, all audited:

- `GET /setup`: completed or not, and what exists (name, language, hours,
  mailbox count, applied template, users, teams).
- `PUT /setup/organization`: writes the tenant name, the email language
  (merged into the existing email settings), business hours from a preset,
  and renames the four seeded statuses to the new language, but only the
  ones still named exactly as seeded in either language. A name an admin
  chose is never overwritten.
- `POST /setup/template`: applies a template (below).
- `POST /setup/complete`: stamps `tenants.setup_completed_at`.

Registration also takes an optional `language`, sent by the console in its
current language. It seeds the statuses in that language and sets the
email language. API clients that don't send it get the old behavior.

### Templates

`it_internal`, `customer_support` and `manufacturing`, in
`setup/templates.ts`, each in Spanish and English. Each one creates:

- **Teams** (three per template).
- **A "Category" select field** with fitting options, plus a "Line or area"
  text field for manufacturing.
- **SLA targets** for all four priorities. When business hours are set,
  every priority except Urgent counts business hours only.
- **Macros**: a reply, and a move to pending or resolved where that fits.
  The status is resolved to the tenant's real status id when applied.
- **Service catalog items** that use those fields.

Everything is ordinary tenant data, written in the workspace's language.
Applying skips whatever already exists by name, and any priority that
already has an SLA. So it's safe on a workspace in use, applying twice
creates nothing new, and the response says what was actually created.
`tenants.setup_template` records the choice.

The manufacturing template exists because the first real deployment is a
manufacturing company (machine-down tickets need a 10-minute urgent
target, and the line or area matters more than a laptop's serial).

## Consequences

- A new workspace goes from empty to usable in a few minutes, with
  sensible defaults it can rename.
- Templates are code, not data: adding one means a new entry in
  `templates.ts` and its copy in the locale files.
- `tenants` gains `setup_completed_at` and `setup_template`. Existing
  workspaces have `setup_completed_at` null, so their admins see the
  reminder once. "It's already set up" dismisses it.

## Verified

- `apps/api/test/setup.test.ts` (8 tests):
  - the status report;
  - Spanish renames the seeded statuses but not one an admin renamed;
  - changing the language keeps the other email settings;
  - a preset writes the right days and hours in the right time zone;
  - an unknown time zone is rejected;
  - completing is recorded;
  - the manufacturing template creates exactly its teams, fields (with
    options), SLAs, macros (with the real pending status id) and catalog
    items, in Spanish;
  - a second run and a pre-existing urgent SLA are left untouched;
  - with business hours, only urgent SLAs run around the clock.
- `apps/api/test/auth-self-hosted.test.ts`: a workspace registered in
  Spanish starts with Abierto/Pendiente/Resuelto/Cerrado and Spanish
  emails.
- In the browser, a new registration landed on `/setup`:
  1. Chose "Jornada temprana" in America/Santiago.
  2. Opened "Otro proveedor", where a gmail.com address filled in
     `imap.gmail.com`, and came back through "Volver al asistente".
  3. Applied "Planta / manufactura", which reported 3 teams, 4 SLA
     targets, 4 saved replies, 2 fields and 4 catalog items.
  4. Skipped the team step.
  5. Finished on the dashboard with no reminder left.

  The statuses read Abierto, Pendiente, Resuelto, Cerrado. No console
  errors.
