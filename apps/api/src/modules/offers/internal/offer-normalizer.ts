import {
  OFFER_REJECTION_REASONS,
  type OfferCategory,
  type OfferRejectionReason,
} from '@gemone/contracts';

import type { NormalizedOffer } from '../../providers/contracts/normalized';
import { categorize } from './offer-category';

/**
 * Provider offer → internal offer (ARCHITECTURE.md §7.5).
 *
 * This is the seam the whole feature exists for: **every provider arrives at
 * the same internal model here**, and everything downstream — the wall, a
 * click, a conversion — reads that model and never a provider's dialect.
 *
 * Written as pure functions over plain inputs, with the configuration values
 * passed in rather than resolved here. Two reasons: the mapping rules are the
 * part most worth testing exhaustively and they should be testable without a
 * database, and resolving configuration per offer would issue one lookup per
 * catalog row where one lookup per run is correct.
 *
 * Note the direction of dependency: `offers` imports the provider *contracts*,
 * never an adapter (§5, rule 6). It could not name a provider if it wanted to.
 */

/** The configured economics for one provider, resolved once per sync run. */
export interface CatalogRates {
  pointsPerMinorUnit: number;
  rewardSharePercent: number;
  accountingCurrency: string;
}

/** The internal shape, ready to be written to `offers`. */
export interface MappedOffer {
  externalId: string;
  title: string;
  description: string | null;
  requirements: string | null;
  payoutAmountMinor: number;
  payoutCurrency: string;
  rewardPoints: number;
  category: OfferCategory;
  providerCategories: string[];
  countries: string[];
  devices: string[];
  imageUrl: string | null;
  trackingUrlTemplate: string;
  isMultiStep: boolean;
}

/**
 * Accepted, or refused with a reason.
 *
 * A result type rather than an exception: a provider shipping some unusable
 * offers is the normal case, not a fault, and one bad row must never abort a
 * catalog of ten thousand. Reasons are counted per run so "the catalog shrank"
 * has an answer.
 */
export type OfferMappingResult =
  | { accepted: true; offer: MappedOffer }
  | { accepted: false; reason: OfferRejectionReason };

const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 4000;

export function mapOffer(source: NormalizedOffer, rates: CatalogRates): OfferMappingResult {
  const externalId = source.externalId?.trim() ?? '';
  const title = source.title?.trim() ?? '';
  const trackingUrlTemplate = source.trackingUrlTemplate?.trim() ?? '';

  if (externalId.length === 0 || title.length === 0 || trackingUrlTemplate.length === 0) {
    // §7.2 rule 5 makes adapters responsible for total normalization, so
    // reaching this means an adapter let something through. Refusing here
    // anyway: the catalog is what the rest of the platform reads, and it does
    // not get to assume every adapter is correct.
    return reject(OFFER_REJECTION_REASONS.MISSING_REQUIRED_FIELD);
  }

  if (!Number.isInteger(source.payoutAmountMinor) || source.payoutAmountMinor <= 0) {
    return reject(OFFER_REJECTION_REASONS.INVALID_PAYOUT);
  }

  const payoutCurrency = (source.payoutCurrency ?? '').trim().toUpperCase();
  if (payoutCurrency !== rates.accountingCurrency) {
    /*
     * Refused, not converted. Applying a rate calibrated for one currency to
     * another is silently wrong by whatever the exchange rate is, and the
     * error is invisible — the offer looks fine and pays the wrong amount
     * forever. Multi-currency is an extension point (§21), not a default.
     */
    return reject(OFFER_REJECTION_REASONS.CURRENCY_NOT_SUPPORTED);
  }

  const devices = unique(source.devices ?? []);
  if (devices.length === 0) {
    // An offer targeting no device can never be shown to anyone.
    return reject(OFFER_REJECTION_REASONS.NO_TARGET_DEVICE);
  }

  const rewardPoints = toRewardPoints(source.payoutAmountMinor, rates);
  if (rewardPoints < 1) {
    // Zero points is not a cheap offer, it is a broken promise: the user does
    // the work and is credited nothing.
    return reject(OFFER_REJECTION_REASONS.REWARD_TOO_SMALL);
  }

  return {
    accepted: true,
    offer: {
      externalId,
      title: title.slice(0, MAX_TITLE_LENGTH),
      description: trimToNull(source.description),
      requirements: trimToNull(source.requirements),
      payoutAmountMinor: source.payoutAmountMinor,
      payoutCurrency,
      rewardPoints,
      category: categorize(source.providerCategories ?? []),
      providerCategories: unique(source.providerCategories ?? []),
      countries: unique((source.countries ?? []).map((code) => code.trim().toUpperCase())),
      devices,
      imageUrl: trimToNull(source.imageUrl),
      trackingUrlTemplate,
      isMultiStep: source.isMultiStep === true,
    },
  };
}

/**
 * Provider payout in minor units → user-facing points.
 *
 * `floor((minor × pointsPerMinorUnit × sharePercent) / 100)`.
 *
 * **Integer arithmetic throughout, and rounded down.** The numerator is a
 * product of integers, so the only division is the final one, and flooring it
 * means a rounding remainder is always kept by the platform rather than given
 * away. Rounding up looks generous and is a slow leak: fractions of a point,
 * multiplied by every conversion, come out of the margin that funds payouts.
 */
export function toRewardPoints(payoutAmountMinor: number, rates: CatalogRates): number {
  const numerator = payoutAmountMinor * rates.pointsPerMinorUnit * rates.rewardSharePercent;
  return Math.floor(numerator / 100);
}

function reject(reason: OfferRejectionReason): OfferMappingResult {
  return { accepted: false, reason };
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_TEXT_LENGTH);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export const __testing = { trimToNull, unique, MAX_TITLE_LENGTH };
