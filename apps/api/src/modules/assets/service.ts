import { Prisma, prisma, withTenantTx, type AssetStatus, type AssetType } from '@seredina/db';
import { ASSET_TYPE_GROUPS, type AssetTypeGroup } from '@seredina/shared';

export interface AssetInput {
  name: string;
  assetType: AssetType;
  status?: AssetStatus;
  ipAddress?: string | null;
  macAddress?: string | null;
  hostname?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  operatingSystem?: string | null;
  // Optional link into the equipment catalog -- see docs/adr/0007-equipment-catalog.md.
  // Independent of the free-text manufacturer/model fields above.
  modelId?: string | null;
  // Inventory details -- docs/adr/0076-directory-payments-inventory.md.
  assetTag?: string | null;
  location?: string | null;
  assignedContactId?: string | null;
  parentAssetId?: string | null;
  purchaseDate?: string | null; // YYYY-MM-DD
  purchaseCost?: number | null;
  purchaseCurrency?: string | null;
  supplierId?: string | null;
  warrantyEndDate?: string | null;
  notes?: string | null;
}

export class AssetError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`));

/** The input as Prisma data: dates and money converted, everything else as given. */
function dataFrom(input: Partial<AssetInput>) {
  const { purchaseDate, warrantyEndDate, purchaseCost, purchaseCurrency, ...rest } = input;
  return {
    ...rest,
    purchaseDate: toDate(purchaseDate),
    warrantyEndDate: toDate(warrantyEndDate),
    purchaseCost: purchaseCost === undefined ? undefined : purchaseCost === null ? null : new Prisma.Decimal(purchaseCost),
    purchaseCurrency: purchaseCurrency === undefined ? undefined : purchaseCurrency ? purchaseCurrency.toUpperCase() : null,
  };
}

/** The links must point inside this tenant (RLS hides anything else), and an asset can't be plugged into itself. */
async function assertLinks(tx: Prisma.TransactionClient, input: Partial<AssetInput>, selfId?: string) {
  if (input.assignedContactId && !(await tx.contact.findUnique({ where: { id: input.assignedContactId }, select: { id: true } }))) {
    throw new AssetError('contact not found');
  }
  if (input.supplierId && !(await tx.organization.findUnique({ where: { id: input.supplierId }, select: { id: true } }))) {
    throw new AssetError('supplier not found');
  }
  if (input.parentAssetId) {
    if (input.parentAssetId === selfId) throw new AssetError('an asset cannot be connected to itself');
    // Walk up from the new parent: reaching this asset again would make a loop.
    let cursor: string | null = input.parentAssetId;
    for (let depth = 0; cursor && depth < 20; depth++) {
      const parent: { parentAssetId: string | null } | null = await tx.asset.findUnique({ where: { id: cursor }, select: { parentAssetId: true } });
      if (!parent) throw new AssetError('connected-to asset not found');
      if (selfId && parent.parentAssetId === selfId) throw new AssetError('that connection would make a loop');
      cursor = parent.parentAssetId;
    }
  }
}

const money = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/** Hand-entered assets, as opposed to the agentless scanner (apps/worker) -- discoverySource stays MANUAL. */
export async function createAsset(tenantId: string, input: AssetInput) {
  const asset = await withTenantTx(prisma, tenantId, async (tx) => {
    await assertLinks(tx, input);
    return tx.asset.create({ data: { tenantId, discoverySource: 'MANUAL', ...dataFrom(input), name: input.name, assetType: input.assetType } });
  });
  return { ...asset, purchaseCost: money(asset.purchaseCost) };
}

export async function updateAsset(tenantId: string, id: string, input: Partial<AssetInput>) {
  const asset = await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.asset.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AssetError('asset not found', 404);
    await assertLinks(tx, input, id);
    return tx.asset.update({ where: { id }, data: dataFrom(input) });
  });
  return { ...asset, purchaseCost: money(asset.purchaseCost) };
}

export async function deleteAsset(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.asset.findUnique({ where: { id } });
    if (!existing) throw new Error('asset not found');
    await tx.asset.delete({ where: { id } });
  });
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListAssetsFilter {
  assetType?: AssetType;
  /** A family of types: computers, network, peripherals, infrastructure, other. */
  group?: AssetTypeGroup;
  assignedContactId?: string;
  supplierId?: string;
  parentAssetId?: string;
  status?: AssetStatus;
  // Case-insensitive match against name, IP, or hostname -- same posture as
  // ticket search (modules/tickets/service.ts): a console search box, not a
  // search product.
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listAssets(tenantId: string, filter: ListAssetsFilter = {}) {
  const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = filter.offset ?? 0;
  const where: Prisma.AssetWhereInput = {
    assetType: filter.assetType ?? (filter.group ? { in: [...ASSET_TYPE_GROUPS[filter.group]] as AssetType[] } : undefined),
    status: filter.status,
    assignedContactId: filter.assignedContactId,
    supplierId: filter.supplierId,
    parentAssetId: filter.parentAssetId,
    OR: filter.q
      ? [
          { name: { contains: filter.q, mode: 'insensitive' } },
          { ipAddress: { contains: filter.q, mode: 'insensitive' } },
          { hostname: { contains: filter.q, mode: 'insensitive' } },
          { serialNumber: { contains: filter.q, mode: 'insensitive' } },
          { model: { contains: filter.q, mode: 'insensitive' } },
          { assetTag: { contains: filter.q, mode: 'insensitive' } },
          { location: { contains: filter.q, mode: 'insensitive' } },
          { assignedContact: { name: { contains: filter.q, mode: 'insensitive' } } },
        ]
      : undefined,
  };

  return withTenantTx(prisma, tenantId, async (tx) => {
    const [assets, total] = await Promise.all([
      tx.asset.findMany({
        where,
        orderBy: { name: 'asc' },
        // The agent's inventory documents are for the asset's own page; a
        // list of fifty servers would otherwise carry megabytes of them.
        omit: { agentInventory: true, installedPackages: true },
        include: {
          catalogModel: { include: { manufacturer: true } },
          assignedContact: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          parentAsset: { select: { id: true, name: true } },
        },
        take: limit,
        skip: offset,
      }),
      tx.asset.count({ where }),
    ]);
    return { assets: assets.map((a) => ({ ...a, purchaseCost: money(a.purchaseCost) })), total };
  });
}

export async function getAsset(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      include: {
        tickets: { include: { ticket: { select: { id: true, number: true, subject: true } } } },
        // Flattened below into a plain services[] -- same reasoning as
        // getTicket's identical flatten (modules/tickets/service.ts): the
        // frontend shouldn't need to know a ServiceAsset join table exists.
        services: { include: { service: { select: { id: true, name: true } } } },
        catalogModel: { include: { manufacturer: true } },
        assignedContact: { select: { id: true, name: true, email: true } },
        supplier: { select: { id: true, name: true } },
        parentAsset: { select: { id: true, name: true, assetType: true } },
        connectedAssets: { select: { id: true, name: true, assetType: true, assetTag: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!asset) throw new Error('asset not found');
    return { ...asset, purchaseCost: money(asset.purchaseCost), services: asset.services.map((sa) => sa.service) };
  });
}

/** Lightweight CMDB linkage: "this ticket is about that asset" -- see schema.prisma's TicketAsset. */
export async function linkAssetToTicket(tenantId: string, ticketId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const [ticket, asset] = await Promise.all([
      tx.ticket.findUnique({ where: { id: ticketId } }),
      tx.asset.findUnique({ where: { id: assetId } }),
    ]);
    if (!ticket) throw new Error('ticket not found');
    if (!asset) throw new Error('asset not found');

    return tx.ticketAsset.upsert({
      where: { ticketId_assetId: { ticketId, assetId } },
      create: { tenantId, ticketId, assetId },
      update: {},
    });
  });
}

export async function unlinkAssetFromTicket(tenantId: string, ticketId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('ticket not found');
    await tx.ticketAsset.deleteMany({ where: { ticketId, assetId } });
  });
}
