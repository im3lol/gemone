-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "amount_points" INTEGER NOT NULL,
    "cash_amount_minor" INTEGER NOT NULL,
    "cash_currency" CHAR(3) NOT NULL,
    "points_per_currency_unit" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "lock_transaction_id" UUID NOT NULL,
    "reviewed_by_admin_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason" TEXT,
    "external_reference" TEXT,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_requests_status_created_at_idx" ON "payout_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "payout_requests_user_id_created_at_idx" ON "payout_requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
