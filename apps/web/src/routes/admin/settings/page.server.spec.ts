import { describe, expect, it } from 'vitest';

import { __testing } from './+page.server';

const { readSearch, SEARCH_MAX } = __testing;

describe('readSearch', () => {
  it('keeps a fragment, because the API matches on one', () => {
    expect(readSearch('payouts')).toBe('payouts');
    expect(readSearch('hold_period')).toBe('hold_period');
  });

  it('trims, so a pasted key with a trailing space still matches', () => {
    expect(readSearch('  rewards.  ')).toBe('rewards.');
  });

  it('bounds the fragment at the length the DTO accepts', () => {
    // Longer would be a 422 that reads as a broken page, over a paste.
    expect(readSearch('a'.repeat(400))).toHaveLength(SEARCH_MAX);
  });

  it('is empty when nothing was typed', () => {
    expect(readSearch(null)).toBe('');
    expect(readSearch('   ')).toBe('');
  });
});
