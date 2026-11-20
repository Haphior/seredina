# ADR 0078: Mobile inventory: an Android agent, phone lines and handover forms

## Status

Accepted, implemented.

## Context

Phones and tablets could only be entered by hand, as `MOBILE_DEVICE` or
`TABLET` assets. A company handing out phones also needs to know which
line (SIM, number, plan, cost) is in which phone and who has it, and a
signed handover form (acta de entrega) when equipment changes hands.

The PRD and the roadmap rule out becoming an MDM: enrolling as an Android
Enterprise device owner or an Apple MDM is a separate product, with
signing, push certificates and remote-control surfaces this project
can't maintain responsibly. That still holds. The question was how much
inventory a phone can report *without* being an MDM.

## Decision

### An Android app that only reports

`apps/agent-android` is a small Kotlin app (no AndroidX, one dependency:
zxing for the QR scanner). It uses the desktop agent's two endpoints,
`POST /v1/devices/enroll` with `platform: 'android'` and
`POST /v1/devices/checkin`, every 6 hours through `JobScheduler`. It sends
schema 2 inventory plus a `mobile` section: device name, brand, security
patch, API level, SIMs (carrier, country, number), screen lock, developer
options, USB debugging, a root heuristic, battery and storage. It also
sends the apps the user installed.

What it can't do, by Android's rules: since Android 10 an ordinary app
can't read the IMEI or the serial number. `assets.imei` is a column people
type into (the console tells them `*#06#`). It never sends photos,
messages, contacts or location, and it has no command channel at all.

- **Type.** An Android device enrolls as `MOBILE_DEVICE`. Its form factor
  (`phone` or `tablet`, from the smallest screen width) is stored in
  `devices.reported_role` and moves the type the way a desktop agent's
  role does: only on a change, so a type an admin set sticks.
- **Fingerprint.** `sha256("android:" + ANDROID_ID)`. ANDROID_ID is scoped
  to the app's signing key, which is why releases must keep the same key.
- **No iOS app.** iOS gives an app nothing of the inventory without an MDM
  profile. iPhones are entered by hand; lines and handovers work the same.

### Enrollment by QR, with the private CA pinned by hash

The Devices page gets an **Android** choice that shows two QR codes: the
APK's download URL, and
`seredina://enroll?s=<server>&t=<token>&p=<sha256 of the CA PEM>`. A
desktop command carries the whole CA; a QR code that has to scan off a
monitor shouldn't. So the phone downloads the CA from a new public
endpoint, `GET /v1/devices/ca.pem` (the same file `TLS_CA_FILE` points
to, refused if it holds a private key, 404 without one), over a
connection that accepts any certificate *for that one request*, and keeps
the CA only if its sha256 equals `p`. From then on it trusts only that CA.
Without `p`, the phone's own trust store applies.

### Distribution: the APK ships with Seredina's releases

`release.yml` builds the APK and attaches `seredina-agent-android.apk` and
its sha256 to the GitHub release. `/devices/agent-setup` returns
`androidApkUrl`: the `AGENT_DOWNLOAD_URL` mirror when set, else
`releases/latest/download`. It's signed with the `ANDROID_KEYSTORE_*`
secrets. Without them the job signs with a one-off key and warns:
installable, but Android refuses an update signed with a different key,
so phones would have to uninstall first (and re-enroll, since
ANDROID_ID changes with the key). Google Play isn't used: the app asks
for `QUERY_ALL_PACKAGES`, which Play restricts, and an internal tool
doesn't need a store listing.

### Phone lines

`mobile_lines` holds a number (unique per tenant), status (active,
suspended, cancelled), carrier (an `organizations` row), plan, data
allowance, monthly cost and currency, ICCID, contract end date, the
carrier `contracts` row, the phone (`asset_id`) and the person
(`assigned_contact_id`). Payments and reminders stay on the contract
(ADR 0076): a line points to it rather than duplicating a schedule.

When a check-in reports a SIM number, the line with that number (compared
by digits, with or without the country code, at least 8 digits) is
linked to the phone, even if it was linked to another phone. Check-ins
never create lines (an unknown number may be a personal SIM) and never
unlink them (most SIMs don't report their number).

### Handover records and the printed form

`asset_handovers` records a delivery or a return: asset, person, date,
condition, accessories, notes, the line handed over with it, and who
recorded it (the name is copied, so the form survives that user's
removal). Recording one moves the assignee: a delivery assigns the asset
(and the line) to the person; a return clears both. A return without a
person comes back from the current assignee. Deleting a record leaves the
assignee as it is. `/handovers/:id/print` is a console page outside the
layout, in the console's language, with the logo uploaded for customer
emails, a statement, and signature lines (name and RUT/ID).

Both tables are tenant-scoped with the usual RLS policy. Lines and
handovers use `assets:read` / `assets:manage`. Creating, changing and
deleting lines, deliveries, returns and deleted records are audited.

## Consequences

- Phones show up in the CMDB with real data (patch level, screen lock,
  apps) without an MDM, and the help desk can see which line is where.
- The CA download is the one place the app accepts an unverified
  certificate. It's bounded by the hash from the console, the same trust
  the desktop command's embedded CA relies on.
- A stable signing key is now a release secret to keep. Losing it means
  every phone reinstalls and re-enrolls.
- The Android build runs only in CI (`android-agent.yml` on changes,
  `release.yml` for releases); the API and console don't depend on it.
