import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditRequest } from '../audit/service';
import { requirePermission } from '../rbac/permissions';
import { createTeam, deleteTeam, listTeams, updateTeam } from './service';

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  memberIds: z.array(z.string().uuid()).max(500).optional(),
});

const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  memberIds: z.array(z.string().uuid()).max(500).optional(),
});

export default async function teamRoutes(app: FastifyInstance) {
  app.get('/teams', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const teams = await listTeams(request.user.tenantId);
    return reply.send({ teams });
  });

  // Defining teams is tenant-wide configuration, same tier as macros and SLA policies.
  app.post('/teams', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = createTeamSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const team = await createTeam(request.user.tenantId, parsed.data);
      await auditRequest(request, 'team.created', { type: 'team', id: team.id, label: team.name });
      return reply.code(201).send(team);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch('/teams/:id', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateTeamSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const team = await updateTeam(request.user.tenantId, id, parsed.data);
      await auditRequest(request, 'team.updated', { type: 'team', id: team.id, label: team.name });
      return reply.send(team);
    } catch (err) {
      const message = (err as Error).message;
      return reply.code(message === 'team not found' ? 404 : 400).send({ error: message });
    }
  });

  app.delete('/teams/:id', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteTeam(request.user.tenantId, id);
      await auditRequest(request, 'team.deleted', { type: 'team', id });
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'team not found' });
    }
  });
}
