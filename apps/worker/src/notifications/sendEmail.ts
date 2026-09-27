import { prisma, withTenantTx } from '@seredina/db';
import { emailContextFor, renderBrandedEmail, type NotificationEmailJobPayload } from '@seredina/shared';
import { createTransportForChannel, pickSendChannel } from '../email/transport';

/**
 * Consumes NOTIFICATION_EMAIL_QUEUE_NAME regardless of which app produced the
 * job -- apps/api (TICKET_ASSIGNED) and apps/worker itself (NEW_REPLY) both
 * enqueue onto it. Silently no-ops if the tenant has no active EmailChannel
 * (a notification email is best-effort, unlike the ticket-reply email path in
 * send.ts, which throws when there's no channel to send through) -- see
 * docs/adr/0022-notifications.md.
 */
export async function sendNotificationEmail(payload: NotificationEmailJobPayload): Promise<void> {
  const data = await withTenantTx(prisma, payload.tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: payload.userId } });
    if (!user) return null;
    const channel = pickSendChannel(await tx.emailChannel.findMany({ orderBy: { createdAt: 'asc' } }), null);
    if (!channel) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: payload.tenantId },
      select: { name: true, slug: true, branding: true, emailSettings: true, customerPortalEnabled: true },
    });
    return { user, channel, tenant };
  });
  if (!data) return;

  // Same layout and sender name as the tenant's customer email
  // (docs/adr/0070-customer-email-templates.md), minus the customer-only bits.
  const { brand, from } = emailContextFor(data.tenant, process.env.WEB_ORIGIN, data.channel.fromAddress);
  const { html, text } = renderBrandedEmail({ ...brand, signature: '', portalLink: null, bannerUrl: null }, { body: payload.body });
  const transport = await createTransportForChannel(data.channel);
  await transport.sendMail({
    from,
    to: data.user.email,
    subject: payload.subject,
    text,
    html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  });
}
