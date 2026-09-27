import { prisma, reopenOnCustomerReply, ticketNotificationRecipients, withTenantTx } from '@seredina/db';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_SIZE_BYTES, emailString, parseEmailSettings, type EmailLanguage } from '@seredina/shared';
import { publishLive } from '../lib/live';
import { ticketFollowupQueue } from '../lib/queue';

export interface InboundAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
  /** An inline image referenced from the HTML body (a pasted screenshot, a signature logo). */
  inline: boolean;
}

export interface InboundEmail {
  tenantId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  /** The mailbox it arrived on -- replies go back out through the same one. */
  emailChannelId?: string | null;
  attachments?: InboundAttachment[];
  /** Sent by a machine (an out-of-office, a bounce, a list): no acknowledgement goes back. */
  automatic?: boolean;
}

export interface ReplyNotice {
  /** TICKET_REOPENED when the reply reopened a resolved/closed ticket, else NEW_REPLY. */
  event: 'NEW_REPLY' | 'TICKET_REOPENED';
  userIds: string[];
  ticketId: string;
  ticketNumber: number;
  ticketSubject: string;
}

export interface IngestResult {
  ticketId: string;
  // Set only when this reply landed on an EXISTING ticket -- a brand new
  // ticket has nobody to tell yet. The caller notifies AFTER this transaction
  // closes (see poll.ts) -- see docs/adr/0022-notifications.md and
  // docs/adr/0071-teams-and-notification-events.md.
  replyNotice: ReplyNotice | null;
}

/**
 * Threads a reply onto its existing ticket by matching In-Reply-To/References
 * against a stored Message.externalId (set on both inbound and outbound messages --
 * see send.ts); no match means a new conversation, so a new Ticket. Unlike alert
 * ingestion's dedup (docs/adr/0003-alert-ingestion.md), a reply to a CLOSED ticket's
 * thread reopens it rather than starting a new ticket -- it's the same conversation
 * either way, not a new occurrence of a recurring problem the way a re-fired
 * monitoring alert is.
 */
export async function ingestInboundEmail(email: InboundEmail): Promise<IngestResult> {
  let createdTicket = false;
  let duplicate = false;
  const result = await withTenantTx(prisma, email.tenantId, async (tx) => {
    // Idempotent on Message-ID: a replica that dies after ingesting but before
    // flagging the mail \Seen would otherwise create it again on the next poll.
    const alreadyIngested = await tx.message.findFirst({
      where: { externalId: email.messageId, authorType: 'CONTACT' },
      select: { ticketId: true },
    });
    if (alreadyIngested) {
      duplicate = true;
      return { ticketId: alreadyIngested.ticketId, replyNotice: null };
    }

    // Notes written into the ticket are in the tenant's language, like
    // everything a customer can see (docs/adr/0070-customer-email-templates.md).
    const { emailSettings } = await tx.tenant.findUniqueOrThrow({ where: { id: email.tenantId }, select: { emailSettings: true } });
    const language = parseEmailSettings(emailSettings).language;
    const { kept, skippedNote } = selectInboundAttachments(email.attachments ?? [], language);

    const candidateIds = [email.inReplyTo, ...email.references].filter((v): v is string => Boolean(v));

    const existingMessage =
      candidateIds.length > 0
        ? await tx.message.findFirst({
            where: { externalId: { in: candidateIds } },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    const contact = await tx.contact.upsert({
      where: { tenantId_email: { tenantId: email.tenantId, email: email.fromAddress } },
      create: { tenantId: email.tenantId, email: email.fromAddress, name: email.fromName || email.fromAddress },
      update: { name: email.fromName || email.fromAddress },
    });

    let ticketId: string;
    let replyNotice: ReplyNotice | null = null;

    if (existingMessage) {
      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: existingMessage.ticketId },
        include: { status: true },
      });
      ticketId = ticket.id;

      const reopened = await reopenOnCustomerReply(tx, ticket);

      if (!ticket.emailChannelId && email.emailChannelId) {
        await tx.ticket.update({ where: { id: ticketId }, data: { emailChannelId: email.emailChannelId } });
      }

      // A plain reply tells the assignee; a reopen tells the assignee, or the
      // team when nobody is assigned.
      const userIds = reopened ? await ticketNotificationRecipients(tx, ticket) : ticket.assigneeId ? [ticket.assigneeId] : [];
      if (userIds.length > 0) {
        replyNotice = {
          event: reopened ? 'TICKET_REOPENED' : 'NEW_REPLY',
          userIds,
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          ticketSubject: ticket.subject,
        };
      }
    } else {
      const openStatus = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
      if (!openStatus) throw new Error('tenant has no "open" ticket status configured');

      const tenant = await tx.tenant.update({
        where: { id: email.tenantId },
        data: { lastTicketNumber: { increment: 1 } },
      });

      const ticket = await tx.ticket.create({
        data: {
          tenantId: email.tenantId,
          number: tenant.lastTicketNumber,
          subject: email.subject.trim() || emailString(language, 'noSubject'),
          statusId: openStatus.id,
          contactId: contact.id,
          channel: 'email',
          emailChannelId: email.emailChannelId ?? null,
        },
      });
      ticketId = ticket.id;
      createdTicket = true;
    }

    const message = await tx.message.create({
      data: {
        tenantId: email.tenantId,
        ticketId,
        authorType: 'CONTACT',
        body: skippedNote ? `${email.text}\n\n${skippedNote}` : email.text,
        isPrivateNote: false,
        externalId: email.messageId,
      },
    });

    for (const a of kept) {
      await tx.attachment.create({
        data: {
          tenantId: email.tenantId,
          messageId: message.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.data.byteLength,
          data: a.data,
        },
      });
    }

    return { ticketId, replyNotice };
  });

  if (duplicate) return result;

  // After the commit, never inside it -- see docs/adr/0053-live-updates.md.
  await publishLive(email.tenantId, { type: createdTicket ? 'ticket.created' : 'message.created', ticketId: result.ticketId });
  if (createdTicket) {
    // SLA clock, ticket.created webhook and AI triage live in apps/api's ticket
    // service -- see docs/adr/0063-ai-triage.md. Best-effort: the ticket exists
    // either way.
    await ticketFollowupQueue
      .add(
        'followup',
        { tenantId: email.tenantId, ticketId: result.ticketId, finalize: true, acknowledge: !email.automatic },
        { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000 },
      )
      .catch((err) => console.error(`[worker] could not queue follow-up for ticket ${result.ticketId}:`, err));
  }
  return result;
}

/**
 * Same caps as a manual upload (packages/shared/src/attachments.ts). Real
 * attachments are kept before inline images, so a signature logo can't push
 * out the file the customer actually sent. Whatever doesn't fit is named in a
 * note on the message instead of disappearing silently -- see
 * docs/adr/0058-inbound-email-attachments.md.
 */
export function selectInboundAttachments(
  attachments: InboundAttachment[],
  language: EmailLanguage = 'es',
): {
  kept: InboundAttachment[];
  skippedNote: string | null;
} {
  const ordered = [...attachments.filter((a) => !a.inline), ...attachments.filter((a) => a.inline)];
  const kept: InboundAttachment[] = [];
  const skipped: string[] = [];

  const es = language === 'es';
  const limitMb = MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024);
  for (const a of ordered) {
    if (a.data.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
      const mb = (a.data.byteLength / (1024 * 1024)).toFixed(1);
      skipped.push(es ? `${a.filename} (${mb} MB, supera el límite de ${limitMb} MB)` : `${a.filename} (${mb} MB, over the ${limitMb} MB limit)`);
    } else if (kept.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      // Inline images past the cap are almost always signature logos -- not worth a note.
      if (!a.inline) {
        skipped.push(es ? `${a.filename} (más de ${MAX_ATTACHMENTS_PER_MESSAGE} adjuntos)` : `${a.filename} (more than ${MAX_ATTACHMENTS_PER_MESSAGE} attachments)`);
      }
    } else {
      kept.push(a);
    }
  }

  const label = es ? 'Adjuntos no guardados' : 'Attachments not saved';
  return {
    kept,
    skippedNote: skipped.length > 0 ? `[${label}: ${skipped.join('; ')}]` : null,
  };
}

/**
 * Whether an inbound email was sent by a machine rather than a person: an
 * out-of-office or other autoresponder (RFC 3834 Auto-Submitted, Exchange's
 * X-Auto-Response-Suppress, X-Autoreply), a bulk or list mailing, or a
 * bounce. It still becomes a ticket or a reply, but gets no automatic
 * acknowledgement, which could otherwise loop between two autoresponders.
 */
export function isAutomaticEmail(headers: Map<string, unknown>, fromAddress: string): boolean {
  const header = (name: string) => {
    const v = headers.get(name);
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v.toLowerCase();
    if (typeof v === 'object' && 'value' in (v as object)) return String((v as { value: unknown }).value).toLowerCase();
    return String(v).toLowerCase();
  };
  const autoSubmitted = header('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(header('precedence'))) return true;
  if (headers.has('x-autoreply') || headers.has('x-autorespond') || headers.has('list-id')) return true;
  if (/(^|,)\s*(all|oof|autoreply)\s*(,|$)/.test(header('x-auto-response-suppress'))) return true;
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(fromAddress);
}
