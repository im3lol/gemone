import { describe, expect, it } from 'vitest';

import { __testing } from './+page.server';

const { readType, readOffset } = __testing;

/**
 * Both of these read a query string, which is to say both read whatever a
 * visitor typed into the address bar. What they hand back goes into a call to
 * the API.
 */

describe('readType', () => {
  it('accepts a transaction type the UI knows about', () => {
    expect(readType('CONVERSION_CREDIT')).toBe('CONVERSION_CREDIT');
    expect(readType('PAYOUT_SETTLE')).toBe('PAYOUT_SETTLE');
  });

  it('treats a missing filter as "everything"', () => {
    expect(readType(null)).toBe('');
    expect(readType('')).toBe('');
  });

  it('drops anything else rather than forwarding it', () => {
    // The API answers an unknown enum with a 400, which would surface as the
    // statement's error state — a filter nobody chose breaking a page that
    // works. Falling back to "everything" is the recoverable answer.
    expect(readType('conversion_credit')).toBe('');
    expect(readType('DROP TABLE reward_transactions')).toBe('');
    expect(readType('SOMETHING_NEW')).toBe('');
  });
});

describe('readOffset', () => {
  it('reads a page offset', () => {
    expect(readOffset('40')).toBe(40);
  });

  it('is page one for anything unusable', () => {
    // `Number('x')` is NaN, and `skip: NaN` is a query the database rejects.
    expect(readOffset(null)).toBe(0);
    expect(readOffset('')).toBe(0);
    expect(readOffset('not-a-number')).toBe(0);
    expect(readOffset('-20')).toBe(0);
  });

  it('floors a fractional offset instead of passing it on', () => {
    expect(readOffset('20.7')).toBe(20);
  });
});
