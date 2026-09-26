import { z } from 'zod';

/**
 * The agent's full inventory, schema 2 (docs/adr/0069-full-agent-inventory.md;
 * the agent's internal/inventory/details.go is the other side). Every field
 * is optional: an agent fills what its OS and permissions give it. Limits
 * match the agent's own caps, so a well-behaved agent never trips them;
 * they're here so one misbehaving device can't store an unbounded document.
 * Unknown keys are dropped (zod's default), so a newer agent's extra fields
 * never fail a check-in against an older server.
 */
const text = (max = 200) => z.string().max(max).optional();
const count = z.number().int().nonnegative().max(1_000_000_000).optional();
const size = z.number().nonnegative().finite().max(1e12).optional();
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max).optional();
const names = (max: number) => list(z.string().max(200), max);

export const agentInventorySchema = z.object({
  schema: z.number().int().min(2),
  collectedAt: text(40),
  system: z
    .object({
      manufacturer: text(),
      model: text(),
      serialNumber: text(),
      uuid: text(),
      formFactor: z.enum(['laptop', 'desktop', 'server', 'virtual', 'tablet', 'other']).optional(),
      role: z.enum(['server', 'workstation']).optional(),
      virtual: z.boolean().optional(),
      hypervisor: text(),
      biosVendor: text(),
      biosVersion: text(),
      biosDate: text(40),
      domain: text(),
      timezone: text(),
    })
    .optional(),
  os: z
    .object({
      name: text(),
      version: text(),
      build: text(),
      arch: text(),
      kernel: text(),
      installDate: text(40),
      lastBoot: text(40),
      pendingReboot: z.boolean().optional(),
    })
    .optional(),
  cpu: z
    .object({ model: text(), vendor: text(), sockets: count, cores: count, threads: count, speedMhz: count })
    .optional(),
  memory: z
    .object({
      totalMb: count,
      slots: count,
      modules: list(
        z.object({
          slot: text(),
          sizeMb: count,
          type: text(50),
          speedMhz: count,
          manufacturer: text(),
          serialNumber: text(),
          partNumber: text(),
        }),
        64,
      ),
    })
    .optional(),
  disks: list(
    z.object({
      name: text(),
      model: text(),
      serialNumber: text(),
      sizeGb: size,
      type: text(20),
      interface: text(50),
      health: text(50),
    }),
    64,
  ),
  volumes: list(
    z.object({
      mount: z.string().max(500),
      label: text(),
      fileSystem: text(50),
      totalGb: size,
      freeGb: size,
      encrypted: z.boolean().optional(),
    }),
    128,
  ),
  network: list(
    z.object({
      name: text(),
      description: text(),
      mac: text(40),
      ipv4: names(32),
      ipv6: names(32),
      gateway: text(100),
      dns: names(16),
      dhcp: z.boolean().optional(),
      speedMbps: count,
      up: z.boolean().optional(),
      virtual: z.boolean().optional(),
    }),
    64,
  ),
  gpus: list(z.object({ name: text(), vendor: text(), driverVersion: text(100), memoryMb: count }), 32),
  monitors: list(z.object({ manufacturer: text(), model: text(), serialNumber: text(), year: count }), 32),
  batteries: list(
    z.object({
      name: text(),
      manufacturer: text(),
      chemistry: text(50),
      designCapacityMwh: count,
      fullCapacityMwh: count,
      healthPercent: z.number().int().min(0).max(100).optional(),
      cycleCount: count,
    }),
    32,
  ),
  printers: list(
    z.object({
      name: z.string().max(200),
      driver: text(),
      port: text(),
      shared: z.boolean().optional(),
      network: z.boolean().optional(),
      default: z.boolean().optional(),
    }),
    100,
  ),
  users: z
    .object({ loggedOn: names(200), lastLogon: text(), localAdmins: names(200), localUsers: names(200) })
    .optional(),
  security: z
    .object({
      antivirus: list(
        z.object({ name: z.string().max(200), enabled: z.boolean().optional(), upToDate: z.boolean().optional(), version: text(100) }),
        32,
      ),
      firewallEnabled: z.boolean().optional(),
      systemDiskEncrypted: z.boolean().optional(),
      encryptionMethod: text(50),
      secureBoot: z.boolean().optional(),
      tpmPresent: z.boolean().optional(),
      tpmVersion: text(50),
      features: z
        .record(z.string().max(50), z.string().max(100))
        .refine((f) => Object.keys(f).length <= 32, 'too many security features')
        .optional(),
      agents: names(50),
    })
    .optional(),
  software: list(
    z.object({
      name: z.string().max(200),
      version: text(100),
      publisher: text(),
      installDate: text(30),
      arch: text(30),
      source: text(30),
    }),
    2000,
  ),
  updates: z
    .object({
      installed: list(z.object({ id: z.string().max(100), description: text(), installedOn: text(30) }), 500),
      pending: count,
      pendingSecurity: count,
      lastInstalled: text(30),
    })
    .optional(),
  services: list(
    z.object({ name: z.string().max(200), displayName: text(), state: text(20), startMode: text(20) }),
    1000,
  ),
  ports: list(
    z.object({ protocol: z.enum(['tcp', 'udp']), address: text(100), port: z.number().int().min(1).max(65535), process: text() }),
    500,
  ),
  serverRoles: names(100),
  virtualMachines: list(z.object({ name: z.string().max(200), type: text(30), state: text(50), image: text() }), 500),
});

export type AgentInventory = z.infer<typeof agentInventorySchema>;

/** A short, readable reason for the agent's log -- the first problem found. */
export function describeInventoryError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid inventory';
  const path = issue.path.join('.');
  return `${path ? `${path}: ` : ''}${issue.message}`.slice(0, 300);
}
