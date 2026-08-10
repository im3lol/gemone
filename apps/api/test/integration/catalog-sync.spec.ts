import { Test } from '@nestjs/testing';
import {
  OFFER_CATEGORIES,
  OFFER_DEACTIVATION_SOURCES,
  OFFER_REJECTION_REASONS,
  SYNC_MODES,
  SYNC_OUTCOMES,
} from '@gemone/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { OffersService } from '../../src/modules/offers/offers.service';
import { SyncRunsService } from '../../src/modules/offers/sync-runs.service';
import {
  OFFERS_ACCOUNTING_CURRENCY,
  OFFERS_FULL_SYNC_INTERVAL_HOURS,
  OFFERS_PRUNE_SAFETY_THRESHOLD_PERCENT,
  OFFERS_REWARD_SHARE_PERCENT,
} from '../../src/modules/offers/offers.config';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * The catalog pipeline against a real Postgres — ARCHITECTURE.md §18.3.
 *
 * Driven through the mock provider, which is the point: the sync framework
 * was written with no real network in existence, and everything below runs the
 * production code path end to end — adapter, normalization, storage, pruning,
 * health, and the run record.
 */
describe('catalog synchronization (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let offers: OffersService;
  let runs: SyncRunsService;
  let configuration: ConfigurationService;

  let providerId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    providers = moduleRef.get(ProvidersService);
    catalog = moduleRef.get(CatalogSyncService);
    offers = moduleRef.get(OffersService);
    runs = moduleRef.get(SyncRunsService);
    configuration = moduleRef.get(ConfigurationService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    // Clicks reference users, offers and providers, so they go first.
    await prisma.conversion.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    await prisma.provider.deleteMany();
    configuration.invalidateAll();
    // Pinned to the rate these expectations were written against. The shipped
    // default changed from 1 to 10 when it was found to pay users a tenth of
    // the configured revenue share; what these tests check is mechanics, not
    // the launch economics, so they set the rate they depend on.
    await configuration.set(OFFERS_POINTS_PER_MINOR_UNIT.key, 1, {
      actor: { type: 'system' },
    });

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
  });

  describe('the internal model', () => {
    it('normalizes a provider catalog into rows nothing provider-specific survives into', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      const stored = await prisma.offer.findMany({ orderBy: { externalId: 'asc' } });

      // The mock's fixture carries four campaigns. One is unmappable and the
      // adapter drops it; one is quoted in EUR and the catalog refuses it.
      expect(stored).toHaveLength(2);

      const racer = stored.find((offer) => offer.externalId === 'MK-100241');
      expect(racer).toBeDefined();

      // The whole point of the feature: one shape, whoever it came from.
      expect(racer!.title).toBe('Skyline Racer — reach level 12');
      expect(racer!.payoutAmountMinor).toBe(245);
      expect(racer!.payoutCurrency).toBe('USD');
      expect(racer!.rewardPoints).toBe(171); // 245 × 1 × 70% floored
      expect(racer!.category).toBe(OFFER_CATEGORIES.GAME);
      expect(racer!.providerCategories).toEqual(['mobile_game', 'ios']);
      expect(racer!.countries).toEqual(['US', 'CA', 'GB']);
      expect(racer!.isActive).toBe(true);
    });

    it('prices the catalog by the provider-scoped rate — P3', async () => {
      await configuration.set(OFFERS_REWARD_SHARE_PERCENT.key, 40, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'admin', id: '0192f0a0-0000-7000-8000-0000000000ad' },
      });

      await catalog.sync(providerId, SYNC_MODES.FULL);

      const racer = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });

      // 245 × 1 × 40% = 98. No deployment involved.
      expect(racer.rewardPoints).toBe(98);
    });

    it('stores the reward rather than recomputing it per read', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const before = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });

      await configuration.set(OFFERS_REWARD_SHARE_PERCENT.key, 10, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'system' },
      });

      const after = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });

      // A rate change must not silently restate what a user is already being
      // shown. It takes effect on the next sync, which is a visible event with
      // a run record, rather than mid-session.
      expect(after.rewardPoints).toBe(before.rewardPoints);
    });
  });

  describe('rejections are counted, not swallowed', () => {
    it('records why each refused offer was refused', async () => {
      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      expect(run.offersFetched).toBe(3); // the adapter already dropped one
      expect(run.offersAccepted).toBe(2);
      expect(run.offersRejected).toBe(1);

      // "The catalog is smaller than yesterday" is a question that gets asked,
      // and `CURRENCY_NOT_SUPPORTED: 1` is an answer somebody can act on.
      expect(run.rejections).toEqual({
        [OFFER_REJECTION_REASONS.CURRENCY_NOT_SUPPORTED]: 1,
      });
    });

    it('accepts the euro offer once the accounting currency allows it', async () => {
      await configuration.set(OFFERS_ACCOUNTING_CURRENCY.key, 'EUR', {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'system' },
      });

      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      // Configuration, not code: the same catalog, a different decision.
      expect(run.offersAccepted).toBe(1);
      expect(
        await prisma.offer.count({ where: { payoutCurrency: 'EUR', isActive: true } }),
      ).toBe(1);
    });
  });

  describe('incremental versus full', () => {
    it('re-runs are idempotent: the same catalog produces the same rows', async () => {
      const first = await catalog.sync(providerId, SYNC_MODES.FULL);
      const second = await catalog.sync(providerId, SYNC_MODES.INCREMENTAL);

      expect(first.offersCreated).toBe(2);
      expect(second.offersCreated).toBe(0);
      expect(second.offersUpdated).toBe(2);
      expect(await prisma.offer.count()).toBe(2);
    });

    it('INCREMENTAL never deactivates, even when an offer has vanished', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      // An offer the provider no longer lists, standing in for a catalog that
      // shrank between runs.
      await prisma.offer.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000f1',
          providerId,
          externalId: 'GONE-1',
          title: 'No longer listed',
          payoutAmountMinor: 100,
          payoutCurrency: 'USD',
          rewardPoints: 70,
          category: OFFER_CATEGORIES.OTHER,
          trackingUrlTemplate: 'https://track.example.test/c?s1={sub_id}',
          devices: ['mobile'],
          lastSeenAt: new Date('2020-01-01T00:00:00Z'),
        },
      });

      const run = await catalog.sync(providerId, SYNC_MODES.INCREMENTAL);

      /*
       * The entire distinction between the modes. An incremental run makes no
       * claim about what it did NOT see — it may have fetched a filtered or
       * truncated view — so deactivating on absence would be acting on
       * information it does not have.
       */
      expect(run.offersDeactivated).toBe(0);
      expect(
        (await prisma.offer.findFirstOrThrow({ where: { externalId: 'GONE-1' } })).isActive,
      ).toBe(true);
    });

    it('FULL deactivates what it did not see, and says so on the run', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      await prisma.offer.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000f2',
          providerId,
          externalId: 'GONE-2',
          title: 'No longer listed',
          payoutAmountMinor: 100,
          payoutCurrency: 'USD',
          rewardPoints: 70,
          category: OFFER_CATEGORIES.OTHER,
          trackingUrlTemplate: 'https://track.example.test/c?s1={sub_id}',
          devices: ['mobile'],
          lastSeenAt: new Date('2020-01-01T00:00:00Z'),
        },
      });

      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      expect(run.offersDeactivated).toBe(1);

      const gone = await prisma.offer.findFirstOrThrow({ where: { externalId: 'GONE-2' } });
      expect(gone.isActive).toBe(false);
      expect(gone.deactivationSource).toBe(OFFER_DEACTIVATION_SOURCES.SYNC);
      expect(gone.deactivatedAt).not.toBeNull();

      // Never hard-deleted: a click whose offer row vanished is an
      // unanswerable support ticket (DATABASE.md §7.2).
      expect(await prisma.offer.count()).toBe(3);
    });

    it('reactivates an offer the provider lists again', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      await prisma.offer.updateMany({
        where: { externalId: 'MK-100241' },
        data: {
          isActive: false,
          deactivatedAt: new Date('2026-01-01T00:00:00Z'),
          deactivationSource: OFFER_DEACTIVATION_SOURCES.SYNC,
        },
      });

      await catalog.sync(providerId, SYNC_MODES.INCREMENTAL);

      const revived = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });

      // A provider restoring an offer is normal — a promotion pauses and
      // resumes — so a sync may undo a deactivation a sync performed.
      expect(revived.isActive).toBe(true);
      expect(revived.deactivationSource).toBeNull();
      expect(revived.deactivatedAt).toBeNull();
    });
  });

  describe('the prune safety guard', () => {
    it('refuses to empty a catalog when a provider returns almost nothing', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      // Twenty live offers, against a provider response that carries two.
      for (let i = 0; i < 20; i += 1) {
        await prisma.offer.create({
          data: {
            id: `0192f0a0-0000-7000-8000-00000000a0${String(i).padStart(2, '0')}`,
            providerId,
            externalId: `BULK-${i}`,
            title: `Bulk offer ${i}`,
            payoutAmountMinor: 100,
            payoutCurrency: 'USD',
            rewardPoints: 70,
            category: OFFER_CATEGORIES.OTHER,
            trackingUrlTemplate: 'https://track.example.test/c?s1={sub_id}',
            devices: ['mobile'],
            lastSeenAt: new Date('2020-01-01T00:00:00Z'),
          },
        });
      }

      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      /*
       * 2 accepted against 22 active is 9% — far below the 50% default. The
       * run completes as PARTIAL and deactivates nothing.
       *
       * Failing towards a stale catalog is recoverable; failing towards an
       * empty one is an outage nobody notices until the wall is blank (P5).
       */
      expect(run.outcome).toBe(SYNC_OUTCOMES.PARTIAL);
      expect(run.offersDeactivated).toBe(0);
      expect(run.errorSummary).toContain('Prune skipped');
      expect(await prisma.offer.count({ where: { isActive: true } })).toBe(22);
    });

    it('prunes normally once the threshold permits it', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      for (let i = 0; i < 20; i += 1) {
        await prisma.offer.create({
          data: {
            id: `0192f0a0-0000-7000-8000-00000000b0${String(i).padStart(2, '0')}`,
            providerId,
            externalId: `BULK-${i}`,
            title: `Bulk offer ${i}`,
            payoutAmountMinor: 100,
            payoutCurrency: 'USD',
            rewardPoints: 70,
            category: OFFER_CATEGORIES.OTHER,
            trackingUrlTemplate: 'https://track.example.test/c?s1={sub_id}',
            devices: ['mobile'],
            lastSeenAt: new Date('2020-01-01T00:00:00Z'),
          },
        });
      }

      // The guard is configuration, not a hardcoded rule (P3) — an operator
      // who has verified the shrink is real can let the prune through.
      await configuration.set(OFFERS_PRUNE_SAFETY_THRESHOLD_PERCENT.key, 0, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'admin', id: '0192f0a0-0000-7000-8000-0000000000ad' },
      });

      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      expect(run.outcome).toBe(SYNC_OUTCOMES.SUCCESS);
      expect(run.offersDeactivated).toBe(20);
    });

    it('does not stand in the way of the very first sync', async () => {
      // An empty catalog has nothing to protect, so the guard must not turn
      // "no offers yet" into a permanent refusal to accept any.
      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      expect(run.outcome).toBe(SYNC_OUTCOMES.SUCCESS);
      expect(run.offersCreated).toBe(2);
    });
  });

  describe("an admin's deactivation outranks the sync", () => {
    it('does not resurrect an offer an admin pulled', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      const offer = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });
      await offers.setActive(offer.id, false);

      await catalog.sync(providerId, SYNC_MODES.FULL);

      const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });

      /*
       * The reason deactivation carries a source rather than being one
       * boolean. The provider still lists this offer, so a sync that simply
       * set `isActive = true` would mean "remove this offer" quietly became
       * "remove it until the next sync" — which is not what anyone asking for
       * it meant, and would take a minute to undo itself.
       */
      expect(after.isActive).toBe(false);
      expect(after.deactivationSource).toBe(OFFER_DEACTIVATION_SOURCES.ADMIN);
    });

    it('still refreshes the content of an admin-deactivated offer', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const offer = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });
      await offers.setActive(offer.id, false);
      await prisma.offer.update({ where: { id: offer.id }, data: { title: 'stale' } });

      await catalog.sync(providerId, SYNC_MODES.INCREMENTAL);

      const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });

      // Suppressed, not frozen. When an admin re-enables it they should get
      // the current offer, not whatever it said the day it was pulled.
      expect(after.title).toBe('Skyline Racer — reach level 12');
      expect(after.isActive).toBe(false);
    });

    it('lets an admin put it back, returning it to sync-managed life', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const offer = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });

      await offers.setActive(offer.id, false);
      await offers.setActive(offer.id, true);

      const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(after.isActive).toBe(true);
      // Source cleared, so the offer is ordinary again rather than pinned on.
      expect(after.deactivationSource).toBeNull();
    });

    it('refuses a no-op transition', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const offer = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'MK-100241' },
      });

      await expect(offers.setActive(offer.id, true)).rejects.toThrow(/already active/);
    });
  });

  describe('failure handling', () => {
    it('records a run and decrements health when a provider cannot be reached', async () => {
      // Disabling makes the registry refuse to hand out the adapter, which is
      // the same shape of failure as an unreachable provider from the
      // pipeline's point of view.
      await providers.setEnabled(providerId, false);
      await providers.reload();

      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      expect(run.outcome).toBe(SYNC_OUTCOMES.FAILED);
      expect(run.errorSummary).toContain('PROVIDER_DISABLED');

      // The health signal that means something: this IS the work we do
      // against the provider, so its failure is the honest input.
      const provider = await providers.requireById(providerId);
      expect(provider.consecutiveFailureCount).toBe(1);
      expect(provider.lastFailureReason).toContain('PROVIDER_DISABLED');
    });

    it('does not throw — a failed sync is recorded, not raised', async () => {
      await providers.setEnabled(providerId, false);
      await providers.reload();

      // A provider being unreachable is the normal weather of a platform
      // built on third parties. A job that throws on it produces a stack
      // trace where a recorded run is wanted.
      await expect(catalog.sync(providerId, SYNC_MODES.FULL)).resolves.toBeDefined();
    });

    it('marks the provider healthy again after a successful run', async () => {
      await providers.setEnabled(providerId, false);
      await providers.reload();
      await catalog.sync(providerId, SYNC_MODES.FULL);

      await providers.setEnabled(providerId, true);
      await providers.reload();
      await catalog.sync(providerId, SYNC_MODES.FULL);

      const provider = await providers.requireById(providerId);
      expect(provider.consecutiveFailureCount).toBe(0);
      expect(provider.lastSuccessfulSyncAt).not.toBeNull();
    });

    it('leaves whatever it already wrote in place', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      await providers.setEnabled(providerId, false);
      await providers.reload();
      await catalog.sync(providerId, SYNC_MODES.FULL);

      // A partial catalog beats an empty one, and the next full run
      // reconciles it.
      expect(await prisma.offer.count({ where: { isActive: true } })).toBe(2);
    });
  });

  describe('synchronization history', () => {
    it('opens the run before the work, so a crash is still visible', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      const [run] = (await runs.findMany({ providerId })).items;

      /*
       * The row exists with a start time whatever happens next. A run recorded
       * only on completion is invisible exactly when it matters — when the
       * process died halfway and nobody knows if the catalog is half-written
       * (§12.2, rule 5).
       */
      expect(run!.startedAt).toBeInstanceOf(Date);
      expect(run!.finishedAt).not.toBeNull();
      expect(run!.finishedAt!.getTime()).toBeGreaterThanOrEqual(run!.startedAt.getTime());
    });

    it('keeps every attempt, newest first', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      await catalog.sync(providerId, SYNC_MODES.INCREMENTAL);

      const page = await runs.findMany({ providerId });

      expect(page.total).toBe(2);
      expect(page.items[0]!.mode).toBe(SYNC_MODES.INCREMENTAL);
      expect(page.items[1]!.mode).toBe(SYNC_MODES.FULL);
    });

    it('filters by outcome', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      await providers.setEnabled(providerId, false);
      await providers.reload();
      await catalog.sync(providerId, SYNC_MODES.FULL);

      const failed = await runs.findMany({ outcome: SYNC_OUTCOMES.FAILED });
      expect(failed.total).toBe(1);
    });

    it('exposes duration on the summary without storing it', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const [run] = (await runs.findMany({ providerId })).items;

      const summary = SyncRunsService.toSummary(run!, 'mock');

      // Derived from two timestamps that are already stored. A third column
      // would be a number that can disagree with them.
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('scheduling decisions', () => {
    it('calls the first ever sync FULL', async () => {
      const due = await catalog.dueProviders(new Date('2026-08-02T12:00:00Z'));

      // Without a baseline there is nothing to prune against, so the first run
      // must be the authoritative one.
      expect(due).toEqual([{ providerId, mode: SYNC_MODES.FULL }]);
    });

    it('drops to INCREMENTAL once a full run is recent', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      // A full run also marks the provider synced, so move past its interval.
      const later = new Date(Date.now() + 2 * 60 * 60 * 1000);

      const due = await catalog.dueProviders(later);

      expect(due).toEqual([{ providerId, mode: SYNC_MODES.INCREMENTAL }]);
    });

    it('returns to FULL once the configured interval has elapsed', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      await configuration.set(OFFERS_FULL_SYNC_INTERVAL_HOURS.key, 1, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'system' },
      });

      const due = await catalog.dueProviders(new Date(Date.now() + 2 * 60 * 60 * 1000));

      expect(due).toEqual([{ providerId, mode: SYNC_MODES.FULL }]);
    });

    it('says nothing is due before the provider interval elapses', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);

      // The provider's default interval is 60 minutes; ten have passed.
      const due = await catalog.dueProviders(new Date(Date.now() + 10 * 60 * 1000));

      expect(due).toEqual([]);
    });

    it('sees a provider added by another process', async () => {
      /*
       * The regression test for the bug this feature's live run exposed.
       *
       * An admin adds and enables a provider through the `api` process, which
       * reloads its own in-memory registry and nobody else's. The `worker` —
       * the process that runs every scheduled sync — booted earlier and still
       * has an empty snapshot. Before the fix, its tick reported nothing due
       * forever, and the catalog never populated.
       *
       * Written here by going round `ProvidersService`, which is exactly what
       * "a different process did it" looks like from this one's point of view.
       */
      // The slug is unique, so the row this test's setup created has to go
      // first — it stands in for "this process has never heard of it".
      await prisma.provider.delete({ where: { id: providerId } });
      await prisma.provider.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000d1',
          slug: 'mock',
          displayName: 'Added elsewhere',
          isEnabled: true,
        },
      });

      const due = await catalog.dueProviders(new Date(Date.now()));

      expect(due).toEqual([
        { providerId: '0192f0a0-0000-7000-8000-0000000000d1', mode: SYNC_MODES.FULL },
      ]);
    });

    it('syncs a provider enabled by another process, without a restart', async () => {
      // Same staleness, on the other entry point: an admin pressing "sync
      // now" straight after enabling a provider.
      await prisma.provider.update({ where: { id: providerId }, data: { isEnabled: false } });
      await providers.reload();
      await prisma.provider.update({ where: { id: providerId }, data: { isEnabled: true } });

      const run = await catalog.sync(providerId, SYNC_MODES.FULL);

      expect(run.outcome).toBe(SYNC_OUTCOMES.SUCCESS);
      expect(run.offersAccepted).toBe(2);
    });

    it('ignores a disabled provider entirely', async () => {
      await providers.setEnabled(providerId, false);
      await providers.reload();

      // §7.3: a disabled provider is inert. Scheduling work for it would
      // repopulate a catalog somebody deliberately switched off.
      expect(await catalog.dueProviders(new Date(Date.now()))).toEqual([]);
    });
  });

  describe('configuration inventory', () => {
    it('registers exactly the keys the application owns', () => {
      const keys = configuration
        .definitionsList()
        .map((definition) => definition.key)
        .filter((key) => !key.startsWith('test.'))
        .sort();

      // Grows one feature at a time. A key appearing here that nobody
      // announced is a business rule that slipped in without a decision.
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
