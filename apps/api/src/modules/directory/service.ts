import { Prisma, prisma, withTenantTx, type DirectoryContactRole, type OrganizationType } from '@seredina/db';

/**
 * The directory: companies (suppliers, customers, partners, internal areas)
 * and the people at them -- executives, salespeople, engineers, billing.
 * Separate from Contact, the people who write in: no email is required, and
 * contact retention never erases them. docs/adr/0076-directory-payments-inventory.md.
 */

export class DirectoryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface OrganizationInput {
  name: string;
  type: OrganizationType;
  taxId?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface DirectoryContactInput {
  name: string;
  organizationId?: string | null;
  jobTitle?: string | null;
  role: DirectoryContactRole;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  notes?: string | null;
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export async function listOrganizations(tenantId: string, filter: { search?: string; type?: OrganizationType } = {}) {
  const search = filter.search?.trim();
  const rows = await withTenantTx(prisma, tenantId, (tx) =>
    tx.organization.findMany({
      where: {
        ...(filter.type ? { type: filter.type } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { taxId: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { contacts: true, contracts: true, assets: true } } },
      orderBy: { name: 'asc' },
    }),
  );
  return rows.map(({ _count, ...o }) => ({ ...o, contactCount: _count.contacts, contractCount: _count.contracts, assetCount: _count.assets }));
}

export async function getOrganization(tenantId: string, id: string) {
  const org = await withTenantTx(prisma, tenantId, (tx) =>
    tx.organization.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { name: 'asc' } },
        contracts: { select: { id: true, name: true, type: true, endDate: true, nextPaymentDate: true }, orderBy: { name: 'asc' } },
        assets: { select: { id: true, name: true, assetType: true, assetTag: true }, orderBy: { name: 'asc' }, take: 200 },
      },
    }),
  );
  if (!org) throw new DirectoryError('organization not found', 404);
  return org;
}

export async function createOrganization(tenantId: string, input: OrganizationInput) {
  try {
    return await withTenantTx(prisma, tenantId, (tx) => tx.organization.create({ data: { tenantId, ...input, name: input.name.trim() } }));
  } catch (err) {
    if (isUniqueViolation(err)) throw new DirectoryError('An organization with that name already exists.', 409);
    throw err;
  }
}

export async function updateOrganization(tenantId: string, id: string, input: Partial<OrganizationInput>) {
  try {
    return await withTenantTx(prisma, tenantId, async (tx) => {
      if (!(await tx.organization.findUnique({ where: { id }, select: { id: true } }))) throw new DirectoryError('organization not found', 404);
      return tx.organization.update({ where: { id }, data: { ...input, name: input.name?.trim() } });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DirectoryError('An organization with that name already exists.', 409);
    throw err;
  }
}

/** Its people stay in the directory without a company; contracts and assets keep their other details. */
export async function deleteOrganization(tenantId: string, id: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const { count } = await tx.organization.deleteMany({ where: { id } });
    if (count === 0) throw new DirectoryError('organization not found', 404);
  });
}

export async function listDirectoryContacts(
  tenantId: string,
  filter: { search?: string; organizationId?: string; role?: DirectoryContactRole } = {},
) {
  const search = filter.search?.trim();
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.directoryContact.findMany({
      where: {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.role ? { role: filter.role } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { jobTitle: { contains: search, mode: 'insensitive' } },
                { organization: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { organization: { select: { id: true, name: true, type: true } } },
      orderBy: [{ name: 'asc' }],
      take: 500,
    }),
  );
}

async function assertOrganization(tx: Prisma.TransactionClient, organizationId: string | null | undefined) {
  // RLS scopes this to the tenant: another tenant's id simply isn't found.
  if (organizationId && !(await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) {
    throw new DirectoryError('organization not found');
  }
}

export async function createDirectoryContact(tenantId: string, input: DirectoryContactInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    await assertOrganization(tx, input.organizationId);
    return tx.directoryContact.create({
      data: { tenantId, ...input, name: input.name.trim() },
      include: { organization: { select: { id: true, name: true, type: true } } },
    });
  });
}

export async function updateDirectoryContact(tenantId: string, id: string, input: Partial<DirectoryContactInput>) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    if (!(await tx.directoryContact.findUnique({ where: { id }, select: { id: true } }))) throw new DirectoryError('contact not found', 404);
    await assertOrganization(tx, input.organizationId);
    return tx.directoryContact.update({
      where: { id },
      data: { ...input, name: input.name?.trim() },
      include: { organization: { select: { id: true, name: true, type: true } } },
    });
  });
}

export async function deleteDirectoryContact(tenantId: string, id: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const { count } = await tx.directoryContact.deleteMany({ where: { id } });
    if (count === 0) throw new DirectoryError('contact not found', 404);
  });
}
