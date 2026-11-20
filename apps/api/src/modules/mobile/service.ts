import { Prisma, prisma, withTenantTx, type HandoverKind, type MobileLineStatus } from '@seredina/db';

/**
 * Phone lines and equipment handovers -- docs/adr/0078-mobile-inventory.md.
 * A line is a SIM and its plan; a handover is the record behind a printed
 * handover form (acta de entrega), and moves the asset's assignee.
 */

export class MobileError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface MobileLineInput {
  phoneNumber: string;
  status?: MobileLineStatus;
  carrierId?: string | null;
  plan?: string | null;
  dataAllowance?: string | null;
  monthlyCost?: number | null;
  currency?: string | null;
  iccid?: string | null;
  contractEndDate?: string | null; // YYYY-MM-DD
  contractId?: string | null;
  assetId?: string | null;
  assignedContactId?: string | null;
  notes?: string | null;
}

export interface HandoverInput {
  kind: HandoverKind;
  contactId?: string | null;
  handedOverOn: string; // YYYY-MM-DD
  condition?: string | null;
  accessories?: string | null;
  notes?: string | null;
  mobileLineId?: string | null;
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`));
const money = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const lineInclude = {
  carrier: { select: { id: true, name: true } },
  contract: { select: { id: true, name: true, nextPaymentDate: true } },
  asset: { select: { id: true, name: true, assetType: true, imei: true } },
  assignedContact: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MobileLineInclude;

type LineRow = Prisma.MobileLineGetPayload<{ include: typeof lineInclude }>;
const lineOut = (l: LineRow) => ({ ...l, monthlyCost: money(l.monthlyCost) });

async function assertLineLinks(tx: Prisma.TransactionClient, input: Partial<MobileLineInput>) {
  if (input.carrierId && !(await tx.organization.findUnique({ where: { id: input.carrierId }, select: { id: true } }))) {
    throw new MobileError('carrier not found');
  }
  if (input.contractId && !(await tx.contract.findUnique({ where: { id: input.contractId }, select: { id: true } }))) {
    throw new MobileError('contract not found');
  }
  if (input.assetId && !(await tx.asset.findUnique({ where: { id: input.assetId }, select: { id: true } }))) {
    throw new MobileError('asset not found');
  }
  if (input.assignedContactId && !(await tx.contact.findUnique({ where: { id: input.assignedContactId }, select: { id: true } }))) {
    throw new MobileError('contact not found');
  }
}

function lineData(input: Partial<MobileLineInput>) {
  const { monthlyCost, currency, contractEndDate, ...rest } = input;
  return {
    ...rest,
    monthlyCost: monthlyCost === undefined ? undefined : monthlyCost === null ? null : new Prisma.Decimal(monthlyCost),
    currency: currency === undefined ? undefined : currency ? currency.toUpperCase() : null,
    contractEndDate: toDate(contractEndDate),
  };
}

export interface LineFilter {
  search?: string;
  status?: MobileLineStatus;
  assetId?: string;
  assignedContactId?: string;
  carrierId?: string;
}

export async function listMobileLines(tenantId: string, filter: LineFilter = {}) {
  const search = filter.search?.trim();
  const rows = await withTenantTx(prisma, tenantId, (tx) =>
    tx.mobileLine.findMany({
      where: {
        status: filter.status,
        assetId: filter.assetId,
        assignedContactId: filter.assignedContactId,
        carrierId: filter.carrierId,
        ...(search
          ? {
              OR: [
                { phoneNumber: { contains: search } },
                { iccid: { contains: search } },
                { plan: { contains: search, mode: 'insensitive' } },
                { assignedContact: { name: { contains: search, mode: 'insensitive' } } },
                { asset: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: lineInclude,
      orderBy: { phoneNumber: 'asc' },
    }),
  );
  return rows.map(lineOut);
}

export async function createMobileLine(tenantId: string, input: MobileLineInput) {
  try {
    const line = await withTenantTx(prisma, tenantId, async (tx) => {
      await assertLineLinks(tx, input);
      return tx.mobileLine.create({ data: { tenantId, ...lineData(input), phoneNumber: input.phoneNumber }, include: lineInclude });
    });
    return lineOut(line);
  } catch (err) {
    if (isUniqueViolation(err)) throw new MobileError('a line with that number already exists', 409);
    throw err;
  }
}

export async function updateMobileLine(tenantId: string, id: string, input: Partial<MobileLineInput>) {
  try {
    const line = await withTenantTx(prisma, tenantId, async (tx) => {
      if (!(await tx.mobileLine.findUnique({ where: { id }, select: { id: true } }))) throw new MobileError('line not found', 404);
      await assertLineLinks(tx, input);
      return tx.mobileLine.update({ where: { id }, data: lineData(input), include: lineInclude });
    });
    return lineOut(line);
  } catch (err) {
    if (isUniqueViolation(err)) throw new MobileError('a line with that number already exists', 409);
    throw err;
  }
}

export async function deleteMobileLine(tenantId: string, id: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    if (!(await tx.mobileLine.findUnique({ where: { id }, select: { id: true } }))) throw new MobileError('line not found', 404);
    await tx.mobileLine.delete({ where: { id } });
  });
}

const handoverInclude = {
  contact: { select: { id: true, name: true, email: true } },
  mobileLine: { select: { id: true, phoneNumber: true, iccid: true, plan: true, carrier: { select: { name: true } } } },
} satisfies Prisma.AssetHandoverInclude;

export async function listHandovers(tenantId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    if (!(await tx.asset.findUnique({ where: { id: assetId }, select: { id: true } }))) throw new MobileError('asset not found', 404);
    return tx.assetHandover.findMany({
      where: { assetId },
      include: handoverInclude,
      orderBy: [{ handedOverOn: 'desc' }, { createdAt: 'desc' }],
    });
  });
}

/**
 * Records a handover and moves the assignee with it: a delivery assigns the
 * asset (and the line handed over with it) to the person; a return clears
 * the asset's assignee and the line's. A return names the person it came
 * back from -- the current assignee when none is given.
 */
export async function recordHandover(
  tenantId: string,
  assetId: string,
  input: HandoverInput,
  recordedById: string,
) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: assetId }, select: { id: true, assignedContactId: true } });
    if (!asset) throw new MobileError('asset not found', 404);

    const contactId = input.contactId ?? (input.kind === 'RETURN' ? asset.assignedContactId : null);
    if (!contactId) throw new MobileError(input.kind === 'DELIVERY' ? 'choose who receives it' : 'choose who returns it');
    if (!(await tx.contact.findUnique({ where: { id: contactId }, select: { id: true } }))) throw new MobileError('contact not found');
    if (input.mobileLineId && !(await tx.mobileLine.findUnique({ where: { id: input.mobileLineId }, select: { id: true } }))) {
      throw new MobileError('line not found');
    }

    // The name is kept with the record: the form still says who handed it
    // over after that console user is removed.
    const recordedBy = await tx.user.findUnique({ where: { id: recordedById }, select: { name: true } });

    if (input.kind === 'DELIVERY') {
      await tx.asset.update({ where: { id: assetId }, data: { assignedContactId: contactId } });
      if (input.mobileLineId) {
        await tx.mobileLine.update({ where: { id: input.mobileLineId }, data: { assignedContactId: contactId, assetId } });
      }
    } else {
      await tx.asset.update({ where: { id: assetId }, data: { assignedContactId: null } });
      if (input.mobileLineId) await tx.mobileLine.update({ where: { id: input.mobileLineId }, data: { assignedContactId: null } });
    }

    return tx.assetHandover.create({
      data: {
        tenantId,
        assetId,
        kind: input.kind,
        contactId,
        handedOverOn: new Date(`${input.handedOverOn}T00:00:00Z`),
        condition: input.condition ?? null,
        accessories: input.accessories ?? null,
        notes: input.notes ?? null,
        mobileLineId: input.mobileLineId ?? null,
        recordedById,
        recordedByName: recordedBy?.name ?? null,
      },
      include: handoverInclude,
    });
  });
}

/** Everything the printed form shows: the record, the equipment and the company. */
export async function getHandover(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const handover = await tx.assetHandover.findUnique({
      where: { id },
      include: {
        ...handoverInclude,
        asset: {
          select: {
            id: true,
            name: true,
            assetType: true,
            assetTag: true,
            manufacturer: true,
            model: true,
            serialNumber: true,
            imei: true,
            location: true,
          },
        },
      },
    });
    if (!handover) throw new MobileError('handover not found', 404);
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
    return { ...handover, tenantName: tenant?.name ?? '', tenantSlug: tenant?.slug ?? '' };
  });
}

/** A record entered by mistake. The assignee it moved stays where it is: fix that on the asset. */
export async function deleteHandover(tenantId: string, id: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    if (!(await tx.assetHandover.findUnique({ where: { id }, select: { id: true } }))) throw new MobileError('handover not found', 404);
    await tx.assetHandover.delete({ where: { id } });
  });
}
