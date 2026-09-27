# ADR 0071: Team management, and the notification events built on it

## Status

Accepted, implemented.

## Context

A usability review of a fresh tenant found that teams existed only as a
read-only list. Registration seeds a "General" team, tickets, macros and
process steps can point at a team, but nothing could create, rename or delete
one, and a team had no members. The "Team" field on a ticket was therefore
a dropdown with a single option.

The same review asked for more notification events, one of which is "a
ticket landed in my team". That needs to know who is in a team.

## Decision

### Part 1: teams with members

- **`team_members`** is a plain join table (`team_id`, `user_id`, unique
  together), tenant-scoped with the usual RLS policy. A person can be in any
  number of teams. Deleting a team or a user cascades to its memberships.
- **API**: `POST /teams`, `PATCH /teams/:id` and `DELETE /teams/:id` join the
  existing `GET /teams`, which now also returns `memberIds` and
  `ticketCount`. Writing is `tickets:manage_all`, the tier of macros and SLA
  policies. `memberIds` on a PATCH replaces the whole list, which is what a
  checkbox list in the UI sends anyway.
- **Names are unique per tenant, ignoring case.** "Redes" and "redes" would
  be indistinguishable in a dropdown.
- **Deleting a team keeps its tickets.** The existing foreign keys from
  tickets and process step templates are `ON DELETE SET NULL`, so they just
  lose the team. The confirmation says how many tickets that affects.
- Every write is recorded in the audit log (`team.created`, `team.updated`,
  `team.deleted`).
- **Console**: Administration → Teams lists teams with their member avatars
  and ticket count, and a modal edits the name and members, with a search
  box once there are more than a handful of people.

### Part 2: workspace defaults and five new events

**Workspace defaults.** Notification preferences were per user, with a
built-in default of "in-app on, email off". A company that wants everyone
emailed on assignment had to ask each person to tick a box.
`tenant_notification_defaults` (one row per event, RLS-scoped) holds what
an admin chose for the workspace. What a user gets is resolved in order:

1. their own `notification_preferences` row, if they made a choice;
2. the workspace default, if an admin set one;
3. the built-in default.

`resolveNotificationPreference` in `@seredina/db` does this for both
`notifyUser` copies (API and worker), so they can't drift apart. Changing
only one field of your own preference keeps the other at whatever you had
been getting, workspace default included. `DELETE
/notification-preferences/:eventType` drops your choice and goes back to the
workspace default. `GET`/`PUT /notification-defaults` are `users:manage`.

The existing `PUT /notification-preferences/:eventType` only accepted two of
the three events, so the contract-expiry preference could never be saved.
It now accepts every event.

**Who hears about a ticket.** `ticketNotificationRecipients`: the assignee;
if there is none, every member of the ticket's team; never the person who
caused the event. The events:

| Event | Fires when | From |
|---|---|---|
| `TEAM_TICKET` | a ticket's team changes to a team and it has no assignee after the change | `updateTicket` (console, macros, AI triage) |
| `TICKET_REOPENED` | a customer reply lands on a RESOLVED or CLOSED ticket | email ingest (worker), portal (API) |
| `MENTIONED` | an agent's internal note names people in `mentionedUserIds` | `addMessage` |
| `SLA_WARNING` | 80% of a first-response or resolution window has passed, target still open | SLA worker |
| `SLA_BREACHED` | the target's due-at passes, target still open | SLA worker |

Details:

- **Reopening**: a customer reply used to reopen only CLOSED tickets. A reply
  to a RESOLVED ticket stayed resolved, so the agent never looked at it
  again. Both now reopen, through one shared `reopenOnCustomerReply`. It
  keeps `resolvedAt`, which records the first resolution for reporting. A
  reopen sends `TICKET_REOPENED` instead of `NEW_REPLY`, not both.
- **Mentions** are explicit ids from the console, not parsed from text on
  the server: the composer offers colleagues after `@`, inserts "@Full
  Name", and sends the ids of every name still in the text. The server
  ignores ids that aren't users of the tenant, the author, and mentions on
  a public reply, since a mention is between colleagues.
- **SLA warning**: when the clock starts (ticket creation or a priority
  change), a second delayed job is scheduled at 80% of the window, next to
  the existing breach check. It carries the due-at it was scheduled for; if
  the ticket's due-at has changed since, the job is stale and does nothing
  (the new schedule has its own warning). The fraction is wall-clock time,
  so with business hours it is an approximation.
- **Self-notification**: assigning a ticket to yourself, or moving it to a
  team you're in, no longer notifies you. `updateTicket` takes the acting
  user for this; macros and the console pass it.
- In-app bodies and email subjects follow the tenant's email language, like
  the existing notifications.

## Consequences

- Teams are now something an admin sets up, so the first-run setup can
  create them (a later change).
- Membership is only used for notifications. It does not restrict which
  tickets a person can see; that stays with roles and permissions.

## Verified

- `apps/api/test/notification-events.test.ts` (15 tests): the event list
  and its defaults; workspace default applied, overridden, and restored by
  reset; partial update keeps the workspace value; in-app off by default
  writes no row; defaults are per tenant; team members notified except the
  actor, not when an assignee is set in the same change or the team is
  unchanged; no self-assignment notice; mentions reach the named colleague
  (with the author's name) but not the author, unknown ids, or public
  replies; a portal reply to a resolved ticket reopens it and sends
  TICKET_REOPENED instead of NEW_REPLY; an email reply to a closed,
  unassigned ticket reopens it for the whole team; a reply to an open ticket
  stays NEW_REPLY; the SLA warning carries the time left and skips stale or
  met targets; a missed target on an unassigned ticket reaches the team.
- In the browser: turning on "email when assigned" as the workspace default
  showed up on the admin's own row as "Valor de la organización". In an
  internal note, typing "@bru" offered Bruno Rojas, Enter inserted "@Bruno
  Rojas", and after sending, Bruno's bell showed "Ana Admin te mencionó en
  una nota de la solicitud #1".
- `apps/api/test/teams.test.ts`: create with members (duplicates collapsed),
  case-insensitive name clash, rename and replace members, a user of another
  tenant rejected as a member (and the other tenant sees none of these
  teams), deleting a team leaves its ticket in place without a team.
- In the browser: created "Soporte N1" with a member from the new page; the
  list shows "1 miembro · 0 tickets" with the member's avatar.
