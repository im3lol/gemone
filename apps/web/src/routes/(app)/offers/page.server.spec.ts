import type { OfferCategory, WallOfferSort } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { __testing } from './+page.server';

const { readCategory, readSort, readOffset } = __testing;

/**
 * All three read a query string, which is to say all three read whatever a
 * visitor typed into the address bar. What they hand back goes into a call to
 * the API — and `GET /offers` answers an unknown enum with a 422, which would
 * surface as the wall's error state. A filter nobody chose must not break a
 * page that works.
 */

describe('readCategory', () => {
  it('accepts a category the wall knows about', () => {
    expect(readCategory('SURVEY')).toBe('SURVEY');
    expect(readCategory('APP_INSTALL')).toBe('APP_INSTALL');
  });

  it('treats a missing filter as "everything"', () => {
    expect(readCategory(null)).toBe('');
    expect(readCategory('')).toBe('');
  });

  it('drops anything else rather than forwarding it', () => {
    expect(readCategory('survey')).toBe('');
    expect(readCategory('DROP TABLE offers')).toBe('');
    expect(readCategory('CRYPTO' as OfferCategory)).toBe('');
  });
});

describe('readSort', () => {
  it('accepts the orderings the contract has', () => {
    expect(readSort('reward_desc')).toBe('reward_desc');
    expect(readSort('newest')).toBe('newest');
  });

  it('falls back to the API default rather than 422-ing the wall', () => {
    expect(readSort(null)).toBe('');
    expect(readSort('by_vibes' as WallOfferSort)).toBe('');
    expect(readSort('REWARD_DESC')).toBe('');
  });
});

describe('readOffset', () => {
  it('reads a page offset', () => {
    expect(readOffset('24')).toBe(24);
  });

  it('is page one for anything unusable', () => {
    // `?offset=abc` reached the old page as NaN and rendered "NaN–NaN of 2".
    expect(readOffset(null)).toBe(0);
    expect(readOffset('abc')).toBe(0);
    expect(readOffset('-12')).toBe(0);
  });

  it('floors a fractional offset instead of passing it on', () => {
    expect(readOffset('12.9')).toBe(12);
  });
});
