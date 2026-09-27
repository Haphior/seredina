# SLA & Escalation

## SLA policies

From **Settings → SLA Policies**, you define, per priority
(Low/Normal/High/Urgent), how long the first response and the
resolution may take, in minutes, hours or days. Each priority has its own
policy — an urgent ticket typically has much tighter deadlines than a
low-priority one. **Fill in suggested targets** proposes a common starting
point for the priorities you haven't set (Urgent: 15 min / 4 h, High: 1 h /
8 h, Normal: 4 h / 2 days, Low: 8 h / 5 days); **Save changes** saves every
priority you edited at once.

Each policy has a **business hours only** toggle: when on, the time
count pauses outside the schedule configured in **Settings → Business
Hours** (timezone and windows per day of the week) — an urgent ticket
opened on a Friday night doesn't start "aging" until the office reopens.

## How it shows up on a ticket

In a [ticket detail's properties panel](/guide/tickets#the-properties-panel),
if an SLA policy applies, it shows when the first response and resolution
were met (in green) or when they're due if they haven't happened yet (in
red if already overdue). In the ticket queue, a clock icon next to the
subject flags tickets with a breached SLA, without needing to open each
one.

## Escalation

Escalation is a chain of tiers (**Settings → On-Call & Escalation**),
each with its own wait time. A tier can point at a specific person or at
an [on-call schedule](#on-call) — if nobody acknowledges within the
current tier's time, it automatically moves to the next one.

A ticket with active escalation shows a banner in its detail view with an
**Acknowledge** button — any agent with access can acknowledge it, which
stops it from advancing to further tiers. If every tier is exhausted
without anyone acknowledging, the escalation lands in an exhausted state —
a dead end in this version, it doesn't retry.

## On-call

An on-call schedule defines who's on duty at any given moment — an
escalation tier can point at a schedule instead of a fixed person, so the
alert always reaches whoever's on call that week, without having to
reconfigure the escalation chain every time the rotation changes.
