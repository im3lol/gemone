import { describe, expect, it } from 'vitest';

import { __testing } from './+page.server';

const { readUserId, readOffset } = __testing;

/**
 * Both read a query string, which is to say both read whatever is in the
 * address bar, and what they hand back goes into a call to the admin API.
 */

describe('readUserId', () => {
  const ID = '0198f2c1-4a0e-7c3a-9f2b-5d6e7a8b9c0d';

  it('narrows the queue to one account', () => {
    expect(readUserId(ID)).toBe(ID);
    expect(readUserId(ID.toUpperCase())).toBe(ID.toUpperCase());
  });

  it('treats a missing filter as every account', () => {
    expect(readUserId(null)).toBe('');
    expect(readUserId('')).toBe('');
  });

  it('drops anything that is not a uuid', () => {
    /*
     * `AdminListHeldConversionsDto` accepts any string up to 36 characters, so
     * a non-uuid reaches the query and the database rejects it — a 500 on the
     * review queue because somebody edited the address bar. The filter is only
     * ever set from a link on the page, so anything else is a typo.
     */
    expect(readUserId('not-a-uuid')).toBe('');
    expect(readUserId("' OR 1=1 --")).toBe('');
    expect(readUserId(`${ID}x`)).toBe('');
    expect(readUserId(ID.replace(/-/g, ''))).toBe('');
  });
});

describe('readOffset', () => {
  it('reads a page offset', () => {
    expect(readOffset('20')).toBe(20);
  });

  it('is page one for anything unusable', () => {
    // `skip: NaN` is a query the database rejects.
    expect(readOffset(null)).toBe(0);
    expect(readOffset('not-a-number')).toBe(0);
    expect(readOffset('-10')).toBe(0);
    expect(readOffset('20.7')).toBe(20);
  });
});
