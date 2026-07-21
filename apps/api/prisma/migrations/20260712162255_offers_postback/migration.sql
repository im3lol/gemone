-- AlterTable
ALTER TABLE "User" ADD COLUMN     "country" TEXT;

-- CreateTable
CREATE TABLE "PostbackEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "offerId" TEXT,
    "title" TEXT,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostbackEvent_userId_createdAt_idx" ON "PostbackEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostbackEvent_provider_transactionId_type_key" ON "PostbackEvent"("provider", "transactionId", "type");
