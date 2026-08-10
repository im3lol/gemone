-- CreateEnum
CREATE TYPE "conversion_status" AS ENUM ('PENDING', 'ATTRIBUTED', 'CREDITED', 'HELD', 'REVERSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "conversion_type" AS ENUM ('CONVERSION', 'REVERSAL');

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "click_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "postback_id" UUID NOT NULL,
    "type" "conversion_type" NOT NULL DEFAULT 'CONVERSION',
    "status" "conversion_status" NOT NULL,
    "external_transaction_id" TEXT NOT NULL,
    "external_offer_id" TEXT,
    "payout_amount_minor" INTEGER NOT NULL,
    "payout_currency" CHAR(3) NOT NULL,
    "provider_status" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3),
    "reward_points" INTEGER NOT NULL,
    "points_per_minor_unit" INTEGER NOT NULL,
    "reward_share_percent" INTEGER NOT NULL,
    "reversal_of_id" UUID,
    "review_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversions_postback_id_key" ON "conversions"("postback_id");

-- CreateIndex
CREATE INDEX "conversions_user_id_created_at_idx" ON "conversions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "conversions_status_created_at_idx" ON "conversions"("status", "created_at");

-- CreateIndex
CREATE INDEX "conversions_click_id_idx" ON "conversions"("click_id");

-- CreateIndex
CREATE INDEX "conversions_provider_id_created_at_idx" ON "conversions"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "conversions_offer_id_idx" ON "conversions"("offer_id");

-- CreateIndex
CREATE INDEX "conversions_reversal_of_id_idx" ON "conversions"("reversal_of_id");

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "clicks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_postback_id_fkey" FOREIGN KEY ("postback_id") REFERENCES "provider_postbacks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "conversions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
