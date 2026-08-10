-- CreateEnum
CREATE TYPE "reward_transaction_type" AS ENUM ('CONVERSION_CREDIT', 'CHARGEBACK_DEBIT', 'REWARD_MATURATION', 'PAYOUT_LOCK', 'PAYOUT_SETTLE', 'PAYOUT_REFUND', 'MANUAL_ADJUSTMENT', 'BONUS');

-- CreateEnum
CREATE TYPE "reward_actor_type" AS ENUM ('USER', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "user_balances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pending_points" INTEGER NOT NULL DEFAULT 0,
    "available_points" INTEGER NOT NULL DEFAULT 0,
    "locked_points" INTEGER NOT NULL DEFAULT 0,
    "lifetime_earned_points" INTEGER NOT NULL DEFAULT 0,
    "lifetime_withdrawn_points" INTEGER NOT NULL DEFAULT 0,
    "lifetime_reversed_points" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "reward_transaction_type" NOT NULL,
    "amount_points" INTEGER NOT NULL,
    "pending_delta" INTEGER NOT NULL,
    "available_delta" INTEGER NOT NULL,
    "locked_delta" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "source_transaction_id" UUID,
    "actor_type" "reward_actor_type" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "matures_at" TIMESTAMPTZ(3),
    "hold_period_days" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_balances_user_id_key" ON "user_balances"("user_id");

-- CreateIndex
CREATE INDEX "reward_transactions_user_id_created_at_idx" ON "reward_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reward_transactions_source_transaction_id_type_idx" ON "reward_transactions"("source_transaction_id", "type");

-- CreateIndex
CREATE INDEX "reward_transactions_type_matures_at_idx" ON "reward_transactions"("type", "matures_at");

-- CreateIndex
CREATE INDEX "reward_transactions_source_type_source_id_idx" ON "reward_transactions"("source_type", "source_id");

-- AddForeignKey
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "reward_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
