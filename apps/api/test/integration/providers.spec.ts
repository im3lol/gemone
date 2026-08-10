import { Test } from '@nestjs/testing';
import {
  PROVIDER_CAPABILITIES,
  PROVIDER_HEALTH_STATES,
} from '@gemone/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { DomainError, ValidationError } from '../../src/core/errors/app-error';
import { ProviderHealthService } from '../../src/modules/providers/provider-health.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import {
  PROVIDER_HEALTH_DEGRADED_AFTER,
  PROVIDER_HEALTH_DOWN_AFTER,
} from '../../src/modules/providers/providers.config';
import { ProviderRegistry } from '../../src/modules/providers/registry/provider-registry';

/**
 * Provider infrastructure against a real Postgres — ARCHITECTURE.md §18.3.
 *
 * Built on the whole `AppModule`, not a hand-assembled subset, because the
 * behaviour under test *is* the lifecycle: whether the registry is populated
 * by the time the application has booted, and whether a write reaches the
 * in-memory snapshot. A test that called `load()` itself would verify a
 * method nobody calls in production.
 */
describe('provider infrastructure (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let registry: ProviderRegistry;
  let health: ProviderHealthService;
  let configuration: ConfigurationService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // `init()` fires both lifecycle hooks — onModuleInit and, crucially here,
    // onApplicationBootstrap, which is where the registry is populated.
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    providers = moduleRef.get(ProvidersService);
    registry = moduleRef.get(ProviderRegistry);
    health = moduleRef.get(ProviderHealthService);
    configuration = moduleRef.get(ConfigurationService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    // The catalog references providers, so it goes first — these tests
    // predate `offers` and would otherwise trip the foreign key on rows a
    // previous file left behind.
    // Clicks reference users, offers and providers, so they go first.
    await prisma.conversion.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.provider.deleteMany();
    configuration.invalidateAll();
    await providers.reload();
  });

  const createMock = () =>
    providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });

  describe('lifecycle', () => {
    it('populates the registry from the database at application bootstrap', async () => {
      await createMock();
      await providers.reload();

      expect(registry.isLoaded()).toBe(true);
      expect(registry.find('mock')).toBeDefined();
    });

    it('resolves credentials from the environment, not from the row', async () => {
      const provider = await createMock();
      await providers.reload();

      const stored = await prisma.provider.findUnique({ where: { id: provider.id } });

      // DATABASE.md §1: the row carries configuration and operational state,
      // never secrets. A secret in a row is a secret in every backup, every
      // replica, and the blast radius of any SQL injection.
      expect(JSON.stringify(stored)).not.toContain('mock-fixture-secret');
      expect(registry.find('mock')).toBeDefined();
    });

    it('reflects a write in the registry snapshot without a restart', async () => {
      const provider = await createMock();
      await providers.reload();

      expect(registry.enabled()).toEqual([]);

      await providers.setEnabled(provider.id, true);
      await providers.reload();

      expect(registry.enabled().map((p) => p.slug)).toEqual(['mock']);
    });

    it('replaces the snapshot on reload rather than accumulating', async () => {
      await createMock();
      await providers.reload();
      expect(registry.all()).toHaveLength(1);

      await prisma.provider.deleteMany();
      await providers.reload();

      // A merge would leave a deleted provider resolvable forever — and for a
      // provider that means still accepting its postbacks.
      expect(registry.all()).toEqual([]);
    });
  });

  describe('registration validation', () => {
    it('refuses a row naming a slug this build has no adapter for', async () => {
      await expect(
        providers.create({ slug: 'no-such-network', displayName: 'Ghost' }),
      ).rejects.toThrow(DomainError);

      // Caught on write, when the message can list the valid options — rather
      // than becoming a permanently unusable row that can never sync and can
      // never verify a postback.
      expect(await prisma.provider.count()).toBe(0);
    });

    it('names the available slugs in the rejection', async () => {
      await providers
        .create({ slug: 'typo', displayName: 'Typo' })
        .catch((error: DomainError) => {
          expect(error.message).toContain('mock');
        });
    });

    it('refuses a malformed postback IP range', async () => {
      await expect(
        providers.create({
          slug: 'mock',
          displayName: 'Mock',
          postbackIpRanges: ['203.0.113.0/24', 'not-an-ip'],
        }),
      ).rejects.toThrow(ValidationError);

      // A malformed range does not fail loudly at verification time; it
      // simply matches nothing, quarantining every legitimate postback.
      expect(await prisma.provider.count()).toBe(0);
    });

    it('refuses a duplicate slug', async () => {
      await createMock();
      await expect(createMock()).rejects.toThrow(DomainError);
      expect(await prisma.provider.count()).toBe(1);
    });

    it('creates a provider disabled, and the request cannot say otherwise', async () => {
      const provider = await createMock();
      await providers.reload();

      // A provider needs its postback ranges and per-provider configuration
      // set before it should receive anything. Enabling is a separate,
      // audited decision.
      expect(provider.isEnabled).toBe(false);
      expect(registry.all()).toHaveLength(1);
      expect(registry.enabled()).toEqual([]);
    });
  });

  describe('enable and disable', () => {
    it('makes a disabled provider inert while keeping it resolvable', async () => {
      const provider = await createMock();
      await providers.setEnabled(provider.id, true);
      await providers.reload();
      expect(registry.enabled()).toHaveLength(1);

      await providers.setEnabled(provider.id, false);
      await providers.reload();

      // §7.3: not synced, excluded from the wall, postbacks rejected — but
      // still visible to an operator who wants to turn it back on.
      expect(registry.enabled()).toEqual([]);
      expect(registry.all()).toHaveLength(1);
      expect(() => registry.require('mock')).toThrow(/disabled/);
    });

    it('rejects a no-op transition', async () => {
      const provider = await createMock();

      // Already disabled. Allowing it would write an audit entry describing a
      // change that did not happen.
      await expect(providers.setEnabled(provider.id, false)).rejects.toThrow(DomainError);
    });
  });

  describe('health', () => {
    it('persists the failure streak across a reload', async () => {
      const provider = await createMock();

      await health.recordFailure(provider.id, 'connection reset');
      await health.recordFailure(provider.id, 'connection reset');

      const stored = await prisma.provider.findUniqueOrThrow({ where: { id: provider.id } });

      // DATABASE.md §3.2: persisted rather than computed, so it survives a
      // restart and is visible without re-deriving it from sync history.
      expect(stored.consecutiveFailureCount).toBe(2);
      expect(stored.healthState).toBe(PROVIDER_HEALTH_STATES.HEALTHY);
      expect(stored.lastFailureReason).toBe('connection reset');
    });

    it('transitions HEALTHY → DEGRADED → DOWN at the configured thresholds', async () => {
      const provider = await createMock();

      for (let i = 0; i < 3; i += 1) await health.recordFailure(provider.id, 'timeout');
      expect((await providers.requireById(provider.id)).healthState).toBe(
        PROVIDER_HEALTH_STATES.DEGRADED,
      );

      for (let i = 0; i < 7; i += 1) await health.recordFailure(provider.id, 'timeout');
      expect((await providers.requireById(provider.id)).healthState).toBe(
        PROVIDER_HEALTH_STATES.DOWN,
      );
    });

    it('honours a per-provider threshold override — P3, at PROVIDER scope', async () => {
      const provider = await createMock();

      // Tolerance is not uniform: a network with a flaky API that still pays
      // reliably deserves more patience than one whose failures have meant
      // lost conversions. The scope id is the provider's id, not its slug.
      await configuration.set(PROVIDER_HEALTH_DEGRADED_AFTER.key, 1, {
        scope: 'PROVIDER',
        scopeId: provider.id,
        actor: { type: 'system' },
      });

      await health.recordFailure(provider.id, 'timeout');

      expect((await providers.requireById(provider.id)).healthState).toBe(
        PROVIDER_HEALTH_STATES.DEGRADED,
      );
    });

    it('leaves other providers on the global threshold', async () => {
      const provider = await createMock();

      await configuration.set(PROVIDER_HEALTH_DEGRADED_AFTER.key, 1, {
        scope: 'PROVIDER',
        scopeId: provider.id,
        actor: { type: 'system' },
      });

      // A different scope id still resolves to the global default (14 → 3).
      const resolved = await configuration.resolve<number>(
        PROVIDER_HEALTH_DEGRADED_AFTER.key,
        '0192f0a0-0000-7000-8000-0000000000ff',
      );

      expect(resolved.source).toBe('default');
      expect(resolved.value).toBe(3);
    });

    it('clears the streak outright on success rather than decrementing', async () => {
      const provider = await createMock();

      for (let i = 0; i < 5; i += 1) await health.recordFailure(provider.id, 'timeout');
      await health.recordSuccess(provider.id);

      const stored = await providers.requireById(provider.id);

      // A provider that alternates success and failure is working — badly,
      // but working. A decaying counter would eventually mark it DOWN for a
      // fault it keeps recovering from.
      expect(stored.consecutiveFailureCount).toBe(0);
      expect(stored.healthState).toBe(PROVIDER_HEALTH_STATES.HEALTHY);
      expect(stored.lastSuccessfulSyncAt).not.toBeNull();
      expect(stored.lastFailureReason).toBeNull();
    });

    it('never removes an unhealthy provider from the enabled set', async () => {
      const provider = await createMock();
      await providers.setEnabled(provider.id, true);
      await providers.reload();

      for (let i = 0; i < 20; i += 1) await health.recordFailure(provider.id, 'down');
      await providers.reload();

      expect((await providers.requireById(provider.id)).healthState).toBe(
        PROVIDER_HEALTH_STATES.DOWN,
      );

      /*
       * The trap this avoids has no exit: if DOWN excluded a provider here,
       * nothing would call it, so nothing would ever record a success, and it
       * could never recover on its own. Health informs an operator;
       * `isEnabled` is the decision.
       */
      expect(registry.enabled().map((p) => p.slug)).toEqual(['mock']);
    });

    it('tolerates inverted thresholds without jumping straight to DOWN', async () => {
      const provider = await createMock();

      // Nothing stops an admin setting `down_after` below `degraded_after` —
      // the two keys are validated independently, and cross-key validation is
      // not expressible in a per-key schema.
      await configuration.set(PROVIDER_HEALTH_DEGRADED_AFTER.key, 5, {
        scope: 'PROVIDER',
        scopeId: provider.id,
        actor: { type: 'system' },
      });
      await configuration.set(PROVIDER_HEALTH_DOWN_AFTER.key, 2, {
        scope: 'PROVIDER',
        scopeId: provider.id,
        actor: { type: 'system' },
      });

      for (let i = 0; i < 5; i += 1) await health.recordFailure(provider.id, 'timeout');

      // DOWN is never reached before DEGRADED. Trusting the values verbatim
      // would mark a provider DOWN on its third failure while the screen says
      // it degrades on the fifth.
      expect((await providers.requireById(provider.id)).healthState).toBe(
        PROVIDER_HEALTH_STATES.DEGRADED,
      );
    });

    it('resets health without recording an operation', async () => {
      const provider = await createMock();
      for (let i = 0; i < 12; i += 1) await health.recordFailure(provider.id, 'down');

      await health.reset(provider.id);

      const stored = await providers.requireById(provider.id);
      expect(stored.healthState).toBe(PROVIDER_HEALTH_STATES.HEALTHY);
      expect(stored.consecutiveFailureCount).toBe(0);
      // Reset is not a success: it clears the alarm, it does not claim a sync
      // happened.
      expect(stored.lastSuccessfulSyncAt).toBeNull();
    });
  });

  describe('capability discovery', () => {
    it('describes what the build supports before any row exists', async () => {
      const reports = registry.describeAdapters();
      const mock = reports.find((r) => r.slug === 'mock');

      expect(mock).toBeDefined();
      expect(mock!.capabilities).toContain(PROVIDER_CAPABILITIES.REVERSALS);
      expect(mock!.postbackSigningScheme).toBe('hmac_sha256');
    });

    it('reports credential variable names, never their values', () => {
      const [mock] = registry.describeAdapters();

      expect(mock!.requiredCredentialVariables).toEqual([
        'PROVIDER_MOCK_SECRET',
        'PROVIDER_MOCK_AFFILIATE_ID',
      ]);
      expect(JSON.stringify(mock)).not.toContain('mock-fixture-secret');
    });

    it('surfaces capabilities on the provider summary', async () => {
      const provider = await createMock();
      await providers.reload();

      const summary = providers.toSummary(await providers.requireById(provider.id));

      expect(summary.adapterRegistered).toBe(true);
      expect(summary.registrationError).toBeNull();
      expect(summary.capabilities).toContain(PROVIDER_CAPABILITIES.PARSE_POSTBACK);
    });
  });

  describe('a provider row whose adapter has gone away', () => {
    it('stays inert and visible instead of taking the process down', async () => {
      // Inserted directly, bypassing the write-time slug check — which is
      // exactly what a code removal underneath an existing row looks like.
      await prisma.provider.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000e1',
          slug: 'removed-network',
          displayName: 'Removed Network',
          isEnabled: true,
        },
      });

      await providers.reload();

      expect(registry.failures().map((f) => f.slug)).toEqual(['removed-network']);
      expect(registry.enabled()).toEqual([]);

      const summary = providers.toSummary(
        await providers.requireById('0192f0a0-0000-7000-8000-0000000000e1'),
      );

      // The admin screen must not render this as an ordinary provider — this
      // is precisely the state someone is trying to find.
      expect(summary.adapterRegistered).toBe(false);
      expect(summary.registrationError).toContain('no adapter');
      expect(summary.capabilities).toEqual([]);
    });

    it('refuses to enable a provider the running build cannot serve', async () => {
      const created = await prisma.provider.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000e2',
          slug: 'removed-network',
          displayName: 'Removed Network',
          isEnabled: false,
        },
      });

      await providers.reload();

      // Otherwise the provider is on, visible, and incapable of verifying
      // anything that arrives at its public postback endpoint.
      await expect(providers.setEnabled(created.id, true)).rejects.toThrow(DomainError);
    });
  });

  describe('configuration keys', () => {
    it('registers exactly the keys this feature owns', () => {
      const keys = configuration
        .definitionsList()
        .map((d) => d.key)
        .filter((key) => !key.startsWith('test.'))
        .sort();

      /*
       * The guard that keeps P3 honest in both directions.
       *
       * Keys arrive with the feature that owns the rule, so this list grows
       * one feature at a time — and a key appearing here that nobody
       * announced is a business rule that slipped in without a decision.
       */
      expect(keys).toEqual([
        'auth.email_verification_ttl_seconds',
        'auth.login_account_window_seconds',
        'auth.login_ip_window_seconds',
        'auth.login_max_failures_per_account',
        'auth.login_max_failures_per_ip',
        'auth.password_reset_ttl_seconds',
        'auth.public_ip_window_seconds',
        'auth.public_max_requests_per_ip',
        'clicks.attribution_window_days',
        'clicks.max_per_ip_per_hour',
        'clicks.max_per_user_per_hour',
        'fraud.chargeback_minimum_conversions',
        'fraud.disposable_email_domains',
        'fraud.enabled',
        'fraud.rules.chargeback_rate',
        'fraud.rules.disposable_email',
        'fraud.rules.impossible_timing',
        'fraud.rules.ip_conversion_velocity',
        'fraud.rules.shared_device_accounts',
        'fraud.rules.shared_ip_accounts',
        'fraud.rules.user_conversion_velocity',
        'fraud.shared_identity_window_days',
        'fraud.velocity_window_minutes',
        'offers.accounting_currency',
        'offers.points_per_minor_unit',
        'offers.reward_share_percent',
        'offers.sync.full_sync_interval_hours',
        'offers.sync.prune_safety_threshold_percent',
        'payouts.currency',
        'payouts.enabled_methods',
        'payouts.max_requests_per_day',
        'payouts.maximum_points',
        'payouts.minimum_points',
        'payouts.points_per_currency_unit',
        'providers.health.degraded_after_failures',
        'providers.health.down_after_failures',
        'rewards.hold_period_days',
      ]);
    });
  });
});
