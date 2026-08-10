-- CreateTable
CREATE TABLE "clicks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "sub_id" TEXT NOT NULL,
    "offer_title_snapshot" TEXT NOT NULL,
    "reward_points_snapshot" INTEGER NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_fingerprint" TEXT,
    "referrer" TEXT,
    "attribution_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clicks_sub_id_key" ON "clicks"("sub_id");

-- CreateIndex
CREATE INDEX "clicks_user_id_created_at_idx" ON "clicks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "clicks_ip_address_created_at_idx" ON "clicks"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "clicks_offer_id_idx" ON "clicks"("offer_id");

-- CreateIndex
CREATE INDEX "clicks_provider_id_idx" ON "clicks"("provider_id");

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
