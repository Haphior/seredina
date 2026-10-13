import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import { tenantLanguage } from '../emailtemplates/service';
import {
  UpdateError,
  checkForUpdates,
  currentVersion,
  deleteSource,
  getSources,
  isSelfHosted,
  lastCheck,
  saveSource,
  setActiveSource,
  startUpdate,
  updaterStatus,
} from './service';

// In-app updates -- docs/adr/0077-in-app-updates.md. Self-hosted only, and
// only for administrators (roles:manage): installing a release runs on the
// host. A cloud install is updated by whoever operates it.

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['github', 'git']),
  location: z.string().trim().min(1).max(500),
  token: z.string().max(500).nullish(),
  includePrereleases: z.boolean().optional(),
});

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof UpdateError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function updateRoutes(app: FastifyInstance) {
  const admin = {
    preHandler: [
      app.authenticate,
      requirePermission('roles:manage'),
      async (_request: unknown, reply: FastifyReply) => {
        if (!isSelfHosted()) return reply.code(404).send({ error: 'Updates are managed by the operator of this service.' });
      },
    ],
  };

  app.get('/system/updates', admin, async (_request, reply) => {
    const [sources, check, updater] = await Promise.all([getSources(), lastCheck(), updaterStatus()]);
    return reply.send({ current: currentVersion(), ...sources, lastCheck: check, updater });
  });

  app.post('/system/updates/check', admin, async (_request, reply) => {
    try {
      return reply.send(await checkForUpdates());
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/system/updates/status', admin, async (_request, reply) => reply.send(await updaterStatus()));

  app.post('/system/updates/apply', admin, async (request, reply) => {
    const parsed = z.object({ version: z.string().max(50) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const status = await startUpdate(parsed.data.version, await tenantLanguage(request.user.tenantId));
      await auditRequest(request, 'system.update_started', { type: 'system', id: parsed.data.version, label: parsed.data.version }, { from: currentVersion() });
      return reply.code(202).send(status);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/system/updates/sources', admin, async (request, reply) => {
    const parsed = sourceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await saveSource(null, parsed.data);
      await auditRequest(request, 'system.update_source_saved', { type: 'system', id: parsed.data.location, label: parsed.data.name });
      return reply.code(201).send(result);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/system/updates/sources/:id', admin, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = sourceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await saveSource(id, parsed.data);
      await auditRequest(request, 'system.update_source_saved', { type: 'system', id: parsed.data.location, label: parsed.data.name });
      return reply.send(result);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/system/updates/sources/:id', admin, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await deleteSource(id);
      await auditRequest(request, 'system.update_source_deleted', { type: 'system', id });
      return reply.send(result);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/system/updates/active-source', admin, async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send(await setActiveSource(parsed.data.id));
    } catch (err) {
      return fail(reply, err);
    }
  });
}
