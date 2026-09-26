# ADR 0069: Full agent inventory, for workstations and servers

## Status

Accepted, implemented. Needs agent v0.2.0 or later
([Haphior/seredina-agent](https://github.com/Haphior/seredina-agent)).

## Context

The agent (ADR 0047, ADR 0068) reported a summary: the CPU model, total
memory, disks, an OS string, whether the disk was encrypted, antivirus
on/off, and package names. That's far less than what an IT team gets from
GLPI-Agent or Lansweeper, and what it needs to answer everyday questions:

- Which laptops are under warranty? That needs the serial number.
- Where's the memory to upgrade? That needs the free slots.
- Which machines don't run our EDR?
- Which servers listen on port 3389?
- Which hosts run SQL Server?
- Which VMs live on which Hyper-V host?

Servers made the gap wider. A server asset needs its services, its
listening ports, its roles, the guests it hosts, and whether a reboot is
pending, and it needs to be filed as a server rather than a workstation.

## Decision

### The agent sends a full inventory, next to the old summary

Check-ins carry a new `inventory` object with `schema: 2`:

- **system:** manufacturer, model, serial, UUID, BIOS, form factor, role,
  hypervisor, domain and timezone.
- **os:** name, version, build, install date, last boot, and whether a
  reboot is pending.
- **Hardware:** CPU counts; memory modules with slot, type, speed, serial
  and part number; physical disks with type, bus, serial and health;
  volumes with filesystem and encryption; network adapters with IPs,
  gateway, DNS and DHCP; GPUs; monitors (from EDID); batteries with wear
  and cycles; printers.
- **Users:** logged on, last logon, local administrators, local accounts.
- **Security:** antivirus products with enabled and up-to-date state, the
  EDR/security agents found running, firewall, disk encryption, Secure
  Boot, TPM, and OS protections (UAC, SELinux, AppArmor, Gatekeeper, SIP).
- **Software:** with publisher, install date and architecture.
- **Updates:** installed hotfixes, and pending updates from the package
  manager's local cache. The agent never downloads anything.
- **For servers:** services, listening ports with their process, roles
  (Windows roles, plus recognized server software such as SQL Server,
  PostgreSQL, IIS, nginx or Docker), and guests (Hyper-V, libvirt,
  Proxmox, Docker, Podman).

The agent still fills the summary fields, derived from the same data, so
older Seredina servers keep working. A newer server ignores nothing it
already understood.

### One JSON document per asset, plus the searchable columns

`assets.agent_inventory` (JSONB) stores the document whole, replaced on
every check-in, with `agent_inventory_at`. It is not split into tables:

- The parts are read together, on the asset's page.
- A per-part table (modules, disks, services, ports...) would multiply
  migrations every time the agent learns a field.

What people search and filter by is copied into the existing columns:
`manufacturer`, `model`, `serialNumber` and `operatingSystem`. Asset
search now also matches serial numbers and models. An empty value from
the agent never overwrites one an admin typed.

Asset lists use Prisma's `omit` (the `omitApi` preview feature) to leave
`agent_inventory` and `installed_packages` out. A server's document can
run to a few hundred kilobytes, and a list page doesn't need it.

### Validation that can't cost a check-in

`inventorySchema.ts` validates the document with the agent's own limits,
for example 2,000 software entries, 1,000 services and 500 ports. Unknown
keys are dropped, so a newer agent never fails against an older server.

If the inventory doesn't validate, the summary is still stored. The
response says `inventory: "rejected"` with the reason, and the agent logs
it. The check-in route accepts bodies up to 5 MiB; the global limit
stays at 1 MiB.

### Servers are filed as servers, without overriding people

The agent reports `system.role`:

- **Windows:** server when `ProductType` is 2 or 3.
- **Linux:** workstation when a display manager or desktop session is
  running, or the chassis is a laptop; server otherwise.
- **macOS:** always a workstation.

`devices.reported_role` remembers the last role. The asset's type changes
only when the reported role changes, so a type an admin set by hand
sticks. The first report only moves the enrollment default (WORKSTATION).

## Consequences

- An asset's page shows the inventory in tabs. Each tab appears only when
  the agent sent data for it. The full JSON can be downloaded.
- Assets enrolled with an older agent keep the previous summary card
  until the agent is updated.
- The document is a snapshot: what changed between check-ins (software
  installed, a disk replaced) isn't kept yet. A history would store diffs
  per check-in. It is left for later, when there is a concrete report
  that needs it.

## Verified

- **Agent unit tests:**
  - Real output samples for every parser: lsblk (both JSON styles),
    dmidecode, /proc/cpuinfo and lscpu (x86 and ARM), ss, lsof,
    systemctl, lspci, EDID, apt, dnf, rpm, dpkg, snap, docker, virsh,
    Proxmox, system_profiler, launchctl, softwareupdate.
  - A Spanish Windows Server with Hyper-V.
  - The round trip of the encoded Windows script.
- **CI on real GitHub runners**, collecting as administrator/root:
  - Windows Server 2025: 259 services, 53 ports, and the IIS, Hyper-V
    and Docker roles, in about 10 seconds.
  - macOS 26: applications with their publisher, and XProtect,
    Gatekeeper and SIP.
  - Ubuntu.
- **Seredina API tests** (`agent-inventory.test.ts`):
  - Stored document and copied columns.
  - An empty value never erases an admin's.
  - Role and asset type rules, including a manual type that sticks.
  - Lists omit the document.
  - Search by serial number and model.
  - Over HTTP: stored, none, rejected with a reason and the summary
    kept, unknown keys dropped, a body over 1 MiB accepted, and the
    software cap enforced.
- **By hand:** the Go agent enrolled and checked in against the real API
  and Postgres, and the asset page was reviewed in the browser in Spanish.
