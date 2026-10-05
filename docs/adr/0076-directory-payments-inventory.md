# ADR 0076: Directory, contract payments and full IT inventory

## Status

Accepted, implemented.

## Context

Three gaps came up together when preparing for production:

- **People outside the help desk.** `Contact` holds the people who write
  in. It needs an email (it's how they're matched), it's subject to
  automatic retention, and it has no company, title or phone. A supplier's
  account executive or a billing contact didn't fit there.
- **Contract payments.** Contracts had a cost and a billing period, and a
  renewal reminder before the end date. Nothing reminded anyone to *pay*
  a monthly link or a yearly support contract. The supplier was free text.
- **Inventory beyond computers.** Assets had six types (server,
  workstation, network device, printer, mobile, other). Monitors, docks,
  switches, access points or UPSs had no type of their own. There was no
  asset tag, location, owner, purchase data, or record of what plugs into
  what.

## Decision

### A directory separate from contacts

- **`organizations`**: a company. It has a type (supplier, customer,
  partner, internal, other), a tax ID, contact details and notes. Names are
  unique per tenant.
- **`directory_contacts`**: a person, optionally at an organization. It
  has a job title, an area (executive, management, sales, technical,
  support, billing, other), email, phone, mobile and notes. Only the name
  is required.

Both are RLS-scoped like every tenant table. They're readable with
`tickets:read` and editable with `contacts:manage`.

Directory people are deliberately not `Contact` rows:
- contact retention must never erase a supplier's executive;
- an optional email can't be the matching key that inbound mail relies on.

Deleting an organization sets its people's, contracts' and assets' link to
null rather than deleting them. Audit entries carry ids only, as for
contacts.

### Contracts: supplier links and a payment schedule

Contracts gain two directory links, `organization_id` and `contact_id`.
The old free-text `supplier` stays for contracts entered before, and the API
returns `supplierName` = the organization's name, else that text.

The payment schedule:
- `payment_frequency`: one_time, monthly, bimonthly, quarterly, semiannual
  or yearly; null = not tracked.
- `next_payment_date`.
- `payment_amount`: optional, defaulting to the cost.
- `payment_reminder_days`: default 5.
- `payment_reminder_emails`.

`contract_payments` is the history. Recording a payment:
1. Settles the pending due date.
2. Moves the contract to the next due date, keeping the day of the month
   from the start date, clamped to short months. A contract paid on the
   31st is due on Feb 28, then Mar 31, instead of drifting to the 28th.
3. Moves a one-time payment to no next date at all.

Undoing a payment deletes the entry but leaves the date as it is: an admin
fixes the date by hand if needed.

**Reminders.** The worker's contract loop (every 6 hours, under the
existing lock) also runs `sendDuePaymentReminders`:

- **Finding them.** `list_contract_payments_due()` is a SECURITY DEFINER
  function returning ids only. It lists contracts whose next payment is
  inside the reminder window, or already past.
- **Sending once.** Each reminder is claimed atomically by setting
  `payment_reminder_sent_for` (or `payment_overdue_sent_for`) to the due
  date. So there's one "coming due" and one "overdue" reminder per due date,
  and recording a payment re-arms both for the next date with no extra
  state.
- **Recipients.** The reminder addresses get a branded email: the tenant's
  language and look from ADR 0070, without the customer portal or banner.
  Users with `assets:manage` get a new `CONTRACT_PAYMENT_DUE` notification.
- **Wording.** Amounts and dates are written the way the tenant's language
  writes them ("US$1.200,5", "8 de octubre de 2026").

### Inventory

**New types.** `AssetType` gains:
- laptop, tablet;
- switch, router, firewall, access point;
- storage, UPS;
- monitor, peripheral, docking station;
- scanner, projector, IP phone, camera.

`packages/shared/src/assetTypes.ts` groups them (computers, network,
peripherals, infrastructure, other) for validation and the console
(mirrored in `apps/web/src/lib/assetTypes.ts`). The asset list filters by
group.

**New asset fields:**
- `asset_tag` and `location`;
- `assigned_contact_id`: the employee using it, a `Contact`;
- `parent_asset_id`: what it plugs into. A loop is refused.
- `purchase_date`, `purchase_cost`, `purchase_currency`, and `supplier_id`
  (an organization);
- `warranty_end_date`;
- `notes`.

**Automatic classification:**
- The network scan's classifier checks specific markers before the
  operating system: a NAS or UPS card running Linux used to be filed as a
  server. It now recognizes switches, routers, firewalls, access points,
  storage, UPS, IP phones and cameras.
- The agent's reported form factor files laptops and tablets as such. It
  only refines the enrollment default `WORKSTATION`, never a type an admin
  picked.
- The monitors the agent reports become `MONITOR` assets connected to the
  computer, matched by EDID serial. A monitor that moves follows its new
  computer. A serial that's missing or meaningless ("0", blanks) is skipped,
  since there'd be no telling those monitors apart. An unplugged monitor
  stays in the inventory.

## Consequences

- The console has a new **Directory** page (companies and people).
  Contracts pick their supplier and contact from it, and assets their
  supplier.
- The **Contracts** page:
  - counts payments due soon and overdue;
  - filters by payment status;
  - records payments and shows their history.
- **Notifications.** Notification preferences have a new event, *Contract
  payment due*.
- **Reminder accuracy.** Reminders are date-granular and run every 6 hours,
  so a reminder can arrive up to 6 hours into its day.
- **Contacts.** A contact's page lists the equipment assigned to them.
- **Not in scope.** Warranty end dates on assets don't send reminders.
  Warranty contracts already do.
