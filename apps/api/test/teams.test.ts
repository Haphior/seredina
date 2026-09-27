import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTeam, deleteTeam, listTeams, updateTeam } from '../src/modules/teams/service';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Team management and membership -- see docs/adr/0071-teams-and-notification-events.md. */
describe.skipIf(!hasDb)('Teams', () => {
  let tenantId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `teams-${tenantId.slice(0, 8)}`, name: 'Teams Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      userAId = (await tx.user.create({ data: { tenantId, email: 'team-a@example.com', name: 'Team A', passwordHash: 'x' } })).id;
      userBId = (await tx.user.create({ data: { tenantId, email: 'team-b@example.com', name: 'Team B', passwordHash: 'x' } })).id;
    });
  });

  it('creates a team with members and lists it', async () => {
    const team = await createTeam(tenantId, { name: 'Soporte N1', memberIds: [userAId, userAId, userBId] });
    expect(team).toMatchObject({ name: 'Soporte N1', ticketCount: 0 });
    expect(team.memberIds.sort()).toEqual([userAId, userBId].sort());
    const teams = await listTeams(tenantId);
    expect(teams.map((t) => t.name)).toContain('Soporte N1');
  });

  it('refuses a duplicate name, case-insensitively', async () => {
    await createTeam(tenantId, { name: 'Redes' });
    await expect(createTeam(tenantId, { name: 'redes' })).rejects.toThrow('already exists');
  });

  it('replaces the member list on update and renames', async () => {
    const team = await createTeam(tenantId, { name: 'Infra', memberIds: [userAId] });
    const updated = await updateTeam(tenantId, team.id, { name: 'Infraestructura', memberIds: [userBId] });
    expect(updated.name).toBe('Infraestructura');
    expect(updated.memberIds).toEqual([userBId]);
  });

  it('rejects a member that is not a user of this tenant', async () => {
    const otherTenantId = randomUUID();
    let foreignUserId = '';
    await withTenantTx(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, slug: `teams-o-${otherTenantId.slice(0, 8)}`, name: 'Other' } });
      foreignUserId = (await tx.user.create({ data: { tenantId: otherTenantId, email: 'x@example.com', name: 'X', passwordHash: 'x' } })).id;
    });
    await expect(createTeam(tenantId, { name: 'Cross', memberIds: [foreignUserId] })).rejects.toThrow('unknown user');
    // ...and the other tenant never sees this tenant's teams.
    expect(await listTeams(otherTenantId)).toEqual([]);
  });

  it('deleting a team keeps its tickets, now without a team', async () => {
    const team = await createTeam(tenantId, { name: 'Temporal' });
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Sigue existiendo',
      body: 'x',
      contactEmail: 'c@example.com',
      contactName: 'Cliente',
    });
    await withTenantTx(prisma, tenantId, (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { teamId: team.id } }));
    expect((await listTeams(tenantId)).find((t) => t.id === team.id)?.ticketCount).toBe(1);

    await deleteTeam(tenantId, team.id);
    const after = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUnique({ where: { id: ticket.id } }));
    expect(after?.teamId).toBeNull();
  });
});
