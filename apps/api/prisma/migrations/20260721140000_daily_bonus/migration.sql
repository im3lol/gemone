-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastBonusAt" TIMESTAMP(3),
ADD COLUMN     "bonusStreak" INTEGER NOT NULL DEFAULT 0;
