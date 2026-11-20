import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  MobileError,
  createMobileLine,
  deleteHandover,
  deleteMobileLine,
  getHandover,
  listHandovers,
  listMobileLines,
  recordHandover,
  updateMobileLine,
} from './service';

// Phone lines and equipment handovers -- docs/adr/0078-mobile-inventory.md.
// Same tiers as the assets they hang off: assets:read to look, assets:manage to change.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v === undefined ? undefined : v ? v : null));
const LINE_STATUS = z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED']);

const lineFields = {
  status: LINE_STATUS.optional(),
  carrierId: z.string().uuid().nullish(),
  plan: text(200),
  dataAllowance: text(100),
  monthlyCost: z.number().min(0).max(1e12).nullish(),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'use a 3-letter currency code').nullish(),
  // A SIM's ICCID: 18-22 digits (some end in a check letter).
  iccid: z
    .string()
    .trim()
    .regex(/^[0-9][0-9 ]{16,24}[0-9A-Fa-f]$/, 'use the SIM card number (ICCID)')
    .transform((v) => v.replace(/ /g, ''))
    .nullish(),
  contractEndDate: date.nullish(),
  contractId: z.string().uuid().nullish(),
  assetId: z.string().uuid().nullish(),
  assignedContactId: z.string().uuid().nullish(),
  notes: text(5000),
};
const phoneNumber = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,24}$/, 'use a phone number, e.g. +56 9 1234 5678');

const createLineSchema = z.object({ phoneNumber, ...lineFields });
const updateLineSchema = z.object({ phoneNumber: phoneNumber.optional(), ...lineFields });

const handoverSchema = z.object({
  kind: z.enum(['DELIVERY', 'RETURN']),
  contactId: z.string().uuid().nullish(),
  handedOverOn: date,
  condition: text(500),
  accessories: text(1000),
  notes: text(5000),
  mobileLineId: z.string().uuid().nullish(),
});

const idParam = z.object({ id: z.string().uuid() });

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof MobileError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function mobileRoutes(app: FastifyInstance) {
  const read = { preHandler: [app.authenticate, requirePermission('assets:read')] };
  const manage = { preHandler: [app.authenticate, requirePermission('assets:manage')] };

  app.get('/mobile-lines', read, async (request, reply) => {
    const q = z
      .object({
        search: z.string().max(200).optional(),
        status: LINE_STATUS.optional(),
        assetId: z.string().uuid().optional(),
        assignedContactId: z.string().uuid().optional(),
        carrierId: z.string().uuid().optional(),
      })
      .safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    return reply.send({ lines: await listMobileLines(request.user.tenantId, q.data) });
  });

  app.post('/mobile-lines', manage, async (request, reply) => {
    const parsed = createLineSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const line = await createMobileLine(request.user.tenantId, parsed.data);
      await auditRequest(request, 'mobile_line.created', { type: 'mobile_line', id: line.id, label: line.phoneNumber });
      return reply.code(201).send(line);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/mobile-lines/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'line not found' });
    const parsed = updateLineSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const line = await updateMobileLine(request.user.tenantId, p.data.id, parsed.data);
      await auditRequest(request, 'mobile_line.updated', { type: 'mobile_line', id: line.id, label: line.phoneNumber });
      return reply.send(line);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/mobile-lines/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'line not found' });
    try {
      await deleteMobileLine(request.user.tenantId, p.data.id);
      await auditRequest(request, 'mobile_line.deleted', { type: 'mobile_line', id: p.data.id });
      return reply.code(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/assets/:id/handovers', read, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'asset not found' });
    try {
      return reply.send({ handovers: await listHandovers(request.user.tenantId, p.data.id) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/assets/:id/handovers', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'asset not found' });
    const parsed = handoverSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const handover = await recordHandover(request.user.tenantId, p.data.id, parsed.data, request.user.sub);
      await auditRequest(request, parsed.data.kind === 'DELIVERY' ? 'asset.delivered' : 'asset.returned', {
        type: 'asset',
        id: p.data.id,
      }, { handoverId: handover.id, contactId: handover.contactId });
      return reply.code(201).send(handover);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/handovers/:id', read, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'handover not found' });
    try {
      return reply.send(await getHandover(request.user.tenantId, p.data.id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/handovers/:id', manage, async (request, reply) => {
    const p = idParam.safeParse(request.params);
    if (!p.success) return reply.code(404).send({ error: 'handover not found' });
    try {
      await deleteHandover(request.user.tenantId, p.data.id);
      await auditRequest(request, 'asset.handover_deleted', { type: 'asset_handover', id: p.data.id });
      return reply.code(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });
}
