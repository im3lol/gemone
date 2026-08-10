/*
  Warnings:

  - Made the column `scope_id` on table `configuration_history` required. This step will fail if there are existing NULL values in that column.
  - Made the column `scope_id` on table `configuration_values` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "configuration_history" ALTER COLUMN "scope_id" SET NOT NULL,
ALTER COLUMN "scope_id" SET DEFAULT '';

-- AlterTable
ALTER TABLE "configuration_values" ALTER COLUMN "scope_id" SET NOT NULL,
ALTER COLUMN "scope_id" SET DEFAULT '';
