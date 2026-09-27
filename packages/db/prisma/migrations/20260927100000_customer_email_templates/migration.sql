-- Customer email: per-tenant settings and templates, agent signatures and
-- the layout data of automatic ticket-event messages -- see
-- docs/adr/0070-customer-email-templates.md.
ALTER TABLE "tenants" ADD COLUMN "email_settings" JSONB;
ALTER TABLE "users" ADD COLUMN "email_signature" TEXT;
ALTER TABLE "messages" ADD COLUMN "email_meta" JSONB;

CREATE TABLE "email_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_templates_tenant_id_event_key" ON "email_templates"("tenant_id", "event");

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The uploaded logo and banner for customer emails.
CREATE TABLE "email_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_images_tenant_id_kind_key" ON "email_images"("tenant_id", "kind");

ALTER TABLE "email_images" ADD CONSTRAINT "email_images_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
