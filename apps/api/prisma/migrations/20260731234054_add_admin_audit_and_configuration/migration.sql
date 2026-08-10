-- CreateEnum
CREATE TYPE "config_scope_type" AS ENUM ('GLOBAL', 'PROVIDER');

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_values" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope_type" "config_scope_type" NOT NULL,
    "scope_id" TEXT,
    "value" JSONB NOT NULL,
    "value_type" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_history" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope_type" "config_scope_type" NOT NULL,
    "scope_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_admin_id_created_at_idx" ON "admin_audit_log"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_target_type_target_id_idx" ON "admin_audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "configuration_values_key_idx" ON "configuration_values"("key");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_values_key_scope_type_scope_id_key" ON "configuration_values"("key", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "configuration_history_key_created_at_idx" ON "configuration_history"("key", "created_at");
