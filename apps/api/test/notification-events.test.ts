import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx, type NotificationEventType } from '@seredina/db';
import { ingestInboundEmail } from '../../worker/src/email/ingest';
import { checkSlaBreach } from '../../worker/src/sla/checkBreach';
import {
  getPreferences,
  getWorkspaceDefaults,
  resetPreference,
  setWorkspaceDefault,
  updatePreference,
} from '../src/modules/notifications/service';
import { replyToMyTicket } from '../src/modules/portal/service';
import { createTeam } from '../src/modules/teams/service';
import { addMessage, createTicketFromApi, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

/** docs/adr/0071-teams-and-notification-events.md */
describe.skipIf(!hasDb)('Notification events and workspace defaults', () => {
  let tenantId: string;
  let adminId: string;
  let anaId: string;
  let beaId: string;
  let teamId: string;

  async function notificationsOf(userId: string, eventType: NotificationEventType, ticketId?: string) {
    return withTenantTx(prisma, tenantId, (tx) => tx.notification.findMany({ where: { userId, eventType, ticketId } }));
  }

  async function newTicket(subject = 'Impresora') {
    return createTicketFromApi(tenantId, { subject, body: 'No imprime', contactEmail: 'cliente@example.com', contactName: 'Cliente' });
  }

  async function setStatus(ticketId: string, key: string) {
    const status = await withTenantTx(prisma, tenantId, (tx) => tx.ticketStatus.findFirstOrThrow({ where: { key } }));
    await updateTicket(tenantId, ticketId, { statusId: status.id });
  }

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `nev-${tenantId.slice(0, 8)}`, name: 'Notification Events' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      adminId = (await tx.user.create({ data: { tenantId, email: 'admin@nev.test', name: 'Admin', passwordHash: 'x' } })).id;
      anaId = (await tx.user.create({ data: { tenantId, email: 'ana@nev.test', name: 'Ana', passwordHash: 'x' } })).id;
      beaId = (await tx.user.create({ data: { tenantId, email: 'bea@nev.test', name: 'Bea', passwordHash: 'x' } })).id;
    });
    teamId = (await createTeam(tenantId, { name: 'Soporte', memberIds: [adminId, anaId, beaId] })).id;
  });

  describe('workspace defaults', () => {
    it('every event starts on the built-in default, including the new ones', async () => {
      const defaults = await getWorkspaceDefaults(tenantId);
      expect(defaults.map((d) => d.eventType)).toEqual([
        'TICKET_ASSIGNED',
        'NEW_REPLY',
        'TEAM_TICKET',
        'TICKET_REOPENED',
        'MENTIONED',
        'SLA_WARNING',
        'SLA_BREACHED',
        'CONTRACT_EXPIRING',
      ]);
      expect(defaults.every((d) => d.inApp && !d.email)).toBe(true);
    });

    it('a workspace default applies to anyone without their own choice, and their own choice wins', async () => {
      await setWorkspaceDefault(tenantId, 'TICKET_ASSIGNED', { email: true });
      const bea = (await getPreferences(tenantId, beaId)).find((p) => p.eventType === 'TICKET_ASSIGNED');
      expect(bea).toMatchObject({ inApp: true, email: true, source: 'workspace' });

      // Changing only inApp keeps the email the workspace gave her.
      await updatePreference(tenantId, beaId, 'TICKET_ASSIGNED', { inApp: false });
      const own = (await getPreferences(tenantId, beaId)).find((p) => p.eventType === 'TICKET_ASSIGNED');
      expect(own).toMatchObject({ inApp: false, email: true, source: 'user' });

      await resetPreference(tenantId, beaId, 'TICKET_ASSIGNED');
      const back = (await getPreferences(tenantId, beaId)).find((p) => p.eventType === 'TICKET_ASSIGNED');
      expect(back).toMatchObject({ inApp: true, email: true, source: 'workspace' });
    });

    it('notifyUser follows the workspace default: in-app off means no row', async () => {
      await setWorkspaceDefault(tenantId, 'TICKET_ASSIGNED', { inApp: false });
      const ticket = await newTicket('Default off');
      await updateTicket(tenantId, ticket.id, { assigneeId: beaId });
      expect(await notificationsOf(beaId, 'TICKET_ASSIGNED', ticket.id)).toHaveLength(0);
      await setWorkspaceDefault(tenantId, 'TICKET_ASSIGNED', { inApp: true, email: false });
    });

    it('workspace defaults are per tenant', async () => {
      const otherId = randomUUID();
      await withTenantTx(prisma, otherId, (tx) => tx.tenant.create({ data: { id: otherId, slug: `nev-o-${otherId.slice(0, 8)}`, name: 'Other' } }));
      await setWorkspaceDefault(tenantId, 'SLA_BREACHED', { email: true });
      const other = await getWorkspaceDefaults(otherId);
      expect(other.find((d) => d.eventType === 'SLA_BREACHED')?.email).toBe(false);
    });
  });

  describe('ticket landed in my team', () => {
    it('tells every member except whoever moved it', async () => {
      const ticket = await newTicket('Para el equipo');
      await updateTicket(tenantId, ticket.id, { teamId }, adminId);
      expect(await notificationsOf(anaId, 'TEAM_TICKET', ticket.id)).toHaveLength(1);
      expect(await notificationsOf(beaId, 'TEAM_TICKET', ticket.id)).toHaveLength(1);
      expect(await notificationsOf(adminId, 'TEAM_TICKET', ticket.id)).toHaveLength(0);
    });

    it('says nothing when the ticket also gets an assignee, or the team does not change', async () => {
      const ticket = await newTicket('Con responsable');
      await updateTicket(tenantId, ticket.id, { teamId, assigneeId: anaId }, adminId);
      expect(await notificationsOf(beaId, 'TEAM_TICKET', ticket.id)).toHaveLength(0);

      const other = await newTicket('Mismo equipo');
      await updateTicket(tenantId, other.id, { teamId }, adminId);
      await updateTicket(tenantId, other.id, { teamId }, adminId);
      expect(await notificationsOf(beaId, 'TEAM_TICKET', other.id)).toHaveLength(1);
    });

    it('assigning yourself does not notify you', async () => {
      const ticket = await newTicket('Me lo tomo');
      await updateTicket(tenantId, ticket.id, { assigneeId: anaId }, anaId);
      expect(await notificationsOf(anaId, 'TICKET_ASSIGNED', ticket.id)).toHaveLength(0);
    });
  });

  describe('mentions', () => {
    it('an internal note tells the people mentioned, not the author, and ignores unknown ids', async () => {
      const ticket = await newTicket('Mención');
      await addMessage(tenantId, ticket.id, {
        authorUserId: anaId,
        body: '@Bea @Ana mira esto',
        isPrivateNote: true,
        mentionedUserIds: [beaId, anaId, randomUUID()],
      });
      const [bea] = await notificationsOf(beaId, 'MENTIONED', ticket.id);
      expect(bea.body).toContain('Ana');
      expect(await notificationsOf(anaId, 'MENTIONED', ticket.id)).toHaveLength(0);
    });

    it('a public reply never notifies mentions', async () => {
      const ticket = await newTicket('Pública');
      await addMessage(tenantId, ticket.id, { authorUserId: anaId, body: 'Hola', isPrivateNote: false, mentionedUserIds: [beaId] });
      expect(await notificationsOf(beaId, 'MENTIONED', ticket.id)).toHaveLength(0);
    });
  });

  describe('reopened by the customer', () => {
    it('a portal reply to a resolved ticket reopens it and tells the assignee', async () => {
      const ticket = await newTicket('Resuelto por portal');
      await updateTicket(tenantId, ticket.id, { assigneeId: anaId }, adminId);
      await setStatus(ticket.id, 'resolved');

      await replyToMyTicket({ tenantId, contactId: ticket.contactId }, ticket.id, 'Sigue fallando');
      const after = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { status: true } }));
      expect(after.status.key).toBe('open');
      expect(await notificationsOf(anaId, 'TICKET_REOPENED', ticket.id)).toHaveLength(1);
      expect(await notificationsOf(anaId, 'NEW_REPLY', ticket.id)).toHaveLength(0);
    });

    it('an email reply to a closed ticket with no assignee reopens it and tells the team', async () => {
      const ticket = await newTicket('Cerrado por correo');
      await updateTicket(tenantId, ticket.id, { teamId }, adminId);
      await setStatus(ticket.id, 'closed');
      const messageId = `<${randomUUID()}@example.com>`;
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.message.create({ data: { tenantId, ticketId: ticket.id, authorType: 'AGENT', body: 'Listo', isPrivateNote: false, externalId: messageId } }),
      );

      const { replyNotice } = await ingestInboundEmail({
        tenantId,
        fromAddress: 'cliente@example.com',
        fromName: 'Cliente',
        subject: 'Re: Cerrado por correo',
        text: 'Volvió a pasar',
        messageId: `<${randomUUID()}@mail.example.com>`,
        inReplyTo: messageId,
        references: [],
      });
      expect(replyNotice).toMatchObject({ event: 'TICKET_REOPENED', ticketId: ticket.id });
      expect(replyNotice?.userIds.sort()).toEqual([adminId, anaId, beaId].sort());
    });

    it('an email reply to an open assigned ticket is a plain new reply', async () => {
      const ticket = await newTicket('Abierto');
      await updateTicket(tenantId, ticket.id, { assigneeId: beaId }, adminId);
      const messageId = `<${randomUUID()}@example.com>`;
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.message.create({ data: { tenantId, ticketId: ticket.id, authorType: 'AGENT', body: 'x', isPrivateNote: false, externalId: messageId } }),
      );
      const { replyNotice } = await ingestInboundEmail({
        tenantId,
        fromAddress: 'cliente@example.com',
        fromName: 'Cliente',
        subject: 'Re: Abierto',
        text: 'Gracias',
        messageId: `<${randomUUID()}@mail.example.com>`,
        inReplyTo: messageId,
        references: [],
      });
      expect(replyNotice).toMatchObject({ event: 'NEW_REPLY', userIds: [beaId] });
    });
  });

  describe('SLA', () => {
    async function ticketDueIn(ms: number, assigneeId: string | null) {
      const ticket = await newTicket('SLA');
      const dueAt = new Date(Date.now() + ms);
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.ticket.update({ where: { id: ticket.id }, data: { firstResponseDueAt: dueAt, assigneeId, teamId: assigneeId ? null : teamId } }),
      );
      return { ticket, dueAt };
    }

    it('warns the assignee while the target is still open, with the time left', async () => {
      const { ticket, dueAt } = await ticketDueIn(30 * 60_000, anaId);
      await checkSlaBreach({ tenantId, ticketId: ticket.id, milestone: 'FIRST_RESPONSE', warning: { dueAt: dueAt.toISOString() } });
      const [warning] = await notificationsOf(anaId, 'SLA_WARNING', ticket.id);
      expect(warning.body).toMatch(/primera respuesta.*(29|30) min/);
    });

    it('skips a stale warning whose due-at has moved, and one already met', async () => {
      const { ticket } = await ticketDueIn(30 * 60_000, anaId);
      await checkSlaBreach({ tenantId, ticketId: ticket.id, milestone: 'FIRST_RESPONSE', warning: { dueAt: new Date(0).toISOString() } });
      expect(await notificationsOf(anaId, 'SLA_WARNING', ticket.id)).toHaveLength(0);

      const met = await ticketDueIn(30 * 60_000, anaId);
      await withTenantTx(prisma, tenantId, (tx) => tx.ticket.update({ where: { id: met.ticket.id }, data: { firstRespondedAt: new Date() } }));
      await checkSlaBreach({ tenantId, ticketId: met.ticket.id, milestone: 'FIRST_RESPONSE', warning: { dueAt: met.dueAt.toISOString() } });
      expect(await notificationsOf(anaId, 'SLA_WARNING', met.ticket.id)).toHaveLength(0);
    });

    it('tells the team when a target is missed on an unassigned ticket', async () => {
      const { ticket } = await ticketDueIn(-60_000, null);
      await checkSlaBreach({ tenantId, ticketId: ticket.id, milestone: 'FIRST_RESPONSE' });
      for (const id of [adminId, anaId, beaId]) {
        expect(await notificationsOf(id, 'SLA_BREACHED', ticket.id)).toHaveLength(1);
      }
    });
  });
});
