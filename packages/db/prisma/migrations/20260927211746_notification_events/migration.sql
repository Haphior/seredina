-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'TEAM_TICKET';
ALTER TYPE "NotificationEventType" ADD VALUE 'SLA_WARNING';
ALTER TYPE "NotificationEventType" ADD VALUE 'SLA_BREACHED';
ALTER TYPE "NotificationEventType" ADD VALUE 'MENTIONED';
ALTER TYPE "NotificationEventType" ADD VALUE 'TICKET_REOPENED';

-- CreateTable
CREATE TABLE "tenant_notification_defaults" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tenant_notification_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_notification_defaults_tenant_id_event_type_key" ON "tenant_notification_defaults"("tenant_id", "event_type");

-- AddForeignKey
ALTER TABLE "tenant_notification_defaults" ADD CONSTRAINT "tenant_notification_defaults_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
