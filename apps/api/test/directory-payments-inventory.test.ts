import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { buildApp } from '../src/index';
import { contactEmailQueue } from '../src/lib/queue';
import { nextDueDate, paymentStatus } from '../src/modules/contracts/service';
import { checkIn, createEnrollmentToken, enrollDevice } from '../src/modules/devices/service';
import { agentInventorySchema } from '../src/modules/devices/inventorySchema';
import { classifyAsset } from '../../worker/src/discovery/classify';
import { sendDuePaymentReminders } from '../../worker/src/contracts/paymentReminders';

/** docs/adr/0076-directory-payments-inventory.md */
describe('payment schedule', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

  it('moves to the next period, keeping the day of the month', () => {
    expect(iso(nextDueDate(d('2026-01-15'), 'monthly'))).toBe('2026-02-15');
    expect(iso(nextDueDate(d('2026-11-30'), 'quarterly'))).toBe('2027-02-28');
    expect(iso(nextDueDate(d('2026-02-28'), 'monthly', 31))).toBe('2026-03-31');
    expect(iso(nextDueDate(d('2026-01-31'), 'monthly', 31))).toBe('2026-02-28');
    expect(iso(nextDueDate(d('2026-05-10'), 'yearly'))).toBe('2027-05-10');
    expect(iso(nextDueDate(d('2026-05-10'), 'semiannual'))).toBe('2026-11-10');
    expect(iso(nextDueDate(d('2026-05-10'), 'bimonthly'))).toBe('2026-07-10');
    expect(nextDueDate(d('2026-05-10'), 'one_time')).toBeNull();
  });

  it('says when a payment is close or late', () => {
    const now = d('2026-10-05');
    const c = (date: string | null) => ({ paymentFrequency: date ? 'monthly' : null, nextPaymentDate: date ? d(date) : null, paymentReminderDays: 5 });
    expect(paymentStatus(c(null), now)).toBe('none');
    expect(paymentStatus(c('2026-10-20'), now)).toBe('scheduled');
    expect(paymentStatus(c('2026-10-10'), now)).toBe('due_soon');
    expect(paymentStatus(c('2026-10-05'), now)).toBe('due_soon');
    expect(paymentStatus(c('2026-10-04'), now)).toBe('overdue');
  });
});

describe('network scan classification', () => {
  it('recognizes network gear, storage, UPS, phones and cameras before the operating system', () => {
    expect(classifyAsset('Cisco IOS Software, C2960X Software, Catalyst 2960-X switch')).toBe('SWITCH');
    expect(classifyAsset('RouterOS RB4011iGS+')).toBe('ROUTER');
    expect(classifyAsset('FortiGate-60F v7.2.5')).toBe('FIREWALL');
    expect(classifyAsset('UniFi AP-AC-Pro 6.5.62')).toBe('ACCESS_POINT');
    expect(classifyAsset('Linux DiskStation 4.4.302+ Synology')).toBe('STORAGE');
    expect(classifyAsset('APC Web/SNMP Management Card (MB:v4.1.0 PF:v6.8.2)')).toBe('UPS');
    expect(classifyAsset('Yealink SIP-T46U')).toBe('IP_PHONE');
    expect(classifyAsset('HIKVISION DS-2CD2143G2-I network camera')).toBe('CAMERA');
    expect(classifyAsset('HP LaserJet Pro M404dn')).toBe('PRINTER');
    expect(classifyAsset('Hardware: Intel64 Family 6 - Software: Windows Version 10.0 (Build 22631 Multiprocessor Free)')).toBe('WORKSTATION');
    expect(classifyAsset('Linux web01 5.15.0-91-generic #101-Ubuntu SMP x86_64')).toBe('SERVER');
    expect(classifyAsset(undefined)).toBe('OTHER');
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('directory, contract payments and inventory', () => {
  const app = buildApp();
  const slug = `dir-${randomUUID().slice(0, 8)}`;
  let token: string;
  let tenantId: string;
  let ip = 0;
  const nextIp = () => `10.98.${Math.floor(++ip / 250)}.${ip % 250}`;
  const as = () => ({ authorization: `Bearer ${token}` });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: as(), payload });
  const patch = (url: string, payload: object) => app.inject({ method: 'PATCH', url, headers: as(), payload });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: as() });
  const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, tenantName: 'Directorio SpA', adminEmail: 'admin@dir.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    token = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(token)!.tenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps companies and their people, with no email required', async () => {
    const org = await post('/organizations', { name: 'Redes del Sur Ltda.', type: 'SUPPLIER', taxId: '76.123.456-7', website: 'redesdelsur.cl', phone: '+56 2 2345 6789' });
    expect(org.statusCode).toBe(201);
    expect(org.json().website).toBe('https://redesdelsur.cl');
    expect((await post('/organizations', { name: 'Redes del Sur Ltda.' })).statusCode).toBe(409);

    const person = await post('/directory-contacts', {
      name: 'Carla Muñoz',
      organizationId: org.json().id,
      role: 'EXECUTIVE',
      jobTitle: 'Ejecutiva de cuentas',
      mobile: '+56 9 8765 4321',
      email: '',
    });
    expect(person.statusCode).toBe(201);
    expect(person.json()).toMatchObject({ email: null, organization: { name: 'Redes del Sur Ltda.' } });
    expect((await post('/directory-contacts', { name: 'X', email: 'not-an-email' })).statusCode).toBe(400);
    expect((await post('/directory-contacts', { name: 'X', organizationId: randomUUID() })).statusCode).toBe(400);

    const found = await get(`/directory-contacts?search=sur`);
    expect(found.json().contacts.map((c: { name: string }) => c.name)).toEqual(['Carla Muñoz']);
    const execs = await get(`/directory-contacts?role=BILLING`);
    expect(execs.json().contacts).toHaveLength(0);

    const detail = await get(`/organizations/${org.json().id}`);
    expect(detail.json().contacts).toHaveLength(1);

    // Deleting the company keeps the person.
    const other = await post('/organizations', { name: 'Temporal' });
    const temp = await post('/directory-contacts', { name: 'Persona Temporal', organizationId: other.json().id });
    expect((await app.inject({ method: 'DELETE', url: `/organizations/${other.json().id}`, headers: as() })).statusCode).toBe(204);
    const kept = (await get('/directory-contacts?search=Temporal')).json().contacts;
    expect(kept).toMatchObject([{ id: temp.json().id, organization: null }]);
  });

  it('schedules contract payments, records them, and moves to the next due date', async () => {
    const org = (await post('/organizations', { name: 'Enlace Fibra' })).json();
    const person = (await post('/directory-contacts', { name: 'Diego Rojas', organizationId: org.id, role: 'BILLING' })).json();

    expect((await post('/contracts', { name: 'Sin fecha', type: 'SUPPORT', paymentFrequency: 'monthly' })).statusCode).toBe(400);

    const created = await post('/contracts', {
      name: 'Enlace dedicado 1 Gbps',
      type: 'SUBSCRIPTION',
      organizationId: org.id,
      contactId: person.id,
      cost: 450000,
      currency: 'clp',
      startDate: '2026-01-31',
      paymentFrequency: 'monthly',
      nextPaymentDate: '2026-01-31',
      paymentReminderDays: 5,
      paymentReminderEmails: ['Finanzas@Dir.test', 'finanzas@dir.test'],
    });
    expect(created.statusCode).toBe(201);
    const contract = created.json();
    expect(contract).toMatchObject({
      supplierName: 'Enlace Fibra',
      contact: { name: 'Diego Rojas' },
      paymentReminderEmails: ['finanzas@dir.test'],
      paymentStatus: 'overdue',
    });

    const paid = await post(`/contracts/${contract.id}/payments`, { paidOn: '2026-02-01', reference: 'F-1001' });
    expect(paid.statusCode).toBe(201);
    expect(paid.json().nextPaymentDate.slice(0, 10)).toBe('2026-02-28');
    expect(paid.json().payments[0]).toMatchObject({ dueDate: '2026-01-31T00:00:00.000Z', amount: 450000, currency: 'CLP', reference: 'F-1001' });
    // The anchor day comes back after a short month.
    const paid2 = await post(`/contracts/${contract.id}/payments`, { paidOn: '2026-03-01' });
    expect(paid2.json().nextPaymentDate.slice(0, 10)).toBe('2026-03-31');

    const undone = await app.inject({ method: 'DELETE', url: `/contracts/${contract.id}/payments/${paid2.json().payments[0].id}`, headers: as() });
    expect(undone.json().payments).toHaveLength(1);

    const overdue = await get('/contracts?paymentStatus=overdue');
    expect(overdue.json().contracts.map((c: { id: string }) => c.id)).toContain(contract.id);
    const byOrg = await get(`/contracts?organizationId=${org.id}`);
    expect(byOrg.json().contracts).toHaveLength(1);
    expect((await get('/contracts/summary')).json().paymentsOverdue).toBeGreaterThanOrEqual(1);
  });

  it('emails a branded Spanish reminder before the due date, once, and again when it is overdue', async () => {
    const created = await post('/contracts', {
      name: 'Licencias Microsoft 365',
      type: 'LICENSE',
      cost: 1200.5,
      currency: 'USD',
      paymentFrequency: 'monthly',
      nextPaymentDate: ymd(3),
      paymentReminderDays: 5,
      paymentReminderEmails: ['pagos@dir.test'],
    });
    const id = created.json().id;
    const jobsFor = async () =>
      (await contactEmailQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'])).filter(
        (j) => j.data.tenantId === tenantId && j.data.to === 'pagos@dir.test',
      );

    expect(await sendDuePaymentReminders()).toBeGreaterThanOrEqual(1);
    const first = await jobsFor();
    expect(first).toHaveLength(1);
    expect(first[0].data.subject).toMatch(/^Recordatorio de pago: Licencias Microsoft 365, vence el \d+ de \w+ de \d{4}$/);
    expect(first[0].data.text).toContain('US$1.200,5');
    expect(first[0].data.html).toContain('Ver los contratos');
    expect(first[0].data.html).toContain('Directorio SpA');

    await sendDuePaymentReminders();
    expect(await jobsFor()).toHaveLength(1);

    // The due date passes with no payment recorded.
    await patch(`/contracts/${id}`, { nextPaymentDate: ymd(-1) });
    await sendDuePaymentReminders();
    const after = await jobsFor();
    expect(after).toHaveLength(2);
    expect(after.some((j) => j.data.subject.startsWith('Pago vencido: Licencias Microsoft 365'))).toBe(true);

    const notes = await withTenantTx(prisma, tenantId, (tx) => tx.notification.findMany({ where: { eventType: 'CONTRACT_PAYMENT_DUE' } }));
    expect(notes.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps inventory details: tag, location, who has it, what it plugs into, purchase', async () => {
    const contact = await withTenantTx(prisma, tenantId, (tx) => tx.contact.create({ data: { tenantId, email: 'ana@dir.test', name: 'Ana Rojas' } }));
    const supplier = (await post('/organizations', { name: 'Compumundo' })).json();
    const laptop = await post('/assets', {
      name: 'NB-ANA',
      assetType: 'LAPTOP',
      assetTag: 'TI-00042',
      location: 'Piso 2',
      assignedContactId: contact.id,
      supplierId: supplier.id,
      purchaseDate: '2026-03-01',
      purchaseCost: 899990,
      purchaseCurrency: 'clp',
      warrantyEndDate: '2029-03-01',
    });
    expect(laptop.statusCode).toBe(201);
    expect(laptop.json()).toMatchObject({ purchaseCost: 899990, purchaseCurrency: 'CLP' });

    const monitor = await post('/assets', { name: 'Dell P2422H', assetType: 'MONITOR', parentAssetId: laptop.json().id });
    expect(monitor.statusCode).toBe(201);
    // No loops: the laptop can't be plugged into its own monitor.
    expect((await patch(`/assets/${laptop.json().id}`, { parentAssetId: monitor.json().id })).statusCode).toBe(400);
    expect((await patch(`/assets/${laptop.json().id}`, { parentAssetId: laptop.json().id })).statusCode).toBe(400);
    expect((await post('/assets', { name: 'x', assetType: 'OTHER', assignedContactId: randomUUID() })).statusCode).toBe(400);

    const detail = (await get(`/assets/${laptop.json().id}`)).json();
    expect(detail).toMatchObject({ assignedContact: { name: 'Ana Rojas' }, supplier: { name: 'Compumundo' } });
    expect(detail.connectedAssets.map((a: { name: string }) => a.name)).toEqual(['Dell P2422H']);

    const peripherals = (await get('/assets?group=peripherals')).json();
    expect(peripherals.assets.map((a: { name: string }) => a.name)).toEqual(['Dell P2422H']);
    expect((await get(`/assets?assignedContactId=${contact.id}`)).json().total).toBe(1);
    expect((await get('/assets?q=TI-00042')).json().total).toBe(1);
  });

  it('files monitors the agent reports under their computer, and laptops as laptops', async () => {
    const { token: enrollment } = await createEnrollmentToken(tenantId);
    const enrolled = await enrollDevice(enrollment, { hostname: 'nb-pedro', platform: 'win32' });
    const inventory = (monitors: { manufacturer?: string; model?: string; serialNumber?: string }[]) =>
      agentInventorySchema.parse({
        schema: 2,
        collectedAt: '2026-10-05T12:00:00Z',
        system: { manufacturer: 'Lenovo', model: 'ThinkPad T14', formFactor: 'laptop', role: 'workstation' },
        monitors,
      });
    await checkIn(sha256Hex(enrolled.credential), {
      inventory: inventory([
        { manufacturer: 'DEL', model: 'DELL U2723QE', serialNumber: 'CN0ABC123' },
        { manufacturer: 'LEN', model: 'Built-in', serialNumber: '0' },
      ]),
    });
    const monitors = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findMany({ where: { assetType: 'MONITOR', serialNumber: 'CN0ABC123' } }));
    expect(monitors).toHaveLength(1);
    expect(monitors[0]).toMatchObject({ name: 'DEL DELL U2723QE', parentAssetId: enrolled.assetId, discoverySource: 'AGENT' });
    const laptop = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: enrolled.assetId } }));
    expect(laptop.assetType).toBe('LAPTOP');

    // The monitor moves to another computer: it follows, no duplicate.
    const { token: enrollment2 } = await createEnrollmentToken(tenantId);
    const desk = await enrollDevice(enrollment2, { hostname: 'pc-sala', platform: 'win32' });
    await checkIn(sha256Hex(desk.credential), { inventory: inventory([{ manufacturer: 'DEL', model: 'DELL U2723QE', serialNumber: 'CN0ABC123' }]) });
    const moved = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findMany({ where: { assetType: 'MONITOR', serialNumber: 'CN0ABC123' } }));
    expect(moved).toHaveLength(1);
    expect(moved[0].parentAssetId).toBe(desk.assetId);
  });
});
