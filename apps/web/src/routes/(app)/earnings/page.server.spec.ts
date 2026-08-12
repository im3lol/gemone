import { describe, expect, it } from 'vitest';
import { REWARD_STATUSES } from '@gemone/contracts';

import { __testing } from './+page.server';

const { readType, readStatus, readOffset, pageQuery } = __testing;

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

/**
 * The status filter — TODO T80.
 *
 * The parameter is forwarded to `GET /rewards/history`, which filters *and*
 * counts on it, so what these functions let through decides both the rows and
 * the "1–20 of n" underneath them.
 */
describe('readStatus', () => {
  it.each(Object.values(REWARD_STATUSES))('accepts %s', (status) => {
    expect(readStatus(status)).toBe(status);
  });

  it('treats a missing status as "any"', () => {
    expect(readStatus(null)).toBe('');
    expect(readStatus('')).toBe('');
  });

  it('drops anything else rather than forwarding it', () => {
    // `RewardHistoryDto` answers an unknown status with a 400, and that is the
    // control. This is about what the *user* sees: a stale bookmark should
    // show them their statement, not an error panel about a word they did not
    // type. Case matters — the API's enum is upper-case.
    expect(readStatus('pending')).toBe('');
    expect(readStatus('SOMETHING_NEW')).toBe('');
    expect(readStatus("' OR 1=1 --")).toBe('');
  });
});

describe('pageQuery', () => {
  it('carries both filters, so the pager keeps them', () => {
    expect(pageQuery({ type: 'CONVERSION_CREDIT', status: 'PENDING' })).toBe(
      '?type=CONVERSION_CREDIT&status=PENDING',
    );
  });

  it('carries one filter alone', () => {
    expect(pageQuery({ type: '', status: 'PAID' })).toBe('?status=PAID');
    expect(pageQuery({ type: 'BONUS', status: '' })).toBe('?type=BONUS');
  });

  it('is empty when nothing is filtered', () => {
    expect(pageQuery({ type: '', status: '' })).toBe('');
  });

  it('never carries an offset, so changing a filter lands on page one', () => {
    // Page 3 of the old result set is not page 3 of the new one — it is
    // usually past the end, which renders an empty page that reads as "there
    // is nothing here". The pager adds the offset to these links itself.
    expect(pageQuery({ type: 'BONUS', status: 'PENDING' })).not.toContain('offset');
  });

  it('drops a rejected filter instead of carrying it onto page two', () => {
    // The page rebuilds this from what `readStatus` allowed, not from
    // `url.search`. A pager copying the raw query would put `?status=nonsense`
    // on every link, where it would be dropped again on arrival.
    expect(pageQuery({ type: readType('nope'), status: readStatus('nonsense') })).toBe('');
  });
});
