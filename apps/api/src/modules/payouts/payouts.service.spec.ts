import { describe, expect, it } from 'vitest';

import {
  OFFERS_POINTS_PER_MINOR_UNIT,
  OFFERS_REWARD_SHARE_PERCENT,
} from '../offers/offers.config';
import { PAYOUTS_POINTS_PER_CURRENCY_UNIT } from './payouts.config';
import { __testing } from './payouts.service';

const { toCashMinor, clampLimit, DAY_MS } = __testing;

/**
 * Points to money.
 *
 * The one arithmetic in the payout system, and the one place a rounding
 * decision is made about somebody's money.
 */
describe('toCashMinor', () => {
  it('converts at the configured rate', () => {
    // 1000 points to the currency unit: 5000 points is 5.00, i.e. 500 minor.
    expect(toCashMinor(5000, 1000)).toBe(500);
  });

  it('rounds down, never up', () => {
    /*
     * 1250 points at 1000/unit is 1.25 — exact. 1255 is 1.255, and paying 1.26
     * would be paying a fraction of a cent nobody earned. Doing that on every
     * payout is a slow leak with no record; the remainder stays as points the
     * user keeps and can withdraw later.
     */
    expect(toCashMinor(1255, 1000)).toBe(125);
    expect(toCashMinor(1259, 1000)).toBe(125);
  });

  it('never returns a fraction', () => {
    for (const points of [1, 7, 999, 1001, 123_457]) {
      expect(Number.isInteger(toCashMinor(points, 1000))).toBe(true);
    }
  });

  it('handles a rate that makes one point worth a whole currency unit', () => {
    expect(toCashMinor(5, 1)).toBe(500);
  });

  it('gives zero for an amount too small to be worth a cent', () => {
    // Below the minimum withdrawal by construction, but the arithmetic must
    // still be honest rather than rounding nothing up to something.
    expect(toCashMinor(5, 1000)).toBe(0);
  });
});

describe('the shipped rates compose', () => {
  it('pays the user the share the configuration says it pays', () => {
    /*
     * The two rates are set in different modules and neither is wrong on its
     * own, which is how they shipped a factor of ten apart: a 70% share paid
     * 7% of provider revenue on every conversion, and nothing failed.
     *
     * Pinned against the defaults themselves rather than against literals, so
     * changing one without the other fails here instead of in production.
     */
    const revenueMinor = 1_000;

    const points = Math.floor(
      (revenueMinor *
        OFFERS_POINTS_PER_MINOR_UNIT.defaultValue *
        OFFERS_REWARD_SHARE_PERCENT.defaultValue) /
        100,
    );
    const userMinor = toCashMinor(points, PAYOUTS_POINTS_PER_CURRENCY_UNIT.defaultValue);

    expect(userMinor).toBe(
      (revenueMinor * OFFERS_REWARD_SHARE_PERCENT.defaultValue) / 100,
    );
  });

  it('holds the identity the two rates depend on', () => {
    expect(PAYOUTS_POINTS_PER_CURRENCY_UNIT.defaultValue).toBe(
      100 * OFFERS_POINTS_PER_MINOR_UNIT.defaultValue,
    );
  });
});

describe('the daily window', () => {
  it('is a rolling twenty-four hours', () => {
    // Rolling rather than a calendar day, so the cap does not reset at a moment
    // an attacker can simply wait for.
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(100);
  });
});
