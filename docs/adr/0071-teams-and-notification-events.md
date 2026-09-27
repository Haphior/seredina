# ADR 0071: Team management, and the notification events built on it

## Status

Accepted. Part 1 (teams) implemented; part 2 (notifications) follows in the
same series of changes.

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

## Consequences

- Teams are now something an admin sets up, so the first-run setup can
  create them (a later change).
- Membership is only used for notifications. It does not restrict which
  tickets a person can see; that stays with roles and permissions.

## Verified

- `apps/api/test/teams.test.ts`: create with members (duplicates collapsed),
  case-insensitive name clash, rename and replace members, a user of another
  tenant rejected as a member (and the other tenant sees none of these
  teams), deleting a team leaves its ticket in place without a team.
- In the browser: created "Soporte N1" with a member from the new page; the
  list shows "1 miembro · 0 tickets" with the member's avatar.
