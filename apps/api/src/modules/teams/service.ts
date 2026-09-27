import { prisma, withTenantTx, type Prisma } from '@seredina/db';

export const DEFAULT_TEAM_NAME = 'General';

/** Called from auth/service.ts's registerTenant, inside its own tenant transaction -- not a standalone entry point. */
export async function seedDefaultTeam(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.team.create({ data: { tenantId, name: DEFAULT_TEAM_NAME } });
}

const teamInclude = {
  members: { select: { userId: true }, orderBy: { createdAt: 'asc' } },
  _count: { select: { tickets: true } },
} satisfies Prisma.TeamInclude;

type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

function toTeamView(team: TeamRow) {
  return {
    id: team.id,
    name: team.name,
    memberIds: team.members.map((m) => m.userId),
    ticketCount: team._count.tickets,
  };
}

export async function listTeams(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const teams = await tx.team.findMany({ include: teamInclude, orderBy: { name: 'asc' } });
    return teams.map(toTeamView);
  });
}

export interface TeamInput {
  name?: string;
  memberIds?: string[];
}

/** Every id must be a user of this tenant -- RLS hides other tenants' users, so a foreign id simply isn't found. */
async function assertUsersExist(tx: Prisma.TransactionClient, memberIds: string[]) {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return unique;
  const found = await tx.user.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new Error('unknown user in memberIds');
  return unique;
}

async function assertNameFree(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
  const clash = await tx.team.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined } });
  if (clash) throw new Error('a team with this name already exists');
}

export async function createTeam(tenantId: string, input: { name: string; memberIds?: string[] }) {
  const name = input.name.trim();
  return withTenantTx(prisma, tenantId, async (tx) => {
    await assertNameFree(tx, name);
    const memberIds = await assertUsersExist(tx, input.memberIds ?? []);
    const team = await tx.team.create({
      data: { tenantId, name, members: { create: memberIds.map((userId) => ({ tenantId, userId })) } },
      include: teamInclude,
    });
    return toTeamView(team);
  });
}

/** memberIds, when given, replaces the whole member list. */
export async function updateTeam(tenantId: string, id: string, input: TeamInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.team.findUnique({ where: { id } });
    if (!existing) throw new Error('team not found');
    const name = input.name?.trim();
    if (name !== undefined && name !== existing.name) await assertNameFree(tx, name, id);
    if (input.memberIds) {
      const memberIds = await assertUsersExist(tx, input.memberIds);
      await tx.teamMember.deleteMany({ where: { teamId: id, userId: { notIn: memberIds } } });
      await tx.teamMember.createMany({
        data: memberIds.map((userId) => ({ tenantId, teamId: id, userId })),
        skipDuplicates: true,
      });
    }
    const team = await tx.team.update({ where: { id }, data: { name }, include: teamInclude });
    return toTeamView(team);
  });
}

/** Tickets and process steps in the team keep existing, just without a team (FK is ON DELETE SET NULL). */
export async function deleteTeam(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.team.findUnique({ where: { id } });
    if (!existing) throw new Error('team not found');
    await tx.team.delete({ where: { id } });
  });
}

/** User ids of a team's members -- the recipients of "a ticket landed in my team". */
export async function teamMemberIds(tx: Prisma.TransactionClient, teamId: string) {
  const rows = await tx.teamMember.findMany({ where: { teamId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
