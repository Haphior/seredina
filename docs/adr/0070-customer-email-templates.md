# ADR 0070: Customer email templates: branded, editable, in the company's language

## Status

Accepted, implemented.

## Context

Replies to customers went out as the agent's plain text. The From line was a
bare address, and the subject was fixed. There was no signature, no logo and
no quoted history. Nothing went out when a request arrived. Resolving a
ticket sent one hardcoded English line with the survey link. The portal
sign-in, password reset and invitation emails were also hardcoded in English.

A company that works in Spanish can't send its customers English text. It
also wants those emails to look like its own: its logo, its color, its
signature, its wording.

## Decision

### One layout for every email Seredina sends

`packages/shared/src/emailTemplates.ts` renders every email. It is pure code,
shared by the API (ticket events, previews, simple notices) and the worker
(agent replies at send time), so both produce the same email.

- **HTML**: tables and inline styles, which is what Outlook, Gmail and Apple
  Mail all render the same way.
- **Header**: an accent bar in the tenant's color, then its logo, or its name
  in that color. The color comes from Branding. The logo is the one set for
  emails, falling back to the Branding logo.
- **Banner**: an optional wide image under the header, optionally a link.
  It is shown 600 px wide; 1200 × 400 px is recommended.
- **Card**:
  - a "Request #N · subject" label;
  - the message;
  - the agent's signature and the company signature;
  - an optional button (the survey, a sign-in link);
  - the customer's last message, quoted.
- **Footer**: how to reply, the company name and a link to the customer
  portal (when it's on).
- **Below the card**: a small "Powered by Seredina" link.

Every email has a plain-text part with the same content. Everything typed by
people is escaped before it goes into the HTML. A URL the layout uses (logo,
button, portal) must be plain http(s), and a color must be `#rrggbb`. Anything
else is dropped.

### Language

`tenants.email_settings.language` is `es` (the default) or `en`. Every word
Seredina writes on the tenant's behalf is in that language:

- the default templates;
- the layout's fixed text (the label, the reply hint, the survey button,
  "wrote:", the footer);
- the portal sign-in, password reset and invitation emails;
- agent notifications (assigned, new reply, contract ending);
- merge notices;
- "(no subject)" and the note about attachments not saved;
- the first message of a service catalog request.

### Events and templates

Four events, each with a default subject and body per language. A tenant can
override one in `email_templates`, one row per event (no row = the default):

| Event | Default | Sent when |
| --- | --- | --- |
| `ticket_created` | on | A customer opens a request by email, in the portal or the catalog |
| `agent_reply` | always | An agent replies publicly; `{{message}}` is the reply |
| `ticket_resolved` | on | The ticket first lands on a RESOLVED status |
| `ticket_closed` | off | The ticket is closed |

On CLOSED, the "closed" email goes out if it's on. Otherwise "resolved" goes
out, for a ticket that skipped straight to closed. The satisfaction survey
rides on whichever email goes out, as a button. When the tenant turns off the
"resolved" email, the survey goes with it.

Templates use `{{variables}}`: `company`, `contact.name`, `contact.email`,
`ticket.number`, `ticket.subject`, `agent.name`, `message` (replies only) and
`portal_link`. Saving a template with a variable its event doesn't offer is
refused. A reply template without `{{message}}` is refused too.

### Ticket events are messages

An event creates a SYSTEM message through `addMessage`, the same path the
survey message took before. It shows in the timeline and reaches the
customer however the ticket's channel does: email, telegram, the widget or
the portal.

The message body is the rendered text with any link spelled out.
`messages.email_meta` keeps the rendered subject, the body and the button,
which the worker lays out as the branded email. People's replies have no
`email_meta`. The worker renders them through the tenant's reply template at
send time.

### The acknowledgement never answers a machine

The worker marks inbound mail as automatic when it has any of:
- `Auto-Submitted` other than `no`;
- `Precedence: bulk/junk/list`;
- `X-Autoreply` / `X-Autorespond`;
- a `List-Id`;
- Exchange's `X-Auto-Response-Suppress`;
- a mailer-daemon, postmaster or no-reply sender.

Such mail still becomes a ticket or a reply, but gets no acknowledgement.
Seredina's own automatic emails carry `Auto-Submitted: auto-replied` (the
acknowledgement) or `auto-generated`, so a well-behaved autoresponder on the
other side stays quiet. The acknowledgement is sent at most once per ticket,
even when its job is retried.

### Logo and banner

The logo and banner can be uploaded in the console or given as the address
of an image hosted elsewhere.

- **Uploads** go to `email_images`, one row per tenant and kind. They must
  be PNG, JPG or GIF (checked by the file's first bytes, not its name) and
  2 MB at most. SVG is refused: Gmail and Outlook don't show it, and it can
  carry script.
- **Serving**: `GET /public/:tenantSlug/email-images/:kind` serves the image
  with no session, since mail clients and Gmail's image proxy have none.
  Only these two images are reachable there.
- **URL**: the email settings store the image's absolute URL, built from
  `API_PUBLIC_URL`, or `WEB_ORIGIN` + `/api`. The URL carries a hash of the
  image, so a new upload gets a new URL that no cache has seen.
- **Reachability**: the recipient's mail client has to reach that address. A
  server only reachable inside the company network shows the images to
  internal recipients only. External customers need a public address, or an
  image hosted elsewhere.
- **Agent notifications** keep the logo but not the banner.

### Sender and signatures

`email_settings.sender_name` names the From line: "Soporte TI" <soporte@…>.
It defaults to the tenant name.

There are two signatures:
- a company signature under every email, set in the email settings;
- each agent's own `users.email_signature` under their replies (their name
  when empty).

### Replies go to portal and catalog requests too

Replies used to be emailed only for tickets that came from email or the
portal. They now also go out for tickets requested from the service catalog,
where the customer gave their email to be answered.

### Console

Administration → Customer emails (`channels:manage`) has:
- the general settings;
- one card per event, with an enable switch, subject and body, clickable
  variables, restore default, a live preview with sample data (a sandboxed
  iframe) and "send me a test".

Account security has each agent's signature.

## Consequences

- Existing tenants switch to Spanish emails on upgrade, including the survey
  message. A tenant that wants English sets the language to English.
- A resolved ticket now always tells the customer it was resolved, even
  without `WEB_ORIGIN` (just without the survey button).
- `WEB_ORIGIN` is now also given to the worker, for the portal link in
  emails.
- Contact erasure also clears `email_meta`, which holds a rendered copy of
  the customer's name and subject.
- On-call escalation notes are internal and still in English.
