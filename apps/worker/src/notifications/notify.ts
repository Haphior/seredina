import { prisma, resolveNotificationPreference, withTenantTx, type NotificationEventType } from '@seredina/db';
import { notificationEmailQueue } from '../lib/queue';
import { publishLive } from '../lib/live';

export interface NotifyInput {
  ticketId?: string;
  body: string;
  subject: string;
}

/**
 * The worker-side twin of apps/api/src/modules/notifications/service.ts's
 * notifyUser -- same preference-check-then-write-then-maybe-enqueue shape,
 * duplicated rather than shared because apps/worker never imports apps/api
 * code (see docs/adr/0020-oncall-escalation.md for the first time this
 * exact call was made, for the escalation engine). Called for events that
 * start in the worker: replies and reopens from inbound email, SLA warnings
 * and breaches, contract renewals -- see docs/adr/0022-notifications.md and
 * docs/adr/0071-teams-and-notification-events.md. Who gets what is shared
 * with apps/api through @seredina/db's resolveNotificationPreference.
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
      console.error(`[worker] could not notify ${userId} of ${eventType}:`, err),
    );
  }
}
