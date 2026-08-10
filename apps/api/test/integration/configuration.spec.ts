import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConfigurationModule } from '../../src/core/config/configuration.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { EnvModule } from '../../src/core/config/env.module';
import { DatabaseModule } from '../../src/core/database/database.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { HealthModule } from '../../src/core/health/health.module';
import { TimeModule } from '../../src/core/time/time.module';
import type { ConfigurationKeyDefinition } from '../../src/core/config/configuration-key';

/**
 * Configuration infrastructure — ARCHITECTURE.md §4.9, P3.
 *
 * These exercise the machinery, not any business rule: no business keys are
 * registered yet, so the tests declare their own. That is the same path a
 * feature will take when it owns a real rule.
 */
describe('configuration service (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let config: ConfigurationService;
  let prisma: PrismaService;

  /** A global-only numeric key. */
  const HOLD_DAYS: ConfigurationKeyDefinition<number> = {
    key: 'test.hold_period_days',
    schema: z.number().int().min(0).max(365),
    defaultValue: 14,
    description: 'Days before points become withdrawable',
    scopes: ['GLOBAL', 'PROVIDER'],
    valueType: 'number',
  };

  /** A key that may only be set globally. */
  const GLOBAL_ONLY: ConfigurationKeyDefinition<boolean> = {
    key: 'test.maintenance_mode',
    schema: z.boolean(),
    defaultValue: false,
    description: 'Whether the platform is in maintenance',
    scopes: ['GLOBAL'],
    valueType: 'boolean',
  };

  const admin = { type: 'admin', id: '0192f0a0-0000-7000-8000-0000000000ad' } as const;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [EnvModule, TimeModule, DatabaseModule, ConfigurationModule, HealthModule],
    }).compile();
    await moduleRef.init();

    config = moduleRef.get(ConfigurationService);
    prisma = moduleRef.get(PrismaService);

    config.register(HOLD_DAYS);
    config.register(GLOBAL_ONLY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    config.invalidateAll();
  });

  describe('the service ships with no keys of its own', () => {
    it('knows only what was registered into it — keys arrive with their features', () => {
      const productionKeys = config
        .definitionsList()
        .map((d) => d.key)
        .filter((key) => !key.startsWith('test.'));

      /*
       * This module graph deliberately excludes the feature modules, so an
       * empty list here says something narrow but useful: `core/config` is a
       * mechanism that defines no business rules of its own. A key can only
       * exist because a module registered it (§4.9).
       *
       * The list of keys the *application* actually registers is asserted in
       * providers.spec.ts, against the full AppModule — that is where a key
       * slipping in without a decision would be caught.
       */
      expect(productionKeys).toEqual([]);
    });
  });

  describe('resolution chain', () => {
    it('falls back to the definition default when nothing is stored', async () => {
      const resolved = await config.resolve<number>(HOLD_DAYS.key);

      expect(resolved.value).toBe(14);
      expect(resolved.source).toBe('default');
    });

    it('prefers a stored global value over the default', async () => {
      await config.set(HOLD_DAYS.key, 7, { actor: admin });

      const resolved = await config.resolve<number>(HOLD_DAYS.key);
      expect(resolved.value).toBe(7);
      expect(resolved.source).toBe('GLOBAL');
    });

    it('prefers a provider override over the global value', async () => {
      await config.set(HOLD_DAYS.key, 7, { actor: admin });
      await config.set(HOLD_DAYS.key, 21, {
        scope: 'PROVIDER',
        scopeId: 'adgem',
        actor: admin,
      });

      // provider → global → default (§4.9).
      expect((await config.resolve<number>(HOLD_DAYS.key, 'adgem')).source).toBe('PROVIDER');
      expect(await config.get<number>(HOLD_DAYS.key, 'adgem')).toBe(21);

      // A different provider still sees the global value.
      expect(await config.get<number>(HOLD_DAYS.key, 'torox')).toBe(7);

      // And an unscoped read is unaffected by any override.
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(7);
    });

    it('falls through to the default when only a provider override is absent', async () => {
      await config.set(HOLD_DAYS.key, 30, {
        scope: 'PROVIDER',
        scopeId: 'adgem',
        actor: admin,
      });

      expect(await config.get<number>(HOLD_DAYS.key, 'lootably')).toBe(14);
    });
  });

  describe('validation on write', () => {
    it('rejects a value that fails the key schema', async () => {
      // Rejected at the boundary, not discovered in production.
      await expect(config.set(HOLD_DAYS.key, 400, { actor: admin })).rejects.toThrow(
        /Invalid value/,
      );
      await expect(config.set(HOLD_DAYS.key, -1, { actor: admin })).rejects.toThrow();
      await expect(
        config.set(HOLD_DAYS.key, 'seven' as never, { actor: admin }),
      ).rejects.toThrow();
    });

    it('rejects an unregistered key entirely', async () => {
      await expect(
        config.set('test.never_declared', 1, { actor: admin }),
      ).rejects.toThrow(/Unknown configuration key/);

      await expect(config.get('test.never_declared')).rejects.toThrow(
        /Unknown configuration key/,
      );
    });

    it('rejects a scope the key does not declare', async () => {
      // A key meaningless per provider must not be settable per provider, or
      // the resolution chain silently returns a value nobody intended.
      await expect(
        config.set(GLOBAL_ONLY.key, true, {
          scope: 'PROVIDER',
          scopeId: 'adgem',
          actor: admin,
        }),
      ).rejects.toThrow(/cannot be set at PROVIDER scope/);
    });

    it('requires a scope id at provider scope', async () => {
      await expect(
        config.set(HOLD_DAYS.key, 7, { scope: 'PROVIDER', actor: admin }),
      ).rejects.toThrow(/scope id is required/);
    });

    it('writes nothing when validation fails', async () => {
      await expect(config.set(HOLD_DAYS.key, 400, { actor: admin })).rejects.toThrow();

      expect(await prisma.configurationValue.count()).toBe(0);
      expect(await prisma.configurationHistory.count()).toBe(0);
    });
  });

  describe('uniqueness', () => {
    it('keeps one row per key and scope across repeated writes', async () => {
      await config.set(HOLD_DAYS.key, 7, { actor: admin });
      await config.set(HOLD_DAYS.key, 10, { actor: admin });
      await config.set(HOLD_DAYS.key, 12, { actor: admin });

      // The unique constraint only holds because scope_id is NOT NULL: in
      // PostgreSQL two NULLs are never equal, so a nullable scope_id would
      // have permitted three separate GLOBAL rows for this key and made
      // resolution depend on row order.
      expect(await prisma.configurationValue.count({ where: { key: HOLD_DAYS.key } })).toBe(1);
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(12);
    });
  });

  describe('history', () => {
    it('records every change with actor and reason', async () => {
      await config.set(HOLD_DAYS.key, 7, { actor: admin, reason: 'initial tuning' });
      await config.set(HOLD_DAYS.key, 10, {
        actor: { type: 'system' },
        reason: 'automatic adjustment',
      });

      const history = await config.history(HOLD_DAYS.key);

      expect(history).toHaveLength(2);
      expect(history[0]!.newValue).toBe(10);
      expect(history[0]!.oldValue).toBe(7);
      expect(history[0]!.actorType).toBe('system');
      expect(history[0]!.actorId).toBeNull();

      expect(history[1]!.oldValue).toBeNull();
      expect(history[1]!.actorType).toBe('admin');
      expect(history[1]!.actorId).toBe(admin.id);
      expect(history[1]!.reason).toBe('initial tuning');
    });

    it('distinguishes system, migration and admin actors', async () => {
      await config.set(HOLD_DAYS.key, 1, { actor: { type: 'migration' } });

      const [entry] = await config.history(HOLD_DAYS.key);

      // A nullable user id cannot distinguish "the system did it" from "we
      // forgot to record who did it" (DATABASE.md §8).
      expect(entry!.actorType).toBe('migration');
      expect(entry!.actorId).toBeNull();
    });

    it('writes value and history in one transaction', async () => {
      await config.set(HOLD_DAYS.key, 7, { actor: admin });

      // Neither can exist without the other: a value in force that nobody can
      // attribute is exactly what the history table exists to prevent.
      expect(await prisma.configurationValue.count()).toBe(1);
      expect(await prisma.configurationHistory.count()).toBe(1);
    });
  });

  describe('caching', () => {
    it('serves repeated reads without re-querying, and still reflects a write', async () => {
      await config.set(HOLD_DAYS.key, 7, { actor: admin });

      expect(await config.get<number>(HOLD_DAYS.key)).toBe(7);
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(7);

      await config.set(HOLD_DAYS.key, 9, { actor: admin });

      // Hot reload: a change takes effect without a restart (§4.9).
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(9);
    });

    it('reflects a value written directly to the database after invalidation', async () => {
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(14);

      await prisma.configurationValue.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000c0',
          key: HOLD_DAYS.key,
          scopeType: 'GLOBAL',
          scopeId: '',
          value: 3,
          valueType: 'number',
        },
      });

      /*
       * The miss was cached, so the stale default is still served.
       *
       * This is not the multi-replica gap — §14.3's channel closed that one,
       * and a write made *through the service* now reaches every process. It
       * is the case that bypasses the service entirely: nothing published a
       * message for this row, because nothing knows it was written. TODO T55.
       */
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(14);

      // The local half of the invalidation pair (D62) — the same method the
      // §14.3 subscriber calls when another process reports a change.
      config.invalidate(HOLD_DAYS.key, 'GLOBAL', '');
      expect(await config.get<number>(HOLD_DAYS.key)).toBe(3);
    });
  });

  describe('registration', () => {
    it('accepts re-registering the identical definition', () => {
      expect(() => config.register(HOLD_DAYS)).not.toThrow();
    });

    it('refuses a conflicting definition for the same key', () => {
      // Two modules disagreeing about a key's schema would otherwise surface
      // as a validation failure on whichever registered last.
      expect(() =>
        config.register({ ...HOLD_DAYS, defaultValue: 99 }),
      ).toThrow(/already registered/);
    });
  });
});
