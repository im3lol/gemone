import { describe, expect, it } from 'vitest';
import { OFFER_CATEGORIES } from '@gemone/contracts';

import { __testing } from './offers.service';
import type { MappedOffer } from './internal/offer-normalizer';

const { clampLimit, toColumns, DEFAULT_LIMIT, MAX_LIMIT } = __testing;

describe('offer storage helpers', () => {
  describe('clampLimit', () => {
    it('defaults, floors and caps', () => {
      expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(10_000)).toBe(MAX_LIMIT);
      expect(clampLimit(75)).toBe(75);
    });
  });

  describe('toColumns', () => {
    const mapped: MappedOffer = {
      externalId: 'X-1',
      title: 'Title',
      description: null,
      requirements: null,
      payoutAmountMinor: 245,
      payoutCurrency: 'USD',
      rewardPoints: 171,
      category: OFFER_CATEGORIES.GAME,
      providerCategories: ['mobile_game'],
      countries: ['US'],
      devices: ['mobile'],
      imageUrl: null,
      trackingUrlTemplate: 'https://track.example.test/c?s1={sub_id}',
      isMultiStep: true,
    };

    it('carries every mapped field through to the row', () => {
      expect(toColumns(mapped)).toEqual(mapped);
    });

    it('writes no activation or timestamp fields', () => {
      const columns = toColumns(mapped) as Record<string, unknown>;

      /*
       * The reason this helper exists at all: create and update share it, so
       * the two cannot drift into writing different sets of columns. It must
       * NOT carry `isActive`, `deactivationSource` or `lastSeenAt` — those are
       * decided per path, because an update has to leave an admin's
       * deactivation alone while a create never can have one.
       */
      expect(columns.isActive).toBeUndefined();
      expect(columns.deactivationSource).toBeUndefined();
      expect(columns.lastSeenAt).toBeUndefined();
    });
  });
});
