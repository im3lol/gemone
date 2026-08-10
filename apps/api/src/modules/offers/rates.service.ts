import { Injectable } from '@nestjs/common';

import { ConfigurationService } from '../../core/config/configuration.service';
import {
  OFFERS_ACCOUNTING_CURRENCY,
  OFFERS_POINTS_PER_MINOR_UNIT,
  OFFERS_REWARD_SHARE_PERCENT,
} from './offers.config';
import { toRewardPoints, type CatalogRates } from './internal/offer-normalizer';

/**
 * Resolves the configured economics for one provider, and prices a payout in
 * points — ARCHITECTURE.md §7.5, §10.3 step 5.
 *
 * **This is not reward accounting.** It touches no balance, holds no state and
 * knows nothing about users; it answers "what is this payout worth, under the
 * rules currently in force". `RewardAccountingService` (P2) is the only thing
 * that may act on the answer.
 *
 * Extracted from `CatalogSyncService`, where it began as a private method,
 * once a second caller appeared: a conversion is priced from the payout the
 * provider actually reported, using the same rate the catalog was priced with.
 * Two implementations of one calculation is how a conversion comes to be worth
 * a different number of points than the offer it came from — silently, and
 * only for some providers (P6's "two justifies it, one does not").
 */
@Injectable()
export class RatesService {
  constructor(private readonly configuration: ConfigurationService) {}

  /**
   * The rates in force for this provider, resolved PROVIDER → GLOBAL (P3).
   *
   * Resolved once per unit of work and passed down, never per row: a catalog
   * of ten thousand offers would otherwise issue thirty thousand configuration
   * reads, and — more importantly — a rate changed mid-run would produce a
   * catalog priced two different ways.
   */
  async resolve(providerId: string): Promise<RewardRates> {
    const [pointsPerMinorUnit, rewardSharePercent, accountingCurrency] = await Promise.all([
      this.configuration.get<number>(OFFERS_POINTS_PER_MINOR_UNIT.key, providerId),
      this.configuration.get<number>(OFFERS_REWARD_SHARE_PERCENT.key, providerId),
      this.configuration.get<string>(OFFERS_ACCOUNTING_CURRENCY.key, providerId),
    ]);

    return { pointsPerMinorUnit, rewardSharePercent, accountingCurrency };
  }

  /**
   * Integer arithmetic end to end — no float ever touches money
   * (DATABASE.md §5).
   */
  static pointsFor(payoutAmountMinor: number, rates: RewardRates): number {
    return toRewardPoints(payoutAmountMinor, rates);
  }
}

/**
 * The public name for the shape. Declared here rather than in `internal/` so
 * that another module can name it without reaching past this one's boundary
 * (§5, rule 3).
 */
export type RewardRates = CatalogRates;
