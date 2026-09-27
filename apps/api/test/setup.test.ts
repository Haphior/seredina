import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { parseEmailSettings } from '@seredina/shared';
import { applyTemplate, completeSetup, getSetupStatus, saveOrganization } from '../src/modules/setup/service';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

/** First-run setup -- docs/adr/0072-first-run-setup.md. */
describe.skipIf(!hasDb)('First-run setup', () => {
  async function newTenant(language?: 'es' | 'en') {
    const tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, slug: `setup-${tenantId.slice(0, 8)}`, name: 'Setup', emailSettings: language ? { language } : undefined },
      });
      await seedDefaultTicketStatuses(tx, tenantId, 'en');
      await tx.team.create({ data: { tenantId, name: 'General' } });
      await tx.user.create({ data: { tenantId, email: 'admin@setup.test', name: 'Admin', passwordHash: 'x' } });
    });
    return tenantId;
  }

  describe('organization', () => {
    let tenantId: string;
    beforeAll(async () => {
      tenantId = await newTenant('en');
    });

    it('starts not completed, reporting what is already there', async () => {
      expect(await getSetupStatus(tenantId)).toMatchObject({
        completed: false,
        tenantName: 'Setup',
        language: 'en',
        businessHours: null,
        mailboxes: 0,
        template: null,
        users: 1,
        teams: 1,
      });
    });

    it('switching to Spanish renames the seeded statuses, but never one an admin renamed', async () => {
      await withTenantTx(prisma, tenantId, (tx) => tx.ticketStatus.updateMany({ where: { key: 'pending' }, data: { label: 'Waiting on customer' } }));
      await saveOrganization(tenantId, { tenantName: 'Planta Norte', language: 'es' });
      const statuses = await withTenantTx(prisma, tenantId, (tx) => tx.ticketStatus.findMany({ orderBy: { sortOrder: 'asc' } }));
      expect(statuses.map((s) => s.label)).toEqual(['Abierto', 'Waiting on customer', 'Resuelto', 'Cerrado']);
      const tenant = await withTenantTx(prisma, tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }));
      expect(tenant.name).toBe('Planta Norte');
      expect(parseEmailSettings(tenant.emailSettings).language).toBe('es');
    });

    it('keeps the rest of the email settings when changing the language', async () => {
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: { emailSettings: { language: 'es', senderName: 'Mesa de ayuda' } } }),
      );
      await saveOrganization(tenantId, { language: 'en' });
      const tenant = await withTenantTx(prisma, tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }));
      expect(parseEmailSettings(tenant.emailSettings)).toMatchObject({ language: 'en', senderName: 'Mesa de ayuda' });
    });

    it('sets working hours from a preset, in the given timezone, and rejects an unknown timezone', async () => {
      await saveOrganization(tenantId, { timezone: 'America/Santiago', schedule: 'early' });
      const hours = await withTenantTx(prisma, tenantId, (tx) => tx.businessHours.findUniqueOrThrow({ where: { tenantId } }));
      expect(hours.timezone).toBe('America/Santiago');
      expect(hours.schedule).toMatchObject({ mon: [{ start: '08:00', end: '17:30' }], fri: [{ start: '08:00', end: '17:30' }] });
      expect((hours.schedule as Record<string, unknown>).sat).toBeUndefined();

      await expect(saveOrganization(tenantId, { timezone: 'Mars/Olympus', schedule: 'office' })).rejects.toThrow('unknown timezone');
    });

    it('completing records it', async () => {
      await completeSetup(tenantId);
      expect((await getSetupStatus(tenantId)).completed).toBe(true);
    });
  });

  describe('templates', () => {
    it('creates teams, SLAs, macros, fields and catalog items in the workspace language', async () => {
      const tenantId = await newTenant('es');
      const created = await applyTemplate(tenantId, 'manufacturing');
      expect(created).toEqual({ teams: 3, slaPolicies: 4, macros: 4, customFields: 2, catalogItems: 4 });

      const [teams, fields, items, macros, sla] = await withTenantTx(prisma, tenantId, (tx) =>
        Promise.all([
          tx.team.findMany({ orderBy: { name: 'asc' } }),
          tx.customFieldDefinition.findMany({ orderBy: { sortOrder: 'asc' } }),
          tx.serviceCatalogItem.findMany({ orderBy: { sortOrder: 'asc' } }),
          tx.macro.findMany(),
          tx.slaPolicy.findUniqueOrThrow({ where: { tenantId_priority: { tenantId, priority: 'URGENT' } } }),
        ]),
      );
      expect(teams.map((t) => t.name)).toEqual(['Calidad', 'General', 'Mantención', 'TI planta']);
      expect(fields.map((f) => [f.key, f.label])).toEqual([['category', 'Categoría'], ['area', 'Línea o área']]);
      expect(fields[0].options).toContain('Máquina detenida');
      expect(items[0]).toMatchObject({ name: 'Reportar falla de máquina', customFieldKeys: ['category', 'area'] });
      expect(sla).toMatchObject({ firstResponseMinutes: 10, resolutionMinutes: 120 });

      // A macro that parks the ticket points at the real "pending" status.
      const waiting = macros.find((m) => m.name === 'Esperando repuesto');
      const pending = await withTenantTx(prisma, tenantId, (tx) => tx.ticketStatus.findFirstOrThrow({ where: { key: 'pending' } }));
      expect(waiting?.actions).toMatchObject({ setStatusId: pending.id, addReply: { isPrivateNote: false } });

      expect((await getSetupStatus(tenantId)).template).toBe('manufacturing');
    });

    it('never overwrites or duplicates: a second run and an existing SLA are left alone', async () => {
      const tenantId = await newTenant('en');
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.slaPolicy.create({ data: { tenantId, priority: 'URGENT', firstResponseMinutes: 5, resolutionMinutes: 30, businessHoursOnly: false } }),
      );
      const first = await applyTemplate(tenantId, 'it_internal');
      expect(first.slaPolicies).toBe(3);
      const second = await applyTemplate(tenantId, 'it_internal');
      expect(second).toEqual({ teams: 0, slaPolicies: 0, macros: 0, customFields: 0, catalogItems: 0 });

      const urgent = await withTenantTx(prisma, tenantId, (tx) => tx.slaPolicy.findUniqueOrThrow({ where: { tenantId_priority: { tenantId, priority: 'URGENT' } } }));
      expect(urgent.firstResponseMinutes).toBe(5);
    });

    it('with working hours set, only urgent SLAs run around the clock', async () => {
      const tenantId = await newTenant('es');
      await saveOrganization(tenantId, { timezone: 'America/Santiago', schedule: 'office' });
      await applyTemplate(tenantId, 'customer_support');
      const policies = await withTenantTx(prisma, tenantId, (tx) => tx.slaPolicy.findMany());
      expect(Object.fromEntries(policies.map((p) => [p.priority, p.businessHoursOnly]))).toEqual({
        URGENT: false,
        HIGH: true,
        NORMAL: true,
        LOW: true,
      });
    });
  });
});
