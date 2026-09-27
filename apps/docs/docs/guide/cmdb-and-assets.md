# CMDB & Assets

Seredina's CMDB has three related but distinct screens: **Assets** (the
inventory itself), **Devices** (the endpoint agent that feeds it
automatically), and **Equipment Catalog** (the hardware models you can
assign to an asset).

## Assets

Each row is a server, workstation, network device, printer, or mobile
device — with type, status, IP, hostname, serial number,
manufacturer/model, and operating system. An asset can be linked to the
tickets that affect it (from the ticket itself, see
[Tickets](/guide/tickets#the-properties-panel)), building up a history of
what problems each piece of equipment had.

### How an asset reaches the inventory

- **Manual** — created by hand from **New Asset**.
- **Agentless discovery** — scanning a network range (TCP + SNMP) from
  the Assets screen itself. Finds whatever responds on the network,
  without installing anything on the target machine — with that
  technique's logical limitations: if a machine has its firewall closed
  or SNMP disabled, it won't show up.
- **Agent** — see [Devices](#devices) below. Brings more detail than
  agentless discovery because it runs *inside* the machine, not from the
  outside.

## Devices

**Devices** is where you generate the install command for the
[Seredina agent](https://github.com/Haphior/seredina-agent). It's a single
binary for Windows, macOS and Linux (x86-64 and ARM64), and it runs as a
service. Every hour it reports:

- Hardware and software inventory, and the OS version.
- Whether the disk is encrypted.
- Antivirus status.
- The devices it sees on its local network.

To add a device:

1. Click **Generate enrollment command**.
2. Pick the device's operating system.
3. Run the command there as administrator. It's valid for 15 minutes, and works once.

| System | Where to run it |
|---|---|
| Windows | PowerShell, opened as administrator |
| macOS / Linux | A terminal (it uses `sudo`) |
| Already downloaded | The agent's folder, for a device without internet access |

The command downloads the agent, checks its SHA-256, enrolls the device,
and starts the service. If your server uses a private certificate, the
command also carries its CA. The agent then trusts only that CA, and never
turns off certificate verification.

If your devices can't reach GitHub, copy a release's files (`install.sh`,
`install.ps1`, the archives and `SHA256SUMS`) to an internal web server.
Set `AGENT_DOWNLOAD_URL` in `.env` to that folder's address. The commands
then download from there.

`seredina-agent status` shows whether a device is enrolled and whether the
service is running. `seredina-agent uninstall --purge` removes the agent.
To update the agent, run `seredina-agent update` as administrator: no
token needed, and the device keeps its record. See
[Updating the agents](/deployment/updates-and-backups#updating-the-agents).

### What the agent reports

Every hour the agent sends a full inventory. On the asset's page it's
split into tabs, and **Download JSON** saves all of it:

| Tab | What's in it |
|---|---|
| Overview | Manufacturer, model and serial number; OS and build; CPU; memory; last boot; logged-on user; domain; IPs. Warnings for a pending reboot, an unencrypted disk, no active antivirus, or pending security updates. |
| Hardware | BIOS/UEFI; each memory module (slot, size, type, speed, serial); graphics; monitors with their serial; batteries with their health and cycles; printers. |
| Storage | Physical disks (SSD, HDD or NVMe, bus, serial, health) and volumes (filesystem, free space, encryption). |
| Network | Each adapter with its MAC, IPs, gateway, DNS, DHCP and speed. |
| Software | Every installed program with its version, publisher and install date, with a search box. |
| Security | Disk encryption, firewall, Secure Boot, TPM, UAC/SELinux/Gatekeeper, antivirus products and their state, security agents running (EDR), local administrators. |
| Updates | Installed updates (Windows KBs, macOS updates) and, on Linux, pending ones. |
| Services, Ports | For servers: each service's state and start mode, and what listens on which port. |
| Roles and VMs | Windows Server roles and recognized server software (SQL Server, IIS, PostgreSQL, nginx, Docker...), and the VMs and containers the machine hosts (Hyper-V, Proxmox, libvirt, Docker). |

The manufacturer, model, serial number and operating system also fill the
asset's own fields, so **Assets** search finds a machine by its serial.

### Servers

The agent works the same on servers: Windows Server 2012 or later, and
any Linux with systemd (Ubuntu, Debian, RHEL, Rocky, Alma, SUSE...).
A server is filed as **Server** on its own:

- **Windows:** the Server editions.
- **Linux:** machines without a graphical session.

If you change an asset's type by hand, your choice sticks. It only
changes again if the machine's role really does change (for example,
it's reinstalled as a workstation).

To see the inventory without sending it (for a machine you're checking,
or to attach to a ticket), run `seredina-agent inventory` as
administrator.

::: warning Inventory-only, by permanent design
The agent **never executes anything remotely** — no scripts, no software
deployment. This isn't a temporary limitation of this version: remote
execution needs an audited, signed delivery path this unfunded
open-source project has no way to responsibly maintain. Agent releases
aren't code-signed yet, either: SmartScreen or Gatekeeper may warn if you
open the binary by hand, but the install commands aren't affected. See the
[MVP tour](https://github.com/Haphior/helpdesk-seredina) for the full
reasoning.
:::

Every enrolled device also shows up under **Assets**, tagged "AGENT" as
its discovery source — it's the same inventory, just with an extra column
showing where the data came from. Revoking a device from this screen cuts
off its future check-ins without deleting its already-saved history.

## Contracts, warranties and licenses

**CMDB → Contracts** tracks support contracts, warranties, software
licenses, leases and subscriptions: supplier, contract or order number,
start and end dates, cost (one-time, monthly or yearly, in any currency),
seats for licenses, and the assets each one covers. An asset's page lists
the contracts that cover it.

Each contract shows whether it's active, ending soon, or expired. The page
header totals what's ending soon, what has expired, and the recurring cost
per year for each currency. **Remind days before** (30 by default) controls
the renewal reminder: once a contract enters that window, everyone whose
role can manage assets gets a *Contract ending* notification, in-app and by
email if they turned it on in their notification preferences. There's one
reminder per end date; changing the end date (a renewal) re-arms it.

Don't put license keys in these fields. They're visible to anyone who can
see assets, and included in data exports.

## Equipment Catalog

A catalog of manufacturers and hardware models (for example, "Dell" →
"Latitude 5540") — separate from individual assets. Assigning a catalog
model to an asset pre-fills its default type, but the asset keeps its own
independently editable type field: the catalog suggests, it doesn't
force.
