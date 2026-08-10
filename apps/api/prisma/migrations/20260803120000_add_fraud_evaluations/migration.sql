
-- CreateEnum
CREATE TYPE "fraud_action" AS ENUM ('ALLOW', 'HOLD', 'REVIEW', 'BLOCK');

-- AlterTable
ALTER TABLE "conversions" ADD COLUMN     "fraud_evaluation_id" UUID,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_admin_id" UUID;

-- CreateTable
CREATE TABLE "fraud_evaluations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "action" "fraud_action" NOT NULL,
    "applied_action" "fraud_action" NOT NULL,
    "triggered" JSONB NOT NULL,
    "rule_snapshot" JSONB NOT NULL,
    "skipped" JSONB NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fraud_evaluations_user_id_evaluated_at_idx" ON "fraud_evaluations"("user_id", "evaluated_at");

-- CreateIndex
CREATE INDEX "fraud_evaluations_action_evaluated_at_idx" ON "fraud_evaluations"("action", "evaluated_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_fraud_evaluation_id_key" ON "conversions"("fraud_evaluation_id");

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_fraud_evaluation_id_fkey" FOREIGN KEY ("fraud_evaluation_id") REFERENCES "fraud_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_evaluations" ADD CONSTRAINT "fraud_evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

