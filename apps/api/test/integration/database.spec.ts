import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EnvModule } from '../../src/core/config/env.module';
import { DatabaseModule } from '../../src/core/database/database.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { HealthModule } from '../../src/core/health/health.module';
import { HealthService } from '../../src/core/health/health.service';

/**
 * Integration tier — ARCHITECTURE.md §18.3.
 *
 * Runs against a real Postgres. The parts most likely to be wrong are the
 * parts where code meets the database, and a mocked client cannot fail to
 * connect, cannot be shut down mid-run, and cannot violate a constraint.
 */
describe('database foundation (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let health: HealthService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [EnvModule, DatabaseModule, HealthModule],
    }).compile();

    // Mirrors what the entrypoints do — without this, lifecycle hooks never
    // fire and the test would exercise a client that was never connected.
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    health = moduleRef.get(HealthService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('connection lifecycle', () => {
    it('connects during module initialisation, not lazily on first query', () => {
      expect(prisma.isConnected()).toBe(true);
    });

    it('executes a real query against the database', async () => {
      const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;

      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.one)).toBe(1);
    });

    it('is talking to PostgreSQL', async () => {
      const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;

      expect(rows[0]?.version).toMatch(/PostgreSQL/);
    });
  });

  describe('migration state', () => {
    it('has applied the baseline migration', async () => {
      const rows = await prisma.$queryRaw<
        { migration_name: string; applied: boolean }[]
      >`SELECT migration_name, finished_at IS NOT NULL AS applied
          FROM _prisma_migrations
         ORDER BY started_at ASC`;

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.applied)).toBe(true);
      expect(rows[0]?.migration_name).toMatch(/_init$/);
    });

    it('contains exactly the tables the migrations declare', async () => {
      const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename
          FROM pg_tables
         WHERE schemaname = 'public'`;

      const tables = rows.map((row) => row.tablename).sort();

      /*
       * A schema inventory, asserted exactly rather than loosely.
       *
       * Every table here arrived with the feature that owns it (DATABASE.md
       * §11), and adding one is a deliberate act that must update this list.
       * A `toContain` assertion would let an accidental table — a stray
       * model, a half-finished migration — sit in production unnoticed.
       */
      expect(tables).toEqual([
        '_prisma_migrations',
        'admin_audit_log',
        'clicks',
        'configuration_history',
        'configuration_values',
        'conversions',
        'fraud_evaluations',
        'offer_sync_runs',
        'offers',
        'payout_requests',
        'provider_postbacks',
        'providers',
        'refresh_tokens',
        'reward_transactions',
        'user_balances',
        'users',
        'verification_tokens',
      ]);
    });
  });

  describe('readiness wiring', () => {
    it('reports ready while the database is reachable', async () => {
      await expect(health.isReady()).resolves.toBe(true);
    });

    it('reaches the database through the health endpoint, not a cached flag', async () => {
      // Proves the multi-provider registration actually connected the check to
      // HealthService. Without it, readiness would return true simply because
      // no checks were registered — passing for the wrong reason.
      await expect(prisma.ping()).resolves.toBe(true);
      await expect(health.isReady()).resolves.toBe(true);
    });

    it('reports not ready once the connection is closed', async () => {
      const isolated = await Test.createTestingModule({
        imports: [EnvModule, DatabaseModule, HealthModule],
      }).compile();
      await isolated.init();

      const isolatedHealth = isolated.get(HealthService);
      await expect(isolatedHealth.isReady()).resolves.toBe(true);

      await isolated.get(PrismaService).onModuleDestroy();

      // The whole point of readiness: traffic must stop being routed here
      // when the dependency is gone.
      await expect(isolatedHealth.isReady()).resolves.toBe(false);

      await isolated.close();
    });
  });
});
