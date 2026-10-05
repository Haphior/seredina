import { prisma, withTenantTx } from '@seredina/db';
import {
  emailContextFor,
  emailString,
  formatEmailAmount,
  formatEmailDate,
  renderBrandedEmail,
} from '@seredina/shared';
import { notifyUser } from '../notifications/notify';
import { contactEmailQueue } from '../lib/queue';

/**
 * Contract payment reminders (docs/adr/0076-directory-payments-inventory.md).
 * A contract with a payment schedule gets one reminder when its next payment
 * enters the reminder window, and one more if the due date passes with no
 * payment recorded. Each goes to the contract's reminder addresses as a
 * branded email, and to everyone who manages assets as a CONTRACT_PAYMENT_DUE
 * notification (in-app, and email if they opted in).
 */
export async function sendDuePaymentReminders(today = new Date()): Promise<number> {
  // Cross-tenant discovery, ids only -- see list_contract_payments_due in rls/policies.sql.
  const due = await prisma.$queryRaw<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM list_contract_payments_due()
  `;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  let sent = 0;
  for (const { id, tenant_id: tenantId } of due) {
    try {
      const claimed = await withTenantTx(prisma, tenantId, async (tx) => {
        const contract = await tx.contract.findUnique({ where: { id }, include: { organization: { select: { name: true } } } });
        if (!contract?.nextPaymentDate || !contract.paymentFrequency) return null;
        const dueDate = contract.nextPaymentDate;
        const overdue = dueDate.getTime() < todayUtc;
        // Claim it first: a second replica (or an overlapping run) finds the
        // reminder for this due date already taken and sends nothing.
        const field = overdue ? 'paymentOverdueSentFor' : 'paymentReminderSentFor';
        const { count } = await tx.contract.updateMany({
          where: { id, OR: [{ [field]: null }, { [field]: { not: dueDate } }] },
          data: { [field]: dueDate },
        });
        if (count === 0) return null;
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { name: true, slug: true, branding: true, emailSettings: true, customerPortalEnabled: true },
        });
        const recipients = await tx.user.findMany({
          where: { isActive: true, role: { permissions: { some: { permission: { key: 'assets:manage' } } } } },
          select: { id: true },
        });
        return { contract, dueDate, overdue, tenant, recipients };
      });
      if (!claimed) continue;

      const { contract, dueDate, overdue, tenant, recipients } = claimed;
      const webOrigin = process.env.WEB_ORIGIN?.replace(/\/$/, '');
      const { brand, settings } = emailContextFor(tenant, webOrigin);
      const language = settings.language;
      const supplierName = contract.organization?.name ?? contract.supplier;
      const amountValue = contract.paymentAmount ?? contract.cost;
      const values = {
        name: contract.name,
        supplier: supplierName ? ` (${supplierName})` : '',
        amount: amountValue === null ? emailString(language, 'paymentAgreedAmount') : formatEmailAmount(language, Number(amountValue), contract.currency),
        date: formatEmailDate(language, dueDate),
      };
      const subject = emailString(language, overdue ? 'paymentOverdueSubject' : 'paymentDueSubject', values);
      const body = emailString(language, overdue ? 'paymentOverdueBody' : 'paymentDueBody', values);

      if (contract.paymentReminderEmails.length > 0) {
        // An internal reminder: the tenant's look, but no customer portal or banner.
        const { html, text } = renderBrandedEmail(
          { ...brand, portalLink: null, bannerUrl: null },
          { body, button: webOrigin ? { label: emailString(language, 'paymentButton'), url: `${webOrigin}/contracts` } : undefined },
        );
        for (const to of contract.paymentReminderEmails) {
          await contactEmailQueue.add('send', { tenantId, to, subject, text, html }, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
        }
      }
      for (const user of recipients) {
        await notifyUser(tenantId, user.id, 'CONTRACT_PAYMENT_DUE', { body: subject, subject });
      }
      sent++;
    } catch (err) {
      console.error(`[worker] payment reminder ${id} (tenant ${tenantId}) failed:`, err);
    }
  }
  return sent;
}
