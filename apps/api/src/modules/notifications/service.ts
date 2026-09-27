import { prisma, resolveNotificationPreference, withTenantTx, type NotificationEventType } from '@seredina/db';
import { publishLive } from '../../lib/live';
import { notificationEmailQueue } from '../../lib/queue';

const EVENT_LABELS: Record<NotificationEventType, string> = {
  TICKET_ASSIGNED: 'A ticket is assigned to me',
  NEW_REPLY: 'A contact replies to a ticket assigned to me',
  TEAM_TICKET: 'A ticket lands in one of my teams with nobody assigned',
  TICKET_REOPENED: 'A customer reopens a ticket of mine',
  MENTIONED: 'Someone mentions me in an internal note',
  SLA_WARNING: 'An SLA target on my ticket is about to be missed',
  SLA_BREACHED: 'An SLA target on my ticket was missed',
  CONTRACT_EXPIRING: 'A contract, warranty or license is about to expire (users who manage assets)',
};

/** Display order: ticket events first, then SLA, then contracts. EVENT_LABELS' type keeps the set complete. */
export const EVENT_TYPES: NotificationEventType[] = [
  'TICKET_ASSIGNED',
  'NEW_REPLY',
  'TEAM_TICKET',
  'TICKET_REOPENED',
  'MENTIONED',
  'SLA_WARNING',
  'SLA_BREACHED',
  'CONTRACT_EXPIRING',
];

export async function listNotifications(tenantId: string, userId: string, unreadOnly = false) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.notification.findMany({
      where: { userId, readAt: unreadOnly ? null : undefined },
      include: { ticket: { select: { id: true, number: true, subject: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  );
}

export async function getUnreadCount(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.notification.count({ where: { userId, readAt: null } }));
}

export async function markNotificationRead(tenantId: string, userId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new Error('notification not found');
    return tx.notification.update({ where: { id }, data: { readAt: new Date() } });
  });
}

export async function markAllNotificationsRead(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }),
  );
}

/**
 * Each event with what this user actually gets, and where that comes from:
 * their own choice ('user'), the workspace default an admin set
 * ('workspace'), or the built-in default ('builtin').
 */
export async function getPreferences(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const [own, workspace] = await Promise.all([
      tx.notificationPreference.findMany({ where: { userId } }),
      tx.tenantNotificationDefault.findMany(),
    ]);
    const ownByType = new Map(own.map((r) => [r.eventType, r]));
    const workspaceByType = new Map(workspace.map((r) => [r.eventType, r]));
    return EVENT_TYPES.map((eventType) => {
      const row = ownByType.get(eventType) ?? workspaceByType.get(eventType);
      const source = ownByType.has(eventType) ? 'user' : workspaceByType.has(eventType) ? 'workspace' : 'builtin';
      return { eventType, label: EVENT_LABELS[eventType], inApp: row?.inApp ?? true, email: row?.email ?? false, source };
    });
  });
}

export interface UpdatePreferenceInput {
  inApp?: boolean;
  email?: boolean;
}

/** A field left out keeps what the user currently gets, including a workspace default. */
export async function updatePreference(
  tenantId: string,
  userId: string,
  eventType: NotificationEventType,
  input: UpdatePreferenceInput,
) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const current = await resolveNotificationPreference(tx, userId, eventType);
    const next = { inApp: input.inApp ?? current.inApp, email: input.email ?? current.email };
    return tx.notificationPreference.upsert({
      where: { userId_eventType: { userId, eventType } },
      create: { tenantId, userId, eventType, ...next },
      update: next,
    });
  });
}

/** Drops the user's own choice, so the workspace default applies again. */
export async function resetPreference(tenantId: string, userId: string, eventType: NotificationEventType) {
  await withTenantTx(prisma, tenantId, (tx) => tx.notificationPreference.deleteMany({ where: { userId, eventType } }));
}

/** The workspace defaults, one entry per event (built-in values where an admin set none). */
export async function getWorkspaceDefaults(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const rows = await tx.tenantNotificationDefault.findMany();
    const byType = new Map(rows.map((r) => [r.eventType, r]));
    return EVENT_TYPES.map((eventType) => ({
      eventType,
      label: EVENT_LABELS[eventType],
      inApp: byType.get(eventType)?.inApp ?? true,
      email: byType.get(eventType)?.email ?? false,
    }));
  });
}

export async function setWorkspaceDefault(tenantId: string, eventType: NotificationEventType, input: UpdatePreferenceInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.tenantNotificationDefault.findUnique({ where: { tenantId_eventType: { tenantId, eventType } } });
    const next = { inApp: input.inApp ?? existing?.inApp ?? true, email: input.email ?? existing?.email ?? false };
    return tx.tenantNotificationDefault.upsert({
      where: { tenantId_eventType: { tenantId, eventType } },
      create: { tenantId, eventType, ...next },
      update: next,
    });
  });
}

export interface NotifyInput {
  ticketId?: string;
  /** Shown in-app. */
  body: string;
  /** Only used if the preference calls for email too. */
  subject: string;
}

/**
 * The one "tell a user something happened" entry point on the apps/api side --
 * writes the in-app Notification row (if the recipient's preference allows it)
 * inside its own short transaction, then enqueues the email delivery job
 * OUTSIDE any transaction if the preference also calls for email (network I/O
 * never belongs inside withTenantTx). apps/worker has its own, near-identical
 * copy of this function (modules/notifications/notify.ts there) for the
 * NEW_REPLY event, which only ever fires from the worker's own inbound-email
 * ingest -- see docs/adr/0022-notifications.md for why that isn't shared code.
 */
export async function notifyUser(tenantId: string, userId: string, eventType: NotificationEventType, input: NotifyInput) {
  const { inApp, needsEmail } = await withTenantTx(prisma, tenantId, async (tx) => {
    const pref = await resolveNotificationPreference(tx, userId, eventType);
    if (pref.inApp) {
      await tx.notification.create({ data: { tenantId, userId, eventType, ticketId: input.ticketId, body: input.body } });
    }
    return { inApp: pref.inApp, needsEmail: pref.email };
  });

  if (inApp) await publishLive(tenantId, { type: 'notification.created', userId });

  if (needsEmail) {
    await notificationEmailQueue.add('send', { tenantId, userId, subject: input.subject, body: input.body });
  }
}

/** notifyUser for each of several people -- one failure doesn't stop the rest. */
export async function notifyUsers(tenantId: string, userIds: string[], eventType: NotificationEventType, input: NotifyInput) {
  for (const userId of new Set(userIds)) {
    await notifyUser(tenantId, userId, eventType, input).catch((err) =>
      console.error(`[notifications] could not notify ${userId} of ${eventType}:`, err),
    );
  }
}
