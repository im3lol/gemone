-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'FLAGGED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deviceHash" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "FraudLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudLog_userId_createdAt_idx" ON "FraudLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudLog_type_createdAt_idx" ON "FraudLog"("type", "createdAt");

-- CreateIndex
CREATE INDEX "User_signupIp_idx" ON "User"("signupIp");

-- CreateIndex
CREATE INDEX "User_deviceHash_idx" ON "User"("deviceHash");

-- AddForeignKey
ALTER TABLE "FraudLog" ADD CONSTRAINT "FraudLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
