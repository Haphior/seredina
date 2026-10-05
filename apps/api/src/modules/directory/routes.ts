import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  DirectoryError,
  createDirectoryContact,
  createOrganization,
  deleteDirectoryContact,
  deleteOrganization,
  getOrganization,
  listDirectoryContacts,
  listOrganizations,
  updateDirectoryContact,
  updateOrganization,
} from './service';

// The directory -- docs/adr/0076-directory-payments-inventory.md. Anyone who
// can read tickets can look people up; contacts:manage edits it.

const ORG_TYPE = z.enum(['SUPPLIER', 'CUSTOMER', 'PARTNER', 'INTERNAL', 'OTHER']);
const ROLE = z.enum(['EXECUTIVE', 'MANAGEMENT', 'SALES', 'TECHNICAL', 'SUPPORT', 'BILLING', 'OTHER']);
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const email = z
  .string()
  .trim()
  .max(320)
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'not a valid email address');
const website = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
  .refine((v) => v === null || /^https?:\/\/[^\s"'<>]+$/.test(v), 'not a valid web address');

const orgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: ORG_TYPE.default('SUPPLIER'),
  taxId: text(50),
  website,
  email,
  phone: text(50),
  address: text(500),
  notes: text(5000),
});

const personSchema = z.object({
  name: z.string().trim().min(1).max(200),
  organizationId: z.string().uuid().nullish(),
  jobTitle: text(200),
  role: ROLE.default('OTHER'),
  email,
  phone: text(50),
  mobile: text(50),
  notes: text(5000),
});

const idParam = z.object({ id: z.string().uuid() });

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof DirectoryError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function directoryRoutes(app: FastifyInstance) {
  const read = { preHandler: [app.authenticate, requirePermission('tickets:read')] };
  const manage = { preHandler: [app.authenticate, requirePermission('contacts:manage')] };

  app.get('/organizations', read, async (request, reply) => {
    const q = z.object({ search: z.string().max(200).optional(), type: ORG_TYPE.optional() }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    return reply.send({ organizations: await listOrganizations(request.user.tenantId, q.data) });
  });

  app.get('/organizations/:id', read, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'organization not found' });
    try {
      return reply.send(await getOrganization(request.user.tenantId, p.data.id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/organizations', manage, async (request, reply) => {
    const parsed = orgSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const org = await createOrganization(request.user.tenantId, parsed.data);
      await auditRequest(request, 'organization.created', { type: 'organization', id: org.id, label: org.name });
      return reply.code(201).send(org);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/organizations/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'organization not found' });
    const parsed = orgSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const org = await updateOrganization(request.user.tenantId, p.data.id, parsed.data);
      await auditRequest(request, 'organization.updated', { type: 'organization', id: org.id, label: org.name });
      return reply.send(org);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/organizations/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'organization not found' });
    try {
      await deleteOrganization(request.user.tenantId, p.data.id);
      await auditRequest(request, 'organization.deleted', { type: 'organization', id: p.data.id });
      return reply.code(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/directory-contacts', read, async (request, reply) => {
    const q = z
      .object({ search: z.string().max(200).optional(), organizationId: z.string().uuid().optional(), role: ROLE.optional() })
      .safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    return reply.send({ contacts: await listDirectoryContacts(request.user.tenantId, q.data) });
  });

  app.post('/directory-contacts', manage, async (request, reply) => {
    const parsed = personSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const person = await createDirectoryContact(request.user.tenantId, parsed.data);
      // Id only, like contacts: the audit log can't be edited, so no names in it.
      await auditRequest(request, 'directory_contact.created', { type: 'directory_contact', id: person.id });
      return reply.code(201).send(person);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/directory-contacts/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'contact not found' });
    const parsed = personSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const person = await updateDirectoryContact(request.user.tenantId, p.data.id, parsed.data);
      await auditRequest(request, 'directory_contact.updated', { type: 'directory_contact', id: person.id });
      return reply.send(person);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/directory-contacts/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'contact not found' });
    try {
      await deleteDirectoryContact(request.user.tenantId, p.data.id);
      await auditRequest(request, 'directory_contact.deleted', { type: 'directory_contact', id: p.data.id });
      return reply.code(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });
}
