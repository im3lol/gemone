import { describe, expect, it } from 'vitest';
import { OFFER_CATEGORIES, OFFER_REJECTION_REASONS } from '@gemone/contracts';

import type { NormalizedOffer } from '../../providers/contracts/normalized';
import { mapOffer, toRewardPoints, type CatalogRates } from './offer-normalizer';

/**
 * The seam every provider arrives at.
 *
 * Pure functions over plain inputs, so the rules that decide what a user is
 * paid are testable exhaustively without a database, a queue, or a provider.
 */

const RATES: CatalogRates = {
  pointsPerMinorUnit: 1,
  rewardSharePercent: 70,
  accountingCurrency: 'USD',
};

function source(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    externalId: 'X-1',
    title: 'Install and reach level 12',
    description: 'A description',
    requirements: 'Reach level 12 within 7 days',
    payoutAmountMinor: 245,
    payoutCurrency: 'USD',
    providerCategories: ['mobile_game'],
    countries: ['us', 'ca'],
    devices: ['mobile'],
    imageUrl: 'https://cdn.example.test/a.png',
    trackingUrlTemplate: 'https://track.example.test/c?s1={sub_id}',
    isMultiStep: false,
    ...overrides,
  };
}

describe('toRewardPoints', () => {
  it('applies the rate and the revenue share', () => {
    // 245 minor units × 1 point × 70% = 171.5 → 171.
    expect(toRewardPoints(245, RATES)).toBe(171);
  });

  it('rounds down, never up', () => {
    /*
     * The remainder stays with the platform. Rounding up looks generous and is
     * a slow leak: a fraction of a point on every conversion comes out of the
     * margin that funds payouts.
     */
    expect(toRewardPoints(1, { ...RATES, rewardSharePercent: 99 })).toBe(0);
    expect(toRewardPoints(3, { ...RATES, rewardSharePercent: 50 })).toBe(1);
  });

  it('is exact for values a float would fumble', () => {
    // The whole reason this is integer arithmetic: `2.45 * 100` is
    // 244.99999999999997, and a rate expressed as a float reintroduces that.
    expect(toRewardPoints(245, { ...RATES, rewardSharePercent: 100 })).toBe(245);
    expect(toRewardPoints(1999, { ...RATES, rewardSharePercent: 100 })).toBe(1999);
  });

  it('scales with points per minor unit', () => {
    expect(toRewardPoints(245, { ...RATES, pointsPerMinorUnit: 10 })).toBe(1715);
  });
});

describe('mapOffer', () => {
  describe('acceptance', () => {
    it('produces the internal model', () => {
      const result = mapOffer(source(), RATES);

      expect(result.accepted).toBe(true);
      if (!result.accepted) return;

      expect(result.offer).toMatchObject({
        externalId: 'X-1',
        payoutAmountMinor: 245,
        payoutCurrency: 'USD',
        rewardPoints: 171,
        category: OFFER_CATEGORIES.GAME,
        devices: ['mobile'],
      });
    });

    it('uppercases country codes and drops duplicates', () => {
      const result = mapOffer(source({ countries: ['us', 'US', ' ca '] }), RATES);

      expect(result.accepted && result.offer.countries).toEqual(['US', 'CA']);
    });

    it('keeps the provider categories verbatim alongside the mapped one', () => {
      const result = mapOffer(source({ providerCategories: ['mobile_game', 'ios'] }), RATES);

      // Stored so a mapping gap is auditable — and fixable — after the fact.
      expect(result.accepted && result.offer.providerCategories).toEqual([
        'mobile_game',
        'ios',
      ]);
      expect(result.accepted && result.offer.category).toBe(OFFER_CATEGORIES.GAME);
    });

    it('turns blank optional text into null rather than empty strings', () => {
      const result = mapOffer(source({ description: '   ', imageUrl: '' }), RATES);

      expect(result.accepted && result.offer.description).toBeNull();
      expect(result.accepted && result.offer.imageUrl).toBeNull();
    });

    it('prices every offer by the rate it is given', () => {
      // Per provider (P3): a network with poor payout reliability can be given
      // a different share without touching code.
      const generous = mapOffer(source(), { ...RATES, rewardSharePercent: 90 });
      expect(generous.accepted && generous.offer.rewardPoints).toBe(220);
    });
  });

  describe('rejection', () => {
    it.each([
      [{ externalId: '  ' }, OFFER_REJECTION_REASONS.MISSING_REQUIRED_FIELD],
      [{ title: '' }, OFFER_REJECTION_REASONS.MISSING_REQUIRED_FIELD],
      [{ trackingUrlTemplate: '' }, OFFER_REJECTION_REASONS.MISSING_REQUIRED_FIELD],
      [{ payoutAmountMinor: 0 }, OFFER_REJECTION_REASONS.INVALID_PAYOUT],
      [{ payoutAmountMinor: -100 }, OFFER_REJECTION_REASONS.INVALID_PAYOUT],
      [{ payoutAmountMinor: 1.5 }, OFFER_REJECTION_REASONS.INVALID_PAYOUT],
      [{ devices: [] }, OFFER_REJECTION_REASONS.NO_TARGET_DEVICE],
    ])('refuses %j with %s', (overrides, reason) => {
      const result = mapOffer(source(overrides as Partial<NormalizedOffer>), RATES);

      expect(result.accepted).toBe(false);
      expect(!result.accepted && result.reason).toBe(reason);
    });

    it('refuses a currency it cannot price, rather than converting it', () => {
      const result = mapOffer(source({ payoutCurrency: 'EUR' }), RATES);

      /*
       * Applying a USD-calibrated rate to euros is silently wrong by whatever
       * the exchange rate is, and invisible: the offer looks fine and pays the
       * wrong amount forever. Refusing is loud, counted on the run, and
       * reversible by configuration.
       */
      expect(!result.accepted && result.reason).toBe(
        OFFER_REJECTION_REASONS.CURRENCY_NOT_SUPPORTED,
      );
    });

    it('refuses an offer the configured rate rounds down to nothing', () => {
      const result = mapOffer(source({ payoutAmountMinor: 1 }), {
        ...RATES,
        rewardSharePercent: 50,
      });

      // Zero points is not a cheap offer, it is a broken promise: the user
      // does the work and is credited nothing.
      expect(!result.accepted && result.reason).toBe(
        OFFER_REJECTION_REASONS.REWARD_TOO_SMALL,
      );
    });

    it('returns a reason instead of throwing', () => {
      // A provider shipping some unusable rows is the normal case, not a
      // fault. One bad offer must never abort a catalog of ten thousand.
      expect(() => mapOffer(source({ title: '' }), RATES)).not.toThrow();
    });
  });

  describe('defence against an adapter that misbehaves', () => {
    it('still refuses what §7.2 rule 5 says an adapter should have dropped', () => {
      // The catalog is what the rest of the platform reads, and it does not
      // get to assume every adapter is correct — including one written by
      // whoever adds the next provider.
      const result = mapOffer(
        { ...source(), title: '', payoutAmountMinor: -1 } as NormalizedOffer,
        RATES,
      );

      expect(result.accepted).toBe(false);
    });

    it('bounds a title long enough to break a screen', () => {
      const result = mapOffer(source({ title: 'x'.repeat(5000) }), RATES);

      expect(result.accepted && result.offer.title.length).toBe(300);
    });
  });
});
