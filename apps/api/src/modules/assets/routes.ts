import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { ASSET_TYPES, ASSET_TYPE_GROUPS, type AssetTypeGroup, type AssetTypeName } from '@seredina/shared';
import { AssetError, createAsset, deleteAsset, getAsset, listAssets, updateAsset } from './service';

const ASSET_TYPE = z.enum(ASSET_TYPES as [AssetTypeName, ...AssetTypeName[]]);
const ASSET_GROUP = z.enum(Object.keys(ASSET_TYPE_GROUPS) as [AssetTypeGroup, ...AssetTypeGroup[]]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const ASSET_STATUS = z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']);

// .nullish() (null or undefined) on the optional string fields -- undefined means
// "don't touch this field" on PATCH, null means "clear it" (e.g. remove a
// mis-entered serial number). Plain .optional() can't express the second case.
const assetFieldsSchema = {
  ipAddress: z.string().ip().nullish(),
  macAddress: z.string().nullish(),
  hostname: z.string().nullish(),
  serialNumber: z.string().nullish(),
  manufacturer: z.string().nullish(),
  model: z.string().nullish(),
  operatingSystem: z.string().nullish(),
  modelId: z.string().uuid().nullish(),
  // Inventory details -- docs/adr/0076-directory-payments-inventory.md.
  assetTag: z.string().max(100).nullish(),
  location: z.string().max(200).nullish(),
  assignedContactId: z.string().uuid().nullish(),
  parentAssetId: z.string().uuid().nullish(),
  purchaseDate: date.nullish(),
  purchaseCost: z.number().min(0).max(1e12).nullish(),
  purchaseCurrency: z.string().regex(/^[A-Za-z]{3}$/, 'use a 3-letter currency code').nullish(),
  supplierId: z.string().uuid().nullish(),
  warrantyEndDate: date.nullish(),
  notes: z.string().max(5000).nullish(),
};

const createAssetSchema = z.object({
  name: z.string().min(1).max(200),
  assetType: ASSET_TYPE,
  status: ASSET_STATUS.optional(),
  ...assetFieldsSchema,
});

const updateAssetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  assetType: ASSET_TYPE.optional(),
  status: ASSET_STATUS.optional(),
  ...assetFieldsSchema,
});

const listAssetsQuerySchema = z.object({
  assetType: ASSET_TYPE.optional(),
  group: ASSET_GROUP.optional(),
  status: ASSET_STATUS.optional(),
  assignedContactId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  parentAssetId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export default async function assetRoutes(app: FastifyInstance) {
  app.get('/assets', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const query = listAssetsQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });
    const { assets, total } = await listAssets(request.user.tenantId, query.data);
    return reply.send({ assets, total });
  });

  app.get(
    '/assets/:id',
    { preHandler: [app.authenticate, requirePermission('assets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const asset = await getAsset(request.user.tenantId, id);
        return reply.send(asset);
      } catch {
        return reply.code(404).send({ error: 'asset not found' });
      }
    },
  );

  app.post(
    '/assets',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const parsed = createAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        return reply.code(201).send(await createAsset(request.user.tenantId, parsed.data));
      } catch (err) {
        if (err instanceof AssetError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  app.patch(
    '/assets/:id',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        return reply.send(await updateAsset(request.user.tenantId, id, parsed.data));
      } catch (err) {
        if (err instanceof AssetError) return reply.code(err.status).send({ error: err.message });
        return reply.code(404).send({ error: 'asset not found' });
      }
    },
  );

  app.delete(
    '/assets/:id',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteAsset(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'asset not found' });
      }
    },
  );
}
