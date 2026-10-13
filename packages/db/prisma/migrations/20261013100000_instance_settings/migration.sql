-- Installation-wide settings: update sources and the last update check --
-- see docs/adr/0077-in-app-updates.md.
CREATE TABLE "instance_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("key")
);
