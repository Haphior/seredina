-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "setup_completed_at" TIMESTAMP(3),
ADD COLUMN     "setup_template" TEXT;
