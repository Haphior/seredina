import { Prisma, prisma, withTenantTx, type ContractType } from '@seredina/db';

/**
 * Contracts, warranties and licenses, linked to assets -- docs/adr/0064-contracts.md.
 * Status is derived from the end date, never stored, so it can't go stale.
 */

export type ContractStatus = 'active' | 'expiring' | 'expired' | 'no_end_date';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until endDate (negative once past), counting whole calendar days in UTC. */
export function daysUntil(endDate: Date, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  return Math.round((end - today) / DAY_MS);
}

export function contractStatus(c: { endDate: Date | null; renewalNoticeDays: number }, now = new Date()): ContractStatus {
  if (!c.endDate) return 'no_end_date';
  const days = daysUntil(c.endDate, now);
  if (days < 0) return 'expired';
  if (days <= Math.max(c.renewalNoticeDays, 0)) return 'expiring';
  return 'active';
}

export interface ContractInput {
  name: string;
  type: ContractType;
  supplier?: string | null;
  reference?: string | null;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null;
  renewalNoticeDays?: number;
  cost?: number | null;
  currency?: string | null;
  billingPeriod?: 'one_time' | 'monthly' | 'yearly' | null;
  seats?: number | null;
  notes?: string | null;
  assetIds?: string[];
  // Supplier from the directory, and the person to call there.
  organizationId?: string | null;
  contactId?: string | null;
  // Payment schedule and reminders (docs/adr/0076-directory-payments-inventory.md).
  paymentFrequency?: PaymentFrequency | null;
  nextPaymentDate?: string | null;
  paymentAmount?: number | null;
  paymentReminderDays?: number;
  paymentReminderEmails?: string[];
}

export const PAYMENT_FREQUENCIES = ['one_time', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];
const MONTHS: Record<PaymentFrequency, number> = { one_time: 0, monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, yearly: 12 };

/**
 * The due date after `from`, for a contract paid every `frequency`. The day
 * of the month comes from `anchorDay` (the start date's, usually), clamped to
 * the month's length -- so a contract paid on the 31st is due Feb 28, then
 * Mar 31 again, instead of drifting to the 28th forever. Null for one-time.
 */
export function nextDueDate(from: Date, frequency: PaymentFrequency, anchorDay = from.getUTCDate()): Date | null {
  const months = MONTHS[frequency];
  if (!months) return null;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, lastDay)));
}

export type PaymentStatus = 'none' | 'scheduled' | 'due_soon' | 'overdue';

export function paymentStatus(c: { paymentFrequency: string | null; nextPaymentDate: Date | null; paymentReminderDays: number }, now = new Date()): PaymentStatus {
  if (!c.paymentFrequency || !c.nextPaymentDate) return 'none';
  const days = daysUntil(c.nextPaymentDate, now);
  if (days < 0) return 'overdue';
  if (days <= Math.max(c.paymentReminderDays, 0)) return 'due_soon';
  return 'scheduled';
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`));

const INCLUDE = {
  assets: { include: { asset: { select: { id: true, name: true, assetType: true } } } },
  organization: { select: { id: true, name: true, type: true } },
  contact: { select: { id: true, name: true, jobTitle: true, email: true, phone: true, mobile: true } },
} as const;

const money = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

function present(c: Prisma.ContractGetPayload<{ include: typeof INCLUDE }>) {
  const { assets, cost, paymentAmount, ...rest } = c;
  return {
    ...rest,
    cost: money(cost),
    paymentAmount: money(paymentAmount),
    // The directory's name when linked; the old free-text supplier otherwise.
    supplierName: c.organization?.name ?? c.supplier ?? null,
    status: contractStatus(c),
    daysUntilEnd: c.endDate ? daysUntil(c.endDate) : null,
    paymentStatus: paymentStatus(c),
    daysUntilPayment: c.paymentFrequency && c.nextPaymentDate ? daysUntil(c.nextPaymentDate) : null,
    assets: assets.map((a) => a.asset),
  };
}

export interface ContractFilter {
  status?: ContractStatus;
  assetId?: string;
  organizationId?: string;
  paymentStatus?: PaymentStatus;
  search?: string;
}

export async function listContracts(tenantId: string, filter: ContractFilter = {}) {
  const rows = await withTenantTx(prisma, tenantId, (tx) =>
    tx.contract.findMany({
      where: {
        ...(filter.assetId ? { assets: { some: { assetId: filter.assetId } } } : {}),
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.search
          ? {
              OR: [
                { name: { contains: filter.search, mode: 'insensitive' } },
                { supplier: { contains: filter.search, mode: 'insensitive' } },
                { organization: { name: { contains: filter.search, mode: 'insensitive' } } },
                { reference: { contains: filter.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
  );
  return rows
    .map(present)
    .filter((c) => !filter.status || c.status === filter.status)
    .filter((c) => !filter.paymentStatus || c.paymentStatus === filter.paymentStatus);
}

export async function getContract(tenantId: string, id: string) {
  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.contract.findUnique({
      where: { id },
      include: { ...INCLUDE, payments: { orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], take: 50 } },
    }),
  );
  if (!row) throw new Error('contract not found');
  const { payments, ...contract } = row;
  return { ...present(contract), payments: payments.map((p) => ({ ...p, amount: money(p.amount) })) };
}

async function assertDirectoryLinks(tx: Prisma.TransactionClient, input: Partial<ContractInput>) {
  // RLS scopes these lookups to the tenant: another tenant's id isn't found.
  if (input.organizationId && !(await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) {
    throw new Error('organization not found');
  }
  if (input.contactId && !(await tx.directoryContact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) {
    throw new Error('directory contact not found');
  }
}

async function assertAssetsExist(tx: Prisma.TransactionClient, assetIds: string[]) {
  if (assetIds.length === 0) return;
  // RLS scopes this to the tenant: an id from another tenant simply isn't found.
  const found = await tx.asset.count({ where: { id: { in: assetIds } } });
  if (found !== new Set(assetIds).size) throw new Error('one or more assets not found');
}

function dataFrom(input: Partial<ContractInput>) {
  return {
    name: input.name,
    type: input.type,
    supplier: input.supplier,
    reference: input.reference,
    startDate: toDate(input.startDate),
    endDate: toDate(input.endDate),
    renewalNoticeDays: input.renewalNoticeDays,
    cost: input.cost === undefined ? undefined : input.cost === null ? null : new Prisma.Decimal(input.cost),
    currency: input.currency === undefined ? undefined : input.currency ? input.currency.toUpperCase() : null,
    billingPeriod: input.billingPeriod,
    seats: input.seats,
    notes: input.notes,
    organizationId: input.organizationId,
    contactId: input.contactId,
    paymentFrequency: input.paymentFrequency,
    nextPaymentDate: toDate(input.nextPaymentDate),
    paymentAmount: input.paymentAmount === undefined ? undefined : input.paymentAmount === null ? null : new Prisma.Decimal(input.paymentAmount),
    paymentReminderDays: input.paymentReminderDays,
    paymentReminderEmails: input.paymentReminderEmails ? [...new Set(input.paymentReminderEmails.map((e) => e.trim().toLowerCase()))] : undefined,
  };
}

export async function createContract(tenantId: string, input: ContractInput) {
  const id = await withTenantTx(prisma, tenantId, async (tx) => {
    const assetIds = [...new Set(input.assetIds ?? [])];
    await assertAssetsExist(tx, assetIds);
    await assertDirectoryLinks(tx, input);
    const contract = await tx.contract.create({ data: { tenantId, ...dataFrom(input), name: input.name, type: input.type } });
    for (const assetId of assetIds) {
      await tx.contractAsset.create({ data: { tenantId, contractId: contract.id, assetId } });
    }
    return contract.id;
  });
  return getContract(tenantId, id);
}

export async function updateContract(tenantId: string, id: string, input: Partial<ContractInput>) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.contract.findUnique({ where: { id } });
    if (!existing) throw new Error('contract not found');
    await assertDirectoryLinks(tx, input);
    const data: Prisma.ContractUncheckedUpdateInput = dataFrom(input);
    // A new end date (a renewal) or notice period means a new reminder is due.
    const newEnd = toDate(input.endDate);
    if (
      (newEnd !== undefined && (newEnd?.getTime() ?? null) !== (existing.endDate?.getTime() ?? null)) ||
      (input.renewalNoticeDays !== undefined && input.renewalNoticeDays !== existing.renewalNoticeDays)
    ) {
      data.renewalNotifiedAt = null;
    }
    await tx.contract.update({ where: { id }, data });

    if (input.assetIds) {
      const assetIds = [...new Set(input.assetIds)];
      await assertAssetsExist(tx, assetIds);
      await tx.contractAsset.deleteMany({ where: { contractId: id } });
      for (const assetId of assetIds) {
        await tx.contractAsset.create({ data: { tenantId, contractId: id, assetId } });
      }
    }
  });
  return getContract(tenantId, id);
}

export async function deleteContract(tenantId: string, id: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.contract.findUnique({ where: { id } });
    if (!existing) throw new Error('contract not found');
    await tx.contract.delete({ where: { id } });
  });
}

/** For the dashboard and the Contracts page header. */
export async function contractSummary(tenantId: string) {
  const contracts = await listContracts(tenantId);
  const yearly = (c: { cost: number | null; billingPeriod: string | null }) =>
    c.cost === null ? 0 : c.billingPeriod === 'monthly' ? c.cost * 12 : c.billingPeriod === 'yearly' ? c.cost : 0;
  const byCurrency = new Map<string, number>();
  for (const c of contracts) {
    if (c.status === 'expired' || !c.currency) continue;
    const y = yearly(c);
    if (y) byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + y);
  }
  return {
    total: contracts.length,
    paymentsDueSoon: contracts.filter((c) => c.paymentStatus === 'due_soon').length,
    paymentsOverdue: contracts.filter((c) => c.paymentStatus === 'overdue').length,
    expiring: contracts.filter((c) => c.status === 'expiring').length,
    expired: contracts.filter((c) => c.status === 'expired').length,
    recurringYearlyCost: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
  };
}

export interface PaymentInput {
  paidOn: string; // YYYY-MM-DD
  amount?: number | null;
  reference?: string | null;
  notes?: string | null;
}

/**
 * Records a payment against the due date currently pending, and moves the
 * contract to its next due date (none after a one-time payment). Reminders
 * key on the due date, so the next period's go out by themselves.
 */
export async function recordPayment(tenantId: string, contractId: string, input: PaymentInput, userId: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new Error('contract not found');
    const due = contract.paymentFrequency ? contract.nextPaymentDate : null;
    // Unless given, the scheduled amount, else the contract's cost.
    const scheduled = contract.paymentAmount ?? contract.cost;
    const amount = input.amount ?? (scheduled === null ? null : Number(scheduled));
    await tx.contractPayment.create({
      data: {
        tenantId,
        contractId,
        dueDate: due,
        paidOn: new Date(`${input.paidOn}T00:00:00Z`),
        amount: amount === null ? null : new Prisma.Decimal(amount),
        currency: contract.currency,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: userId,
      },
    });
    if (due && contract.paymentFrequency) {
      const anchor = (contract.startDate ?? due).getUTCDate();
      await tx.contract.update({
        where: { id: contractId },
        data: { nextPaymentDate: nextDueDate(due, contract.paymentFrequency as PaymentFrequency, anchor) },
      });
    }
  });
  return getContract(tenantId, contractId);
}

/** Undoes a mistaken entry. The next due date stays as it is; edit it if needed. */
export async function deletePayment(tenantId: string, contractId: string, paymentId: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const { count } = await tx.contractPayment.deleteMany({ where: { id: paymentId, contractId } });
    if (count === 0) throw new Error('payment not found');
  });
  return getContract(tenantId, contractId);
}
