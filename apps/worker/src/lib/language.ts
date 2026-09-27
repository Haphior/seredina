import { prisma, withTenantTx } from '@seredina/db';
import { parseEmailSettings, type EmailLanguage } from '@seredina/shared';

/**
 * The tenant's language for everything Seredina writes on its behalf --
 * notifications included (docs/adr/0070-customer-email-templates.md).
 */
export async function tenantLanguage(tenantId: string): Promise<EmailLanguage> {
  const tenant = await withTenantTx(prisma, tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { emailSettings: true } }));
  return parseEmailSettings(tenant.emailSettings).language;
}
