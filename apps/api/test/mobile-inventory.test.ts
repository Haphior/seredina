import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { buildApp } from '../src/index';
import { checkIn, createEnrollmentToken, enrollDevice, samePhoneNumber } from '../src/modules/devices/service';
import { agentInventorySchema } from '../src/modules/devices/inventorySchema';

/** docs/adr/0078-mobile-inventory.md */
describe('phone number matching', () => {
  it('matches the same number with or without the country code, never a short fragment', () => {
    expect(samePhoneNumber('+56 9 1234 5678', '912345678')).toBe(true);
    expect(samePhoneNumber('56912345678', '+56 9 1234 5678')).toBe(true);
    expect(samePhoneNumber('(9) 1234-5678', '+56912345678')).toBe(true);
    expect(samePhoneNumber('+56 9 1234 5678', '+56 9 1234 5679')).toBe(false);
    expect(samePhoneNumber('5678', '+56 9 1234 5678')).toBe(false);
    expect(samePhoneNumber('', '912345678')).toBe(false);
  });

  it('accepts what the Android agent reports, and drops what it does not know', () => {
    const parsed = agentInventorySchema.parse({
      schema: 2,
      system: { manufacturer: 'samsung', model: 'SM-A546E', formFactor: 'phone' },
      os: { name: 'Android', version: '14' },
      mobile: {
        brand: 'samsung',
        securityPatch: '2026-10-01',
        sims: [{ slot: 0, carrier: 'Entel', countryIso: 'cl', phoneNumber: '+56912345678' }],
        screenLockSecure: true,
        rooted: false,
        batteryPercent: 81,
        somethingNewer: 'x',
      },
    });
    expect(parsed.mobile).toMatchObject({ brand: 'samsung', batteryPercent: 81 });
    expect(parsed.mobile).not.toHaveProperty('somethingNewer');
    expect(agentInventorySchema.safeParse({ schema: 2, mobile: { batteryPercent: 140 } }).success).toBe(false);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('mobile inventory: Android agent, lines and handovers', () => {
  const app = buildApp();
  const slug = `mob-${randomUUID().slice(0, 8)}`;
  let token: string;
  let tenantId: string;
  const as = () => ({ authorization: `Bearer ${token}` });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: as(), payload });
  const patch = (url: string, payload: object) => app.inject({ method: 'PATCH', url, headers: as(), payload });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: as() });
  const del = (url: string) => app.inject({ method: 'DELETE', url, headers: as() });
  const fingerprint = (seed: string) => sha256Hex(`${slug}-${seed}`);

  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: { tenantSlug: slug, tenantName: 'Móviles SpA', adminEmail: 'admin@mob.test', adminName: 'Paula Admin', password: 'admin-password-1' },
    });
    token = res.json().token;
    tenantId = app.jwt.decode<{ tenantId: string }>(token)!.tenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function enrollPhone(seed: string, name = 'Galaxy de Ana') {
    const { token: enrollmentToken } = await createEnrollmentToken(tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/devices/enroll',
      payload: { enrollmentToken, hostname: name, platform: 'android', agentVersion: '0.5.0', machineFingerprint: fingerprint(seed) },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { deviceId: string; assetId: string; credential: string };
  }

  it('enrolls an Android phone as a mobile device, and a tablet becomes a tablet', async () => {
    const phone = await enrollPhone('phone');
    const asset = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: phone.assetId } }));
    expect(asset.assetType).toBe('MOBILE_DEVICE');

    await checkIn(sha256Hex(phone.credential), {
      osVersion: 'Android 14',
      inventory: agentInventorySchema.parse({
        schema: 2,
        system: { manufacturer: 'samsung', model: 'SM-A546E', formFactor: 'phone' },
        os: { name: 'Android', version: '14' },
        mobile: { securityPatch: '2026-10-01', screenLockSecure: true },
      }),
    });
    const after = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: phone.assetId } }));
    expect(after).toMatchObject({ assetType: 'MOBILE_DEVICE', manufacturer: 'samsung', model: 'SM-A546E', operatingSystem: 'Android' });

    const tablet = await enrollPhone('tablet', 'Tab de bodega');
    await checkIn(sha256Hex(tablet.credential), { inventory: agentInventorySchema.parse({ schema: 2, system: { formFactor: 'tablet' } }) });
    const tab = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: tablet.assetId } }));
    expect(tab.assetType).toBe('TABLET');

    // A type an admin picks by hand sticks through later check-ins.
    await patch(`/assets/${tablet.assetId}`, { assetType: 'OTHER' });
    await checkIn(sha256Hex(tablet.credential), { inventory: agentInventorySchema.parse({ schema: 2, system: { formFactor: 'tablet' } }) });
    const kept = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: tablet.assetId } }));
    expect(kept.assetType).toBe('OTHER');
  });

  it('rejects an unknown platform', async () => {
    const { token: enrollmentToken } = await createEnrollmentToken(tenantId);
    const res = await app.inject({ method: 'POST', url: '/v1/devices/enroll', payload: { enrollmentToken, hostname: 'x', platform: 'ios' } });
    expect(res.statusCode).toBe(400);
  });

  it('keeps an IMEI on phones, cleaned of spaces, and finds the phone by it', async () => {
    const created = await post('/assets', { name: 'iPhone de Luis', assetType: 'MOBILE_DEVICE', imei: '35 209900 176148 1' });
    expect(created.statusCode).toBe(201);
    expect(created.json().imei).toBe('352099001761481');
    expect((await post('/assets', { name: 'x', assetType: 'MOBILE_DEVICE', imei: '12ab' })).statusCode).toBe(400);
    const found = await get('/assets?q=001761');
    expect(found.json().assets.map((a: { name: string }) => a.name)).toContain('iPhone de Luis');
  });

  it('keeps phone lines, one per number, with their carrier and cost', async () => {
    const carrier = (await post('/organizations', { name: 'Entel Empresas', type: 'SUPPLIER' })).json();
    const line = await post('/mobile-lines', {
      phoneNumber: '+56 9 1234 5678',
      carrierId: carrier.id,
      plan: 'Empresa 30 GB',
      monthlyCost: 15990,
      currency: 'clp',
      iccid: '8956 0100 0012 3456 789',
    });
    expect(line.statusCode).toBe(201);
    expect(line.json()).toMatchObject({ status: 'ACTIVE', currency: 'CLP', monthlyCost: 15990, iccid: '8956010000123456789', carrier: { name: 'Entel Empresas' } });
    expect((await post('/mobile-lines', { phoneNumber: '+56 9 1234 5678' })).statusCode).toBe(409);
    expect((await post('/mobile-lines', { phoneNumber: 'llámame' })).statusCode).toBe(400);
    expect((await post('/mobile-lines', { phoneNumber: '+56 9 0000 0001', carrierId: randomUUID() })).statusCode).toBe(400);

    const suspended = await patch(`/mobile-lines/${line.json().id}`, { status: 'SUSPENDED' });
    expect(suspended.json().status).toBe('SUSPENDED');
    expect((await get('/mobile-lines?status=ACTIVE')).json().lines).toHaveLength(0);
    expect((await get('/mobile-lines?search=30 GB')).json().lines).toHaveLength(1);
    await patch(`/mobile-lines/${line.json().id}`, { status: 'ACTIVE' });
  });

  it('puts a line in the phone whose SIM reports its number, and never makes up lines', async () => {
    const line = (await get('/mobile-lines?search=1234')).json().lines[0];
    const phone = await enrollPhone('sim-phone', 'Moto de Pedro');
    await checkIn(sha256Hex(phone.credential), {
      inventory: agentInventorySchema.parse({
        schema: 2,
        system: { formFactor: 'phone' },
        mobile: {
          sims: [
            { slot: 0, carrier: 'Entel', phoneNumber: '912345678' },
            { slot: 1, carrier: 'Movistar', phoneNumber: '+56 9 9999 0000' },
          ],
        },
      }),
    });
    const lines = (await get(`/mobile-lines?assetId=${phone.assetId}`)).json().lines;
    expect(lines.map((l: { id: string }) => l.id)).toEqual([line.id]);
    expect((await get('/mobile-lines?search=9999')).json().lines).toHaveLength(0);

    const detail = (await get(`/assets/${phone.assetId}`)).json();
    expect(detail.mobileLines.map((l: { phoneNumber: string }) => l.phoneNumber)).toEqual(['+56 9 1234 5678']);
    expect(detail.device).toMatchObject({ platform: 'android' });
  });

  it('records a handover, moves the assignee, and prints the form', async () => {
    const ana = await withTenantTx(prisma, tenantId, (tx) => tx.contact.create({ data: { tenantId, email: 'ana@mob.test', name: 'Ana Rojas' } }));
    const phone = (await post('/assets', { name: 'Galaxy A54 #12', assetType: 'MOBILE_DEVICE', imei: '356938035643809', serialNumber: 'R58T123' })).json();
    const line = (await post('/mobile-lines', { phoneNumber: '+56 9 5555 1111', plan: 'Empresa 10 GB' })).json();

    expect((await post(`/assets/${phone.id}/handovers`, { kind: 'DELIVERY', handedOverOn: '2026-11-20' })).statusCode).toBe(400);
    expect((await post(`/assets/${phone.id}/handovers`, { kind: 'RETURN', handedOverOn: '2026-11-20' })).statusCode).toBe(400);

    const delivered = await post(`/assets/${phone.id}/handovers`, {
      kind: 'DELIVERY',
      contactId: ana.id,
      handedOverOn: '2026-11-20',
      condition: 'Nuevo',
      accessories: 'Cargador, funda',
      mobileLineId: line.id,
    });
    expect(delivered.statusCode).toBe(201);
    expect(delivered.json()).toMatchObject({ kind: 'DELIVERY', contact: { name: 'Ana Rojas' }, mobileLine: { phoneNumber: '+56 9 5555 1111' } });

    const asset = (await get(`/assets/${phone.id}`)).json();
    expect(asset.assignedContact.name).toBe('Ana Rojas');
    const movedLine = (await get(`/mobile-lines?search=5555`)).json().lines[0];
    expect(movedLine).toMatchObject({ assignedContact: { name: 'Ana Rojas' }, asset: { id: phone.id } });

    const form = (await get(`/handovers/${delivered.json().id}`)).json();
    expect(form).toMatchObject({
      tenantName: 'Móviles SpA',
      tenantSlug: slug,
      recordedByName: 'Paula Admin',
      asset: { imei: '356938035643809', serialNumber: 'R58T123' },
      accessories: 'Cargador, funda',
    });

    // A return with no person named comes back from whoever has it.
    const returned = await post(`/assets/${phone.id}/handovers`, { kind: 'RETURN', handedOverOn: '2026-11-21', mobileLineId: line.id });
    expect(returned.statusCode).toBe(201);
    expect(returned.json().contact.name).toBe('Ana Rojas');
    expect((await get(`/assets/${phone.id}`)).json().assignedContact).toBeNull();
    expect((await get(`/mobile-lines?search=5555`)).json().lines[0].assignedContact).toBeNull();

    const history = (await get(`/assets/${phone.id}/handovers`)).json().handovers;
    expect(history.map((h: { kind: string }) => h.kind)).toEqual(['RETURN', 'DELIVERY']);

    expect((await del(`/handovers/${returned.json().id}`)).statusCode).toBe(204);
    expect((await get(`/assets/${phone.id}/handovers`)).json().handovers).toHaveLength(1);

    const audit = await withTenantTx(prisma, tenantId, (tx) => tx.auditLog.findMany({ where: { action: { in: ['asset.delivered', 'asset.returned'] } } }));
    expect(audit).toHaveLength(2);
  });

  it("keeps another company's lines and handovers out of reach", async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: '10.96.1.1',
      payload: { tenantSlug: `${slug}-b`, tenantName: 'Otra', adminEmail: 'admin@otra.test', adminName: 'Otro', password: 'admin-password-1' },
    });
    const otherToken = other.json().token;
    const line = (await get('/mobile-lines?search=5555')).json().lines[0];
    const handover = (await get(`/assets/${line.asset.id}/handovers`)).json().handovers[0];
    const asOther = { authorization: `Bearer ${otherToken}` };
    expect((await app.inject({ method: 'GET', url: '/mobile-lines', headers: asOther })).json().lines).toHaveLength(0);
    expect((await app.inject({ method: 'PATCH', url: `/mobile-lines/${line.id}`, headers: asOther, payload: { plan: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/handovers/${handover.id}`, headers: asOther })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/assets/${line.asset.id}/handovers`, headers: asOther })).statusCode).toBe(404);
  });

  it('serves the private CA the enrollment QR pins, and nothing when there is none', async () => {
    const saved = process.env.TLS_CA_FILE;
    try {
      delete process.env.TLS_CA_FILE;
      expect((await app.inject({ method: 'GET', url: '/v1/devices/ca.pem' })).statusCode).toBe(404);

      const dir = await mkdtemp(join(tmpdir(), 'ca-'));
      const pem = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ2E=\n-----END CERTIFICATE-----\n';
      await writeFile(join(dir, 'ca.pem'), pem);
      process.env.TLS_CA_FILE = join(dir, 'ca.pem');
      const res = await app.inject({ method: 'GET', url: '/v1/devices/ca.pem' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(pem);
      // What the QR carries: the same hash the Devices page shows.
      const setup = (await get('/devices/agent-setup')).json();
      expect(setup.caCertSha256).toBe(sha256Hex(res.body));
      expect(setup.androidApkUrl).toMatch(/seredina-agent-android\.apk$/);

      await writeFile(join(dir, 'ca.pem'), `${pem}-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n`);
      expect((await app.inject({ method: 'GET', url: '/v1/devices/ca.pem' })).statusCode).toBe(404);
    } finally {
      if (saved === undefined) delete process.env.TLS_CA_FILE;
      else process.env.TLS_CA_FILE = saved;
    }
  });

  it('downloads the app from the mirror when there is one', async () => {
    const saved = process.env.AGENT_DOWNLOAD_URL;
    try {
      process.env.AGENT_DOWNLOAD_URL = 'https://files.example.com/agent/';
      expect((await get('/devices/agent-setup')).json().androidApkUrl).toBe('https://files.example.com/agent/seredina-agent-android.apk');
    } finally {
      if (saved === undefined) delete process.env.AGENT_DOWNLOAD_URL;
      else process.env.AGENT_DOWNLOAD_URL = saved;
    }
  });
});
