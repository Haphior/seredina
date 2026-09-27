import type { Prisma, TicketStatusCategory } from '@prisma/client';

/**
 * A customer writing back on a resolved or closed ticket reopens it -- the
 * same conversation, not a new request. Shared by every customer channel
 * that can reply (email ingest in apps/worker, the portal in apps/api).
 * Returns whether the ticket was reopened, so the caller can send
 * TICKET_REOPENED instead of a plain "new reply" notification
 * (docs/adr/0071-teams-and-notification-events.md).
 *
 * resolvedAt is kept: it records when the ticket was first resolved, for
 * reporting, and updateTicket only ever stamps it once.
 */
export async function reopenOnCustomerReply(
  tx: Prisma.TransactionClient,
  ticket: { id: string; status: { category: TicketStatusCategory } },
): Promise<boolean> {
  if (ticket.status.category !== 'RESOLVED' && ticket.status.category !== 'CLOSED') return false;
  const open = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
  if (!open) return false;
  await tx.ticket.update({ where: { id: ticket.id }, data: { statusId: open.id, closedAt: null } });
  return true;
}
