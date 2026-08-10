-- CreateEnum
CREATE TYPE "postback_state" AS ENUM ('RECEIVED', 'PROCESSED', 'QUARANTINED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "provider_postbacks" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_transaction_id" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "source_ip" TEXT,
    "state" "postback_state" NOT NULL DEFAULT 'RECEIVED',
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "error_detail" TEXT,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "last_duplicate_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_postbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_postbacks_provider_id_received_at_idx" ON "provider_postbacks"("provider_id", "received_at");

-- CreateIndex
CREATE INDEX "provider_postbacks_state_received_at_idx" ON "provider_postbacks"("state", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_postbacks_provider_id_external_transaction_id_key" ON "provider_postbacks"("provider_id", "external_transaction_id");

-- AddForeignKey
ALTER TABLE "provider_postbacks" ADD CONSTRAINT "provider_postbacks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
