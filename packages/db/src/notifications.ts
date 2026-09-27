import type { NotificationEventType, Prisma } from '@prisma/client';

/**
 * Notification rules shared by apps/api and apps/worker, which each keep their
 * own notifyUser (docs/adr/0022-notifications.md) but must agree on who gets
 * what -- see docs/adr/0071-teams-and-notification-events.md.
 */

export const BUILT_IN_NOTIFICATION_DEFAULT = { inApp: true, email: false } as const;

/**
 * What a user gets for an event: their own choice if they made one, else the
 * workspace default an admin set, else the built-in default.
 */
export async function resolveNotificationPreference(
  tx: Prisma.TransactionClient,
  userId: string,
  eventType: NotificationEventType,
): Promise<{ inApp: boolean; email: boolean }> {
  const own = await tx.notificationPreference.findUnique({ where: { userId_eventType: { userId, eventType } } });
  if (own) return { inApp: own.inApp, email: own.email };
  const workspace = await tx.tenantNotificationDefault.findFirst({ where: { eventType } });
  if (workspace) return { inApp: workspace.inApp, email: workspace.email };
  return { ...BUILT_IN_NOTIFICATION_DEFAULT };
}

/**
 * Who hears about something happening on a ticket: its assignee, or -- when
 * nobody is assigned -- every member of its team. Never the person who caused
 * it (`exceptUserId`).
 */
export async function ticketNotificationRecipients(
  tx: Prisma.TransactionClient,
  ticket: { assigneeId: string | null; teamId: string | null },
  exceptUserId?: string | null,
): Promise<string[]> {
  let ids: string[];
  if (ticket.assigneeId) ids = [ticket.assigneeId];
  else if (ticket.teamId) {
    const members = await tx.teamMember.findMany({ where: { teamId: ticket.teamId }, select: { userId: true } });
    ids = members.map((m) => m.userId);
  } else ids = [];
  return ids.filter((id) => id !== exceptUserId);
}
