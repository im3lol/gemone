import type { PayoutStatus } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { __testing } from './+page.server';

const { readStatus, readOffset } = __testing;

const params = (search: string) => new URLSearchParams(search);

/**
 * Both read a query string, which is to say both read whatever an admin typed
 * into the address bar or clicked from a bookmark. What they hand back goes
 * into a call to the API, and `GET /admin/payouts` answers an unknown enum
 * with a 422 — which would turn the whole queue into an error state over a
 * mistyped URL.
 */

describe('readStatus', () => {
  it('defaults to the queue rather than to everything', () => {
    // The API orders `PENDING_REVIEW` oldest-first and everything else
    // newest-first, so this default is also the only one that is worked in the
    // order people joined it.
    expect(readStatus(params(''))).toBe('PENDING_REVIEW');
  });

  it('treats a present but empty status as "all"', () => {
    // The difference between absent and empty is what lets the All tab be a
    // link the Back button can return from.
    expect(readStatus(params('status='))).toBe('');
  });

  it('accepts every status the contract has', () => {
    for (const status of ['PENDING_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'FAILED'] as PayoutStatus[]) {
      expect(readStatus(params(`status=${status}`)), status).toBe(status);
    }
  });

  it('falls back to the queue for anything else', () => {
    expect(readStatus(params('status=pending_review'))).toBe('PENDING_REVIEW');
    expect(readStatus(params('status=SETTLING'))).toBe('PENDING_REVIEW');
    expect(readStatus(params('status=DROP TABLE payout_requests'))).toBe('PENDING_REVIEW');
  });
});

describe('readOffset', () => {
  it('reads a page offset', () => {
    expect(readOffset('50')).toBe(50);
  });

  it('is page one for anything unusable', () => {
    expect(readOffset(null)).toBe(0);
    expect(readOffset('abc')).toBe(0);
    expect(readOffset('-25')).toBe(0);
  });

  it('floors a fractional offset instead of passing it on', () => {
    expect(readOffset('25.8')).toBe(25);
  });
});
