-- Full agent inventory (docs/adr/0069-full-agent-inventory.md).
ALTER TABLE "assets" ADD COLUMN "agent_inventory" JSONB,
ADD COLUMN "agent_inventory_at" TIMESTAMP(3);

ALTER TABLE "devices" ADD COLUMN "reported_role" TEXT;
