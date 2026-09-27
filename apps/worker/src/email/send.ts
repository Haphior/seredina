import { prisma, withTenantTx } from '@seredina/db';
import {
  defaultEmailTemplate,
  emailContextFor,
  emailString,
  parseEmailMeta,
  quoteExcerpt,
  renderBrandedEmail,
  renderTemplate,
  type EmailContent,
} from '@seredina/shared';
import { createTransportForChannel, pickSendChannel } from './transport';

/**
 * Emails a ticket message to its contact in the tenant's branded layout
 * (docs/adr/0070-customer-email-templates.md). An automatic ticket-event
 * message (acknowledgement, resolved, closed) carries its rendered text in
 * emailMeta; a person's reply goes through the tenant's "agent reply"
 * template, with their signature and the customer's last message quoted.
 */
export async function sendEmailMessage(tenantId: string, ticketId: string, messageId: string): Promise<void> {
  const data = await withTenantTx(prisma, tenantId, async (tx) => {
    const message = await tx.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { authorUser: { select: { name: true, emailSignature: true } } },
    });
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { contact: true } });
    // The mailbox the conversation arrived on, so the reply comes from the address
    // the customer wrote to; otherwise the tenant's first connected channel.
    const channel = pickSendChannel(await tx.emailChannel.findMany({ orderBy: { createdAt: 'asc' } }), ticket.emailChannelId);
    if (!channel) throw new Error('no connected email channel configured for this tenant');

    // The most recent inbound message with a Message-ID drives the In-Reply-To/
    // References headers so the customer's mail client threads the reply correctly.
    const lastInbound = await tx.message.findFirst({
      where: { ticketId, authorType: 'CONTACT', externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    // What the customer last wrote before this reply, to quote under it.
    const lastFromContact = await tx.message.findFirst({
      where: { ticketId, authorType: 'CONTACT', createdAt: { lte: message.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, slug: true, branding: true, emailSettings: true, customerPortalEnabled: true },
    });
    const replyTemplate = await tx.emailTemplate.findUnique({ where: { tenantId_event: { tenantId, event: 'agent_reply' } } });

    return { message, ticket, channel, lastInbound, lastFromContact, tenant, replyTemplate };
  });

  const { settings, brand, portalLink, from } = emailContextFor(data.tenant, process.env.WEB_ORIGIN, data.channel.fromAddress);
  const language = settings.language;
  const contact = data.ticket.contact;
  const meta = parseEmailMeta(data.message.emailMeta);

  let subject: string;
  let content: EmailContent;
  if (meta) {
    subject = meta.subject;
    content = { body: meta.body, button: meta.button };
  } else {
    const author = data.message.authorUser;
    const template = data.replyTemplate ?? defaultEmailTemplate('agent_reply', language);
    const rendered = renderTemplate(template, {
      company: data.tenant.name,
      contactName: contact.name ?? '',
      contactEmail: contact.email ?? '',
      ticketNumber: data.ticket.number,
      ticketSubject: data.ticket.subject,
      agentName: author?.name ?? '',
      message: data.message.body,
      portalLink: portalLink ?? '',
    });
    subject = rendered.subject;
    const quoted = settings.quoteHistory && data.lastFromContact?.body.trim() ? data.lastFromContact : null;
    content = {
      body: rendered.body,
      agentSignature: author ? author.emailSignature?.trim() || author.name : undefined,
      quote: quoted ? { author: contact.name || contact.email || '', body: quoteExcerpt(quoted.body) } : undefined,
    };
  }
  content.ticketNumber = data.ticket.number;
  content.ticketSubject = data.ticket.subject || emailString(language, 'noSubject');
  const { html, text } = renderBrandedEmail(brand, content);

  const transport = await createTransportForChannel(data.channel);

  // Stored as this outbound message's own externalId below -- if the customer
  // replies to THIS email, its In-Reply-To will carry this id and ingest.ts's
  // threading match finds it.
  const outboundMessageId = `<${data.message.id}@seredina>`;

  await transport.sendMail({
    from,
    to: contact.email,
    subject,
    text,
    html,
    messageId: outboundMessageId,
    inReplyTo: data.lastInbound?.externalId ?? undefined,
    references: data.lastInbound?.externalId ? [data.lastInbound.externalId] : undefined,
    // Automatic emails say so (RFC 3834), so the customer's own autoresponder
    // doesn't answer them and start a loop.
    headers: meta ? { 'Auto-Submitted': meta.event === 'ticket_created' ? 'auto-replied' : 'auto-generated' } : undefined,
  });

  await withTenantTx(prisma, tenantId, (tx) =>
    tx.message.update({ where: { id: messageId }, data: { externalId: outboundMessageId } }),
  );
}
