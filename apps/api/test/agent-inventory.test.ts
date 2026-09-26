import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { buildApp } from '../src/index';
import { getAsset, listAssets } from '../src/modules/assets/service';
import { checkIn, createEnrollmentToken, enrollDevice } from '../src/modules/devices/service';
import { agentInventorySchema, type AgentInventory } from '../src/modules/devices/inventorySchema';

/**
 * The agent's full inventory (docs/adr/0069-full-agent-inventory.md): stored
 * whole, its searchable fields copied into their columns, the asset's type
 * following the reported role without overriding an admin, and a bad
 * inventory never costing the device its check-in.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

function serverInventory(overrides: Partial<AgentInventory> = {}): AgentInventory {
  return agentInventorySchema.parse({
    schema: 2,
    collectedAt: '2026-09-26T12:00:00Z',
    system: {
      manufacturer: 'Dell Inc.',
      model: 'PowerEdge R650',
      serialNumber: '7XK2JQ3',
      formFactor: 'server',
      role: 'server',
      virtual: false,
      domain: 'corp.example.cl',
    },
    os: { name: 'Microsoft Windows Server 2022 Standard', version: '21H2 (10.0.20348)', build: '20348.2582', pendingReboot: true },
    cpu: { model: 'Intel(R) Xeon(R) Gold 6338', sockets: 2, cores: 64, threads: 128 },
    memory: { totalMb: 262144, slots: 32, modules: [{ slot: 'A1', sizeMb: 32768, type: 'DDR4', serialNumber: '80AD0123' }] },
    disks: [{ name: 'DELL PERC H755', serialNumber: 'X1', sizeGb: 1919.9, type: 'ssd', interface: 'RAID' }],
    volumes: [{ mount: 'C:', fileSystem: 'NTFS', totalGb: 475.7, freeGb: 200, encrypted: true }],
    network: [{ name: 'Ethernet', mac: 'b0:26:28:aa:bb:cc', ipv4: ['10.0.0.20'], ipv6: [], dns: ['10.0.0.10'], up: true, virtual: false }],
    security: { antivirus: [{ name: 'Microsoft Defender Antivirus', enabled: true, upToDate: true }], agents: ['CrowdStrike Falcon'] },
    software: [{ name: 'Microsoft SQL Server 2019', version: '15.0.2000.5', publisher: 'Microsoft Corporation' }],
    services: [{ name: 'MSSQLSERVER', displayName: 'SQL Server', state: 'running', startMode: 'auto' }],
    ports: [{ protocol: 'tcp', address: '0.0.0.0', port: 1433, process: 'sqlservr' }],
    serverRoles: ['Hyper-V', 'SQL Server'],
    virtualMachines: [{ name: 'APP01', type: 'hyperv', state: 'running' }],
    ...overrides,
  });
}

describe.skipIf(!hasDb)('agent full inventory', () => {
  let tenantId: string;
  let assetId: string;
  let hashedCredential: string;
  let credential: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `inv-${tenantId.slice(0, 8)}`, name: 'Inventory Test' } }),
    );
    const { token } = await createEnrollmentToken(tenantId);
    const enrolled = await enrollDevice(token, { hostname: 'srv01', platform: 'win32' });
    assetId = enrolled.assetId;
    credential = enrolled.credential;
    hashedCredential = sha256Hex(credential);
  });

  const asset = () => withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: assetId } }));

  it('stores the inventory and copies the searchable fields into their columns', async () => {
    const inventory = serverInventory();
    await checkIn(hashedCredential, { cpuModel: 'Intel(R) Xeon(R) Gold 6338', inventory });

    const a = await asset();
    expect(a.agentInventory).toEqual(inventory);
    expect(a.agentInventoryAt).not.toBeNull();
    expect(a).toMatchObject({
      manufacturer: 'Dell Inc.',
      model: 'PowerEdge R650',
      serialNumber: '7XK2JQ3',
      operatingSystem: 'Microsoft Windows Server 2022 Standard',
      cpuModel: 'Intel(R) Xeon(R) Gold 6338',
    });
  });

  it('an empty value from the agent never erases what an admin typed', async () => {
    await withTenantTx(prisma, tenantId, (tx) => tx.asset.update({ where: { id: assetId }, data: { serialNumber: 'TYPED-BY-HAND' } }));
    await checkIn(hashedCredential, { inventory: serverInventory({ system: { role: 'server', serialNumber: '' } }) });
    expect((await asset()).serialNumber).toBe('TYPED-BY-HAND');
  });

  it('the type follows the reported role, but a type an admin chose sticks until the role changes', async () => {
    expect((await asset()).assetType).toBe('WORKSTATION'); // the enrollment default

    await checkIn(hashedCredential, { inventory: serverInventory() });
    expect((await asset()).assetType).toBe('SERVER');

    // An admin files it as something else; the agent keeps saying "server".
    await withTenantTx(prisma, tenantId, (tx) => tx.asset.update({ where: { id: assetId }, data: { assetType: 'OTHER' } }));
    await checkIn(hashedCredential, { inventory: serverInventory() });
    expect((await asset()).assetType).toBe('OTHER');

    // A real change of role (reinstalled as a workstation) moves it again.
    await checkIn(hashedCredential, { inventory: serverInventory({ system: { role: 'workstation' } }) });
    expect((await asset()).assetType).toBe('WORKSTATION');
  });

  it("the first report doesn't override a type set before the agent reported any role", async () => {
    await withTenantTx(prisma, tenantId, (tx) => tx.asset.update({ where: { id: assetId }, data: { assetType: 'NETWORK_DEVICE' } }));
    await checkIn(hashedCredential, { inventory: serverInventory() });
    expect((await asset()).assetType).toBe('NETWORK_DEVICE');
  });

  it("asset lists leave the inventory documents out; the asset's own page has them", async () => {
    await checkIn(hashedCredential, {
      installedPackages: [{ name: 'bash', version: '5' }],
      inventory: serverInventory(),
    });
    const { assets } = await listAssets(tenantId);
    expect(assets[0]).not.toHaveProperty('agentInventory');
    expect(assets[0]).not.toHaveProperty('installedPackages');
    expect(assets[0].serialNumber).toBe('7XK2JQ3');

    const detail = await getAsset(tenantId, assetId);
    expect(detail.agentInventory).toMatchObject({ schema: 2, system: { model: 'PowerEdge R650' } });
    expect(detail.installedPackages).toEqual([{ name: 'bash', version: '5' }]);
  });

  it('assets can be found by serial number and model', async () => {
    await checkIn(hashedCredential, { inventory: serverInventory() });
    expect((await listAssets(tenantId, { q: '7xk2' })).total).toBe(1);
    expect((await listAssets(tenantId, { q: 'poweredge' })).total).toBe(1);
  });

  describe('over HTTP', () => {
    const app = buildApp();
    afterAll(() => app.close());
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/v1/devices/checkin', headers: { authorization: `Bearer ${credential}` }, payload });

    it('reports the inventory as stored', async () => {
      const res = await post({ cpuModel: 'x', diskSummary: [], installedPackages: [], inventory: serverInventory() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ inventory: 'stored' });
    });

    it('an older agent without an inventory still checks in', async () => {
      const res = await post({ cpuModel: 'x', diskSummary: [], installedPackages: [] });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ inventory: 'none' });
      expect((await asset()).agentInventory).toBeNull();
    });

    it('a bad inventory is rejected with a reason, and the summary is still stored', async () => {
      const bad = { ...serverInventory(), ports: [{ protocol: 'tcp', port: 70000 }] };
      const res = await post({ cpuModel: 'Summary still stored', diskSummary: [], installedPackages: [], inventory: bad });
      expect(res.statusCode).toBe(200);
      expect(res.json().inventory).toBe('rejected');
      expect(res.json().inventoryError).toMatch(/^ports\.0\.port/);
      const a = await asset();
      expect(a.cpuModel).toBe('Summary still stored');
      expect(a.agentInventory).toBeNull();
    });

    it("a newer agent's unknown fields are dropped, not refused", async () => {
      const res = await post({ diskSummary: [], installedPackages: [], inventory: { ...serverInventory(), somethingNew: [1, 2, 3] } });
      expect(res.json().inventory).toBe('stored');
      expect((await asset()).agentInventory).not.toHaveProperty('somethingNew');
    });

    it("accepts a big server's inventory above the global 1 MiB body limit", async () => {
      // The agent sends the software twice: in the inventory, and as the
      // summary list older servers read.
      const software = Array.from({ length: 2000 }, (_, i) => ({
        name: `package-${i}-${'x'.repeat(180)}`,
        version: '1.0.0',
        publisher: 'p'.repeat(180),
      }));
      const installedPackages = software.map(({ name, version }) => ({ name, version }));
      const payload = { diskSummary: [], installedPackages, inventory: { ...serverInventory(), software } };
      expect(JSON.stringify(payload).length).toBeGreaterThan(1024 * 1024);
      const res = await post(payload);
      expect(res.statusCode).toBe(200);
      expect(res.json().inventory).toBe('stored');
    });

    it('still refuses more software entries than the cap', async () => {
      const software = Array.from({ length: 2001 }, (_, i) => ({ name: `p${i}` }));
      const res = await post({ diskSummary: [], installedPackages: [], inventory: { ...serverInventory(), software } });
      expect(res.json().inventory).toBe('rejected');
    });
  });
});
