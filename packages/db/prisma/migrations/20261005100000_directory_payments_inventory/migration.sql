-- Directory (organizations and their people), contract payment schedules and
-- reminders, and fuller IT inventory -- see
-- docs/adr/0076-directory-payments-inventory.md.

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'PARTNER', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DirectoryContactRole" AS ENUM ('EXECUTIVE', 'MANAGEMENT', 'SALES', 'TECHNICAL', 'SUPPORT', 'BILLING', 'OTHER');

-- AlterEnum: new equipment types
ALTER TYPE "AssetType" ADD VALUE 'LAPTOP';
ALTER TYPE "AssetType" ADD VALUE 'TABLET';
ALTER TYPE "AssetType" ADD VALUE 'SWITCH';
ALTER TYPE "AssetType" ADD VALUE 'ROUTER';
ALTER TYPE "AssetType" ADD VALUE 'FIREWALL';
ALTER TYPE "AssetType" ADD VALUE 'ACCESS_POINT';
ALTER TYPE "AssetType" ADD VALUE 'STORAGE';
ALTER TYPE "AssetType" ADD VALUE 'UPS';
ALTER TYPE "AssetType" ADD VALUE 'MONITOR';
ALTER TYPE "AssetType" ADD VALUE 'PERIPHERAL';
ALTER TYPE "AssetType" ADD VALUE 'DOCKING_STATION';
ALTER TYPE "AssetType" ADD VALUE 'SCANNER';
ALTER TYPE "AssetType" ADD VALUE 'PROJECTOR';
ALTER TYPE "AssetType" ADD VALUE 'IP_PHONE';
ALTER TYPE "AssetType" ADD VALUE 'CAMERA';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'CONTRACT_PAYMENT_DUE';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "asset_tag" TEXT,
ADD COLUMN     "assigned_contact_id" UUID,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "parent_asset_id" UUID,
ADD COLUMN     "purchase_cost" DECIMAL(14,2),
ADD COLUMN     "purchase_currency" TEXT,
ADD COLUMN     "purchase_date" DATE,
ADD COLUMN     "supplier_id" UUID,
ADD COLUMN     "warranty_end_date" DATE;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contact_id" UUID,
ADD COLUMN     "next_payment_date" DATE,
ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "payment_amount" DECIMAL(14,2),
ADD COLUMN     "payment_frequency" TEXT,
ADD COLUMN     "payment_overdue_sent_for" DATE,
ADD COLUMN     "payment_reminder_days" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "payment_reminder_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "payment_reminder_sent_for" DATE;

-- CreateTable
CREATE TABLE "contract_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "due_date" DATE,
    "paid_on" DATE NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'SUPPLIER',
    "tax_id" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "job_title" TEXT,
    "role" "DirectoryContactRole" NOT NULL DEFAULT 'OTHER',
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_payments_tenant_id_contract_id_paid_on_idx" ON "contract_payments"("tenant_id", "contract_id", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tenant_id_name_key" ON "organizations"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "directory_contacts_tenant_id_organization_id_idx" ON "directory_contacts"("tenant_id", "organization_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assigned_contact_id_fkey" FOREIGN KEY ("assigned_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "directory_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

