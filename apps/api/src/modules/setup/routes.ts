import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditRequest } from '../audit/service';
import { requirePermission } from '../rbac/permissions';
import { applyTemplate, completeSetup, getSetupStatus, saveOrganization, SCHEDULE_PRESETS } from './service';
import { SETUP_TEMPLATE_KEYS } from './templates';

const organizationSchema = z.object({
  tenantName: z.string().trim().min(1).max(200).optional(),
  language: z.enum(['es', 'en']).optional(),
  timezone: z.string().min(1).max(100).optional(),
  schedule: z.enum([...(Object.keys(SCHEDULE_PRESETS) as [keyof typeof SCHEDULE_PRESETS]), 'none']).optional(),
});

// Setting up the workspace is tenant-wide configuration: the same tier as
// the Settings pages these steps stand in for.
export default async function setupRoutes(app: FastifyInstance) {
  const admin = { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] };

  app.get('/setup', admin, async (request, reply) => reply.send(await getSetupStatus(request.user.tenantId)));

  app.put('/setup/organization', admin, async (request, reply) => {
    const parsed = organizationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await saveOrganization(request.user.tenantId, parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    await auditRequest(request, 'setup.organization_saved', { type: 'tenant' }, parsed.data);
    return reply.send(await getSetupStatus(request.user.tenantId));
  });

  app.post('/setup/template', admin, async (request, reply) => {
    const parsed = z.object({ key: z.enum(SETUP_TEMPLATE_KEYS) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const created = await applyTemplate(request.user.tenantId, parsed.data.key);
    await auditRequest(request, 'setup.template_applied', { type: 'tenant', label: parsed.data.key }, { ...created });
    return reply.send({ created });
  });

  app.post('/setup/complete', admin, async (request, reply) => {
    await completeSetup(request.user.tenantId);
    await auditRequest(request, 'setup.completed', { type: 'tenant' });
    return reply.code(204).send();
  });
}
