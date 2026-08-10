-- CreateEnum
CREATE TYPE "offer_category" AS ENUM ('GAME', 'SURVEY', 'SIGNUP', 'TRIAL', 'SHOPPING', 'APP_INSTALL', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "offer_deactivation_source" AS ENUM ('SYNC', 'ADMIN');

-- CreateEnum
CREATE TYPE "sync_mode" AS ENUM ('INCREMENTAL', 'FULL');

-- CreateEnum
CREATE TYPE "sync_outcome" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requirements" TEXT,
    "payout_amount_minor" INTEGER NOT NULL,
    "payout_currency" CHAR(3) NOT NULL,
    "reward_points" INTEGER NOT NULL,
    "category" "offer_category" NOT NULL,
    "provider_categories" TEXT[],
    "countries" TEXT[],
    "devices" TEXT[],
    "image_url" TEXT,
    "tracking_url_template" TEXT NOT NULL,
    "is_multi_step" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "deactivation_source" "offer_deactivation_source",
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_sync_runs" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "mode" "sync_mode" NOT NULL,
    "outcome" "sync_outcome" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "offers_fetched" INTEGER NOT NULL DEFAULT 0,
    "offers_accepted" INTEGER NOT NULL DEFAULT 0,
    "offers_rejected" INTEGER NOT NULL DEFAULT 0,
    "offers_created" INTEGER NOT NULL DEFAULT 0,
    "offers_updated" INTEGER NOT NULL DEFAULT 0,
    "offers_deactivated" INTEGER NOT NULL DEFAULT 0,
    "rejections" JSONB,
    "error_summary" TEXT,

    CONSTRAINT "offer_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_provider_id_last_seen_at_idx" ON "offers"("provider_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "offers_provider_id_is_active_idx" ON "offers"("provider_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "offers_provider_id_external_id_key" ON "offers"("provider_id", "external_id");

-- CreateIndex
CREATE INDEX "offer_sync_runs_provider_id_started_at_idx" ON "offer_sync_runs"("provider_id", "started_at");

-- CreateIndex
CREATE INDEX "offer_sync_runs_started_at_idx" ON "offer_sync_runs"("started_at");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_sync_runs" ADD CONSTRAINT "offer_sync_runs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
