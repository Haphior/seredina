import { prisma, ticketNotificationRecipients, withTenantTx } from '@seredina/db';
import { emailString, formatMinutesLeft, type SlaBreachCheckJobPayload, type SlaMilestone } from '@seredina/shared';
import { dispatchWebhookEvent } from '../lib/webhookDispatch';
import { tenantLanguage } from '../lib/language';
import { notifyUsers } from '../notifications/notify';
import { startEscalationIfConfigured } from '../oncall/escalate';

/**
 * Fires once, at the due-at timestamp captured when this job was scheduled (see
 * apps/api/src/modules/sla/service.ts's scheduleSlaBreachChecks). Re-reads the
 * ticket fresh rather than trusting anything captured at schedule time, because
 * a lot can change during the delay: the milestone might already be met, or the
 * ticket's priority (and so its due-at) might have moved -- in either case this
 * is a silent no-op, not an error. A priority change re-schedules its own fresh
 * check against the new due-at (see updateTicket), so this job never needs to
 * reschedule itself.
 *
 * A job with `warning` set is the "due soon" heads-up instead
 * (docs/adr/0071-teams-and-notification-events.md): it only notifies, and only
 * if the milestone is still open and its due-at is still the one it was
 * scheduled for.
 */
export async function checkSlaBreach(payload: SlaBreachCheckJobPayload): Promise<void> {
  const ticket = await withTenantTx(prisma, payload.tenantId, (tx) => tx.ticket.findUnique({ where: { id: payload.ticketId } }));
  if (!ticket) return;

  const met = payload.milestone === 'FIRST_RESPONSE' ? Boolean(ticket.firstRespondedAt) : Boolean(ticket.resolvedAt || ticket.closedAt);
  const dueAt = payload.milestone === 'FIRST_RESPONSE' ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
  if (met || !dueAt) return;

  if (payload.warning) {
    if (dueAt.toISOString() !== payload.warning.dueAt) return; // rescheduled since; that schedule has its own warning
    const left = dueAt.getTime() - Date.now();
    if (left <= 0) return; // the breach check covers it now
    await notifySla(payload.tenantId, ticket, payload.milestone, 'SLA_WARNING', formatMinutesLeft(left / 60_000));
    return;
  }

  if (dueAt.getTime() > Date.now()) return; // due-at moved later

  if (payload.milestone === 'FIRST_RESPONSE') {
    await dispatchWebhookEvent(payload.tenantId, 'sla.first_response_breached', {
      ticketId: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      firstResponseDueAt: dueAt.toISOString(),
    });
  } else {
    await dispatchWebhookEvent(payload.tenantId, 'sla.resolution_breached', {
      ticketId: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      resolutionDueAt: dueAt.toISOString(),
    });
  }
  await notifySla(payload.tenantId, ticket, payload.milestone, 'SLA_BREACHED');
  await startEscalationIfConfigured(payload.tenantId, ticket.id);
}

/** Tells the ticket's assignee -- or its team, when nobody is assigned. */
async function notifySla(
  tenantId: string,
  ticket: { id: string; number: number; subject: string; assigneeId: string | null; teamId: string | null },
  milestone: SlaMilestone,
  event: 'SLA_WARNING' | 'SLA_BREACHED',
  left = '',
) {
  const recipients = await withTenantTx(prisma, tenantId, (tx) => ticketNotificationRecipients(tx, ticket));
  if (recipients.length === 0) return;
  const language = await tenantLanguage(tenantId);
  const values = {
    n: ticket.number,
    subject: ticket.subject,
    left,
    milestone: emailString(language, milestone === 'FIRST_RESPONSE' ? 'slaFirstResponse' : 'slaResolution'),
  };
  const warning = event === 'SLA_WARNING';
  await notifyUsers(tenantId, recipients, event, {
    ticketId: ticket.id,
    body: emailString(language, warning ? 'notifySlaWarningBody' : 'notifySlaBreachedBody', values),
    subject: emailString(language, warning ? 'notifySlaWarningSubject' : 'notifySlaBreachedSubject', values),
  });
}
