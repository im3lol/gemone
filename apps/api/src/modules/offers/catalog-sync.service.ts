import { Injectable, Logger } from '@nestjs/common';
import {
  OFFER_REJECTION_REASONS,
  SYNC_MODES,
  SYNC_OUTCOMES,
  type SyncMode,
} from '@gemone/contracts';

import { ConfigurationService } from '../../core/config/configuration.service';
import { CLOCK, type Clock } from '../../core/time/clock';
import { Inject } from '@nestjs/common';
import { isAppError } from '../../core/errors/app-error';
import type { NormalizedOffer } from '../providers/contracts/normalized';
import { ProviderHealthService } from '../providers/provider-health.service';
import { ProvidersService } from '../providers/providers.service';
import { ProviderRegistry } from '../providers/registry/provider-registry';
import type { OfferSyncRun, Provider } from '../../generated/prisma/client';
import { mapOffer, type CatalogRates } from './internal/offer-normalizer';
import { OffersService } from './offers.service';
import {
  OFFERS_FULL_SYNC_INTERVAL_HOURS,
  OFFERS_PRUNE_SAFETY_THRESHOLD_PERCENT,
} from './offers.config';
import { RatesService } from './rates.service';
import { SyncRunsService, type SyncRunResult } from './sync-runs.service';

/**
 * The catalog synchronization framework — ARCHITECTURE.md §7.5, §12.
 *
 * One pipeline, identical for every provider: fetch through the adapter,
 * normalize into the internal model, write, and — only for a full run —
 * deactivate what was not seen. Nothing in this file branches on which
 * provider it is talking to. That is P1 at work: the framework was written
 * before any real network existed and will not change when one arrives.
 *
 * **What INCREMENTAL and FULL actually differ by: pruning, and only pruning.**
 * Both fetch and both write. A full run additionally deactivates offers it did
 * not see, which is safe only when absence is authoritative — so the mode is a
 * statement about how much of the catalog the run is claiming to know, not
 * about how much work it does.
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly providers: ProvidersService,
    private readonly registry: ProviderRegistry,
    private readonly health: ProviderHealthService,
    private readonly offers: OffersService,
    private readonly runs: SyncRunsService,
    private readonly rates: RatesService,
    private readonly configuration: ConfigurationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Synchronizes one provider.
   *
   * Never throws for an expected failure. A provider being unreachable is the
   * normal weather of a platform built on third parties, and a job that throws
   * on it produces a stack trace where what is wanted is a recorded run and a
   * health decrement. Genuine programming errors still propagate.
   */
  async sync(providerId: string, mode: SyncMode): Promise<OfferSyncRun> {
    await this.refreshRegistry();

    const provider = await this.providers.requireById(providerId);
    const run = await this.runs.start(providerId, mode);

    const counts: SyncRunResult = {
      outcome: SYNC_OUTCOMES.SUCCESS,
      offersFetched: 0,
      offersAccepted: 0,
      offersRejected: 0,
      offersCreated: 0,
      offersUpdated: 0,
      offersDeactivated: 0,
      rejections: {},
    };

    try {
      /*
       * `require` rather than `find`: it refuses a disabled provider and a
       * provider whose adapter could not be registered, each with its own
       * code. Syncing a disabled provider would repopulate a catalog somebody
       * deliberately switched off (§7.3).
       */
      const registered = this.registry.require(provider.slug);
      const rates = await this.resolveRates(providerId);

      const fetched = await registered.adapter.fetchOffers({
        // The full catalog. Targeting is applied at wall-render time against
        // the stored `countries` and `devices`, not at sync time — syncing
        // per country would multiply provider calls by the number of markets
        // and store the same offer many times.
        country: null,
        device: null,
        segment: null,
      });

      counts.offersFetched = fetched.length;

      const seenAt = this.clock.now();
      await this.writeOffers(providerId, fetched, rates, seenAt, counts);

      if (mode === SYNC_MODES.FULL) {
        const pruned = await this.pruneIfSafe(provider, run, counts.offersAccepted);
        counts.offersDeactivated = pruned.deactivated;
        if (!pruned.pruned) {
          counts.outcome = SYNC_OUTCOMES.PARTIAL;
          counts.errorSummary = pruned.reason;
        }
      }

      await this.health.recordSuccess(providerId);

      this.logger.log(
        { providerId, slug: provider.slug, mode, ...summarize(counts) },
        'Catalog sync completed',
      );

      return this.runs.finish(run.id, counts);
    } catch (error) {
      const summary = describeFailure(error);

      /*
       * The health decrement is what connects this run to the provider's
       * state, and it is why `ProviderHealthService` records outcomes rather
       * than probing: this IS the work we do against the provider, so its
       * success or failure is the only health signal that means anything.
       */
      await this.health.recordFailure(providerId, summary);

      this.logger.warn(
        { providerId, slug: provider.slug, mode, reason: summary },
        'Catalog sync failed',
      );

      return this.runs.finish(run.id, {
        ...counts,
        outcome: SYNC_OUTCOMES.FAILED,
        errorSummary: summary,
        // Whatever was written before the failure stays written and stays
        // active. A partial catalog is better than an empty one, and the next
        // full run reconciles it.
      });
    }
  }

  /**
   * Every enabled provider, one after another.
   *
   * Sequential on purpose. §13.1 gives the catalog queue low concurrency
   * because these are long-running, rate-limited outbound calls; running them
   * in parallel from one process would defeat that at the first hop.
   */
  async syncAll(mode: SyncMode): Promise<OfferSyncRun[]> {
    const runs: OfferSyncRun[] = [];

    for (const provider of this.registry.enabled()) {
      runs.push(await this.sync(provider.id, mode));
    }

    return runs;
  }

  /**
   * Which providers are due, and in which mode.
   *
   * Read from the database on every tick rather than held in a schedule.
   * A per-provider repeatable job would have to be re-registered whenever an
   * interval changed, a provider was added, or one was disabled — three ways
   * for Redis to drift from Postgres. Here the rows are the schedule.
   */
  async dueProviders(now: Date): Promise<{ providerId: string; mode: SyncMode }[]> {
    await this.refreshRegistry();

    const due: { providerId: string; mode: SyncMode }[] = [];

    for (const registered of this.registry.enabled()) {
      const provider = await this.providers.findById(registered.id);
      if (!provider) continue;

      const fullDue = await this.isFullSyncDue(provider, now);

      if (fullDue) {
        // A full run supersedes an incremental one: it does everything the
        // incremental run does and prunes as well.
        due.push({ providerId: provider.id, mode: SYNC_MODES.FULL });
        continue;
      }

      if (this.isIncrementalDue(provider, now)) {
        due.push({ providerId: provider.id, mode: SYNC_MODES.INCREMENTAL });
      }
    }

    return due;
  }

  // --- Internals ----------------------------------------------------------

  /**
   * Rebuilds the provider registry from the database before acting on it.
   *
   * **Not an optimisation — a correctness requirement, and one that only
   * showed up when the two processes were run for real.**
   *
   * The registry is an in-memory snapshot, rebuilt on write by whichever
   * process made the write. An admin adds and enables a provider through the
   * `api` process, which reloads its own registry and nothing else. The
   * `worker` — the process that actually runs every scheduled sync — booted
   * before that provider existed, so its snapshot is empty and stays empty.
   * The result is not a slow sync: the tick reports nothing due, forever, and
   * the catalog for a newly added provider never populates until somebody
   * restarts the worker.
   *
   * That is not the multi-replica caveat (ARCHITECTURE.md §14.3, TODO T3) — it
   * bites with exactly one of each process, which is every deployment. So the
   * scheduled path re-reads before it decides, at the cost of one indexed
   * query per tick and per run.
   *
   * **§14.3's channel has since landed, and this re-read stays.** It is no
   * longer the mechanism — the worker now learns about a new provider within
   * milliseconds instead of at the next tick — but Redis pub/sub is
   * best-effort: a message published while this process is disconnected is
   * never delivered and never retried. Reconnecting triggers a full resync, so
   * the gap is bounded; this read is what makes it bounded by one tick rather
   * than by whatever the reconnect logic manages. A periodic re-read is the
   * backstop under a best-effort channel, not a duplicate of it.
   */
  private async refreshRegistry(): Promise<void> {
    await this.providers.reload();
  }

  private async writeOffers(
    providerId: string,
    fetched: readonly NormalizedOffer[],
    rates: CatalogRates,
    seenAt: Date,
    counts: SyncRunResult,
  ): Promise<void> {
    // A provider listing the same external id twice would otherwise have the
    // second row silently overwrite the first — the same offer counted once
    // and stored once, with no record that the response was malformed.
    const seenExternalIds = new Set<string>();

    for (const source of fetched) {
      const result = mapOffer(source, rates);

      if (!result.accepted) {
        counts.offersRejected += 1;
        counts.rejections[result.reason] = (counts.rejections[result.reason] ?? 0) + 1;
        continue;
      }

      if (seenExternalIds.has(result.offer.externalId)) {
        counts.offersRejected += 1;
        counts.rejections[OFFER_REJECTION_REASONS.DUPLICATE_EXTERNAL_ID] =
          (counts.rejections[OFFER_REJECTION_REASONS.DUPLICATE_EXTERNAL_ID] ?? 0) + 1;
        continue;
      }

      seenExternalIds.add(result.offer.externalId);

      const { created } = await this.offers.upsertFromSync(providerId, result.offer, seenAt);

      counts.offersAccepted += 1;
      if (created) counts.offersCreated += 1;
      else counts.offersUpdated += 1;
    }
  }

  /**
   * The guard that stands between a provider's bad minute and an empty wall.
   *
   * A full sync deactivates everything it did not see. If the provider
   * returned an empty or truncated response — an outage, a rate limit answered
   * with `{"campaigns": []}`, an expired key — that is every offer they have,
   * switched off, until the next successful run.
   *
   * So pruning is refused when what was accepted falls below a configured
   * percentage of what is currently live. The run is recorded PARTIAL with the
   * reason, and the offers stay up. **Failing towards a stale catalog is
   * recoverable; failing towards an empty one is an outage** (P5).
   */
  private async pruneIfSafe(
    provider: Provider,
    run: OfferSyncRun,
    accepted: number,
  ): Promise<{ pruned: boolean; deactivated: number; reason?: string }> {
    const activeBefore = await this.offers.countActive(provider.id);

    if (activeBefore > 0) {
      const threshold = await this.configuration.get<number>(
        OFFERS_PRUNE_SAFETY_THRESHOLD_PERCENT.key,
        provider.id,
      );

      // Integer comparison rather than a percentage division, so there is no
      // rounding to argue about at the boundary.
      if (accepted * 100 < activeBefore * threshold) {
        const reason =
          `Prune skipped: accepted ${accepted} offers against ${activeBefore} active ` +
          `(below the ${threshold}% safety threshold)`;

        this.logger.warn(
          { providerId: provider.id, slug: provider.slug, accepted, activeBefore, threshold },
          'Full sync refused to deactivate offers',
        );

        return { pruned: false, deactivated: 0, reason };
      }
    }

    const deactivated = await this.offers.deactivateUnseen(provider.id, run.startedAt);
    return { pruned: true, deactivated };
  }

  /**
   * Resolves the provider's economics once per run.
   *
   * Per run, not per offer: a ten-thousand-offer catalog would otherwise issue
   * thirty thousand configuration reads. It also means every offer in one run
   * is priced by the same rate, so a rate changed mid-sync cannot produce a
   * catalog priced two different ways.
   */
  private async resolveRates(providerId: string): Promise<CatalogRates> {
    // Delegated rather than duplicated. Conversion processing prices a payout
    // with the same rates this catalog was priced with, and two
    // implementations of one calculation is how a conversion comes to be worth
    // a different number of points than the offer it came from.
    return this.rates.resolve(providerId);
  }

  private async isFullSyncDue(provider: Provider, now: Date): Promise<boolean> {
    const lastFull = await this.runs.lastSuccessfulFullSyncAt(provider.id);

    // Never synced authoritatively: the first run must be a full one, or the
    // catalog starts life with no baseline to prune against.
    if (lastFull === null) return true;

    const intervalHours = await this.configuration.get<number>(
      OFFERS_FULL_SYNC_INTERVAL_HOURS.key,
      provider.id,
    );

    return now.getTime() - lastFull.getTime() >= intervalHours * 60 * 60 * 1000;
  }

  /**
   * Cadence comes from the provider row, not from configuration.
   *
   * Operational, not economic: getting it wrong wastes a provider's API quota,
   * it does not change what anyone is paid (DATABASE.md §3.2).
   */
  private isIncrementalDue(provider: Provider, now: Date): boolean {
    if (provider.lastSuccessfulSyncAt === null) return true;

    const elapsed = now.getTime() - provider.lastSuccessfulSyncAt.getTime();
    return elapsed >= provider.syncIntervalMinutes * 60 * 1000;
  }
}

/**
 * One line, safe to store and show an admin.
 *
 * Never a stack trace and never a provider's raw response (§15.3). Provider
 * errors are already normalized into four kinds, so the message says what
 * happened without saying which network said it.
 *
 * Keyed on the **error code**, not the class name, for every error in the
 * taxonomy — not only provider ones. `PROVIDER_DISABLED: ...` tells an admin
 * what happened; `DomainError: ...` names a TypeScript class they have no
 * reason to know, and the codes are the part of the contract that is stable
 * across refactors (§15.2).
 */
function describeFailure(error: unknown): string {
  if (isAppError(error)) {
    return `${error.code}: ${error.message}`.slice(0, 500);
  }

  if (error instanceof Error) {
    // Outside the taxonomy — a genuine programming error. The class name is
    // the most useful thing left, and the full detail is already in the log.
    return `${error.name}: ${error.message}`.slice(0, 500);
  }

  return String(error).slice(0, 500);
}

function summarize(counts: SyncRunResult): Record<string, number> {
  return {
    fetched: counts.offersFetched,
    accepted: counts.offersAccepted,
    rejected: counts.offersRejected,
    created: counts.offersCreated,
    updated: counts.offersUpdated,
    deactivated: counts.offersDeactivated,
  };
}

export const __testing = { describeFailure };
