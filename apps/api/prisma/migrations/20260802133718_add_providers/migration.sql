-- CreateEnum
CREATE TYPE "provider_health_state" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN');

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "postback_ip_ranges" TEXT[],
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "health_state" "provider_health_state" NOT NULL DEFAULT 'HEALTHY',
    "consecutive_failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_successful_sync_at" TIMESTAMPTZ(3),
    "last_failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug");

-- CreateIndex
CREATE INDEX "providers_is_enabled_idx" ON "providers"("is_enabled");
