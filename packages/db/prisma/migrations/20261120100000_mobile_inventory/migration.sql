-- Mobile inventory: the IMEI on assets, phone lines and equipment handover
-- records -- see docs/adr/0078-mobile-inventory.md.

-- CreateEnum
CREATE TYPE "MobileLineStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoverKind" AS ENUM ('DELIVERY', 'RETURN');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "imei" TEXT;

-- CreateTable
CREATE TABLE "mobile_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "status" "MobileLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "carrier_id" UUID,
    "plan" TEXT,
    "data_allowance" TEXT,
    "monthly_cost" DECIMAL(14,2),
    "currency" TEXT,
    "iccid" TEXT,
    "contract_end_date" DATE,
    "contract_id" UUID,
    "asset_id" UUID,
    "assigned_contact_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_handovers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "kind" "HandoverKind" NOT NULL,
    "contact_id" UUID,
    "handed_over_on" DATE NOT NULL,
    "condition" TEXT,
    "accessories" TEXT,
    "notes" TEXT,
    "mobile_line_id" UUID,
    "recorded_by_id" UUID,
    "recorded_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_lines_tenant_id_asset_id_idx" ON "mobile_lines"("tenant_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_lines_tenant_id_phone_number_key" ON "mobile_lines"("tenant_id", "phone_number");

-- CreateIndex
CREATE INDEX "asset_handovers_tenant_id_asset_id_handed_over_on_idx" ON "asset_handovers"("tenant_id", "asset_id", "handed_over_on");

-- AddForeignKey
ALTER TABLE "mobile_lines" ADD CONSTRAINT "mobile_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_lines" ADD CONSTRAINT "mobile_lines_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_lines" ADD CONSTRAINT "mobile_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_lines" ADD CONSTRAINT "mobile_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_lines" ADD CONSTRAINT "mobile_lines_assigned_contact_id_fkey" FOREIGN KEY ("assigned_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_handovers" ADD CONSTRAINT "asset_handovers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_handovers" ADD CONSTRAINT "asset_handovers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_handovers" ADD CONSTRAINT "asset_handovers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_handovers" ADD CONSTRAINT "asset_handovers_mobile_line_id_fkey" FOREIGN KEY ("mobile_line_id") REFERENCES "mobile_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

