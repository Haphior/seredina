import { prisma, withTenantTx } from '@seredina/db';
import { formatFrom, parseEmailSettings, type ContactEmailJobPayload } from '@seredina/shared';
import { createTransportForChannel, pickSendChannel } from './transport';

/**
 * A one-off email to a contact or user that isn't a ticket reply -- a portal
 * sign-in link, a password reset, an invitation (docs/adr/0065-customer-portal.md).
 * The API renders it in the tenant's language and layout; this sends it from
 * the tenant's first connected mailbox under its sender name.
 */
export async function sendContactEmail(payload: ContactEmailJobPayload): Promise<void> {
  const { channel, tenant } = await withTenantTx(prisma, payload.tenantId, async (tx) => ({
    channel: pickSendChannel(await tx.emailChannel.findMany({ orderBy: { createdAt: 'asc' } }), null),
    tenant: await tx.tenant.findUniqueOrThrow({ where: { id: payload.tenantId }, select: { name: true, emailSettings: true } }),
  }));
  if (!channel) throw new Error('no connected email channel configured for this tenant');
  const transport = await createTransportForChannel(channel);
  const senderName = parseEmailSettings(tenant.emailSettings).senderName || tenant.name;
  await transport.sendMail({
    from: formatFrom(senderName, channel.fromAddress),
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  });
}
