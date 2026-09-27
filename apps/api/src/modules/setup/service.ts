import { prisma, withTenantTx, type Prisma, type TicketPriority } from '@seredina/db';
import { parseEmailSettings, type BusinessHoursSchedule, type EmailLanguage } from '@seredina/shared';
import { translateSeededStatusLabels } from '../tickets/service';
import { SETUP_TEMPLATES, type SetupTemplateKey } from './templates';

/**
 * The first-run setup wizard's server side (docs/adr/0072-first-run-setup.md).
 * Each step writes ordinary tenant data through the same tables the
 * Settings pages edit, so skipping the wizard or redoing a step later from
 * Settings is always possible.
 */

export interface SetupStatus {
  completed: boolean;
  tenantName: string;
  language: EmailLanguage;
  businessHours: { timezone: string } | null;
  mailboxes: number;
  template: SetupTemplateKey | null;
  users: number;
  teams: number;
}

export async function getSetupStatus(tenantId: string): Promise<SetupStatus> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const [tenant, hours, mailboxes, users, teams] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      tx.businessHours.findUnique({ where: { tenantId } }),
      tx.emailChannel.count(),
      tx.user.count({ where: { isActive: true } }),
      tx.team.count(),
    ]);
    return {
      completed: tenant.setupCompletedAt !== null,
      tenantName: tenant.name,
      language: parseEmailSettings(tenant.emailSettings).language,
      businessHours: hours ? { timezone: hours.timezone } : null,
      mailboxes,
      template: (tenant.setupTemplate as SetupTemplateKey | null) ?? null,
      users,
      teams,
    };
  });
}

/** Working-hours presets; 'none' leaves business hours unset (SLAs count every hour). */
export const SCHEDULE_PRESETS = {
  office: { start: '09:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  early: { start: '08:00', end: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  shifts: { start: '00:00', end: '24:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
  always: { start: '00:00', end: '24:00', days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
} as const;
export type SchedulePreset = keyof typeof SCHEDULE_PRESETS | 'none';

export interface OrganizationInput {
  tenantName?: string;
  language?: EmailLanguage;
  timezone?: string;
  schedule?: SchedulePreset;
}

export async function saveOrganization(tenantId: string, input: OrganizationInput) {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch {
      throw new Error('unknown timezone');
    }
  }
  await withTenantTx(prisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const data: Prisma.TenantUpdateInput = {};
    if (input.tenantName?.trim()) data.name = input.tenantName.trim();
    if (input.language) {
      const settings = (tenant.emailSettings && typeof tenant.emailSettings === 'object' ? tenant.emailSettings : {}) as Record<string, unknown>;
      data.emailSettings = { ...settings, language: input.language } as Prisma.InputJsonValue;
      await translateSeededStatusLabels(tx, input.language);
    }
    await tx.tenant.update({ where: { id: tenantId }, data });

    if (input.schedule && input.schedule !== 'none') {
      const preset = SCHEDULE_PRESETS[input.schedule];
      const schedule: BusinessHoursSchedule = Object.fromEntries(preset.days.map((d) => [d, [{ start: preset.start, end: preset.end }]]));
      const timezone = input.timezone ?? 'UTC';
      await tx.businessHours.upsert({
        where: { tenantId },
        create: { tenantId, timezone, schedule: schedule as Prisma.InputJsonValue },
        update: { timezone, schedule: schedule as Prisma.InputJsonValue },
      });
    }
  });
}

export interface TemplateResult {
  teams: number;
  slaPolicies: number;
  macros: number;
  customFields: number;
  catalogItems: number;
}

/**
 * Creates what a template brings, skipping anything already there by name
 * (or, for SLAs, any priority that already has a policy) -- so applying it to
 * a workspace in use, or twice, never overwrites or duplicates. Returns what
 * was actually created.
 */
export async function applyTemplate(tenantId: string, key: SetupTemplateKey): Promise<TemplateResult> {
  const template = SETUP_TEMPLATES[key];
  return withTenantTx(prisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const lang = parseEmailSettings(tenant.emailSettings).language;
    const result: TemplateResult = { teams: 0, slaPolicies: 0, macros: 0, customFields: 0, catalogItems: 0 };

    for (const team of template.teams) {
      const name = team[lang];
      if (await tx.team.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) continue;
      await tx.team.create({ data: { tenantId, name } });
      result.teams++;
    }

    const hasBusinessHours = Boolean(await tx.businessHours.findUnique({ where: { tenantId } }));
    for (const [priority, target] of Object.entries(template.sla) as [TicketPriority, { firstResponse: number; resolution: number }][]) {
      if (await tx.slaPolicy.findUnique({ where: { tenantId_priority: { tenantId, priority } } })) continue;
      await tx.slaPolicy.create({
        data: {
          tenantId,
          priority,
          firstResponseMinutes: target.firstResponse,
          resolutionMinutes: target.resolution,
          // Urgent work is urgent at night too; the rest follows working hours when there are any.
          businessHoursOnly: hasBusinessHours && priority !== 'URGENT',
        },
      });
      result.slaPolicies++;
    }

    const statuses = await tx.ticketStatus.findMany({ where: { key: { in: ['pending', 'resolved'] } } });
    const statusId = (k?: 'pending' | 'resolved') => (k ? statuses.find((s) => s.key === k)?.id : undefined);
    for (const macro of template.macros) {
      const name = macro.name[lang];
      if (await tx.macro.findUnique({ where: { tenantId_name: { tenantId, name } } })) continue;
      const actions = { addReply: { body: macro.reply[lang], isPrivateNote: false }, setStatusId: statusId(macro.status) };
      await tx.macro.create({ data: { tenantId, name, actions: actions as Prisma.InputJsonValue } });
      result.macros++;
    }

    const fields = [
      { key: 'category', label: lang === 'es' ? 'Categoría' : 'Category', fieldType: 'SELECT' as const, options: template.categories.map((c) => c[lang]) },
      ...(template.extraField ? [{ key: template.extraField.key, label: template.extraField.label[lang], fieldType: 'TEXT' as const, options: [] }] : []),
    ];
    let fieldOrder = await tx.customFieldDefinition.count();
    for (const field of fields) {
      if (await tx.customFieldDefinition.findUnique({ where: { tenantId_key: { tenantId, key: field.key } } })) continue;
      await tx.customFieldDefinition.create({ data: { tenantId, ...field, sortOrder: fieldOrder++ } });
      result.customFields++;
    }

    const fieldKeys = fields.map((f) => f.key);
    let itemOrder = await tx.serviceCatalogItem.count();
    for (const item of template.catalog) {
      const name = item.name[lang];
      if (await tx.serviceCatalogItem.findUnique({ where: { tenantId_name: { tenantId, name } } })) continue;
      await tx.serviceCatalogItem.create({
        data: { tenantId, name, description: item.description[lang], icon: item.icon, customFieldKeys: fieldKeys, sortOrder: itemOrder++ },
      });
      result.catalogItems++;
    }

    await tx.tenant.update({ where: { id: tenantId }, data: { setupTemplate: key } });
    return result;
  });
}

/** Finished, or skipped: either way the console stops offering the wizard. */
export async function completeSetup(tenantId: string) {
  await withTenantTx(prisma, tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { setupCompletedAt: new Date() } }));
}
