import { CONVERSION_STATUSES } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../core/errors/app-error';
import { __testing } from './conversions.service';
import type { NormalizedConversion } from '../providers/contracts/normalized';

const { resolveStatus, isUniqueViolation, describeFailure, clampLimit } = __testing;

function parsed(overrides: Partial<NormalizedConversion> = {}): NormalizedConversion {
  return {
    subId: 'token.signature',
    externalTransactionId: 'TX-1',
    payoutAmountMinor: 245,
    payoutCurrency: 'USD',
    status: 'confirmed',
    isReversal: false,
    externalOfferId: 'CMP-1',
    occurredAt: null,
    ...overrides,
  };
}

/**
 * The status decision — ARCHITECTURE.md §10.3, steps 3 and 6.
 *
 * Two inputs, one column: what the provider reported, and whether the account
 * is in a state that may be paid. Everything about which of the two wins is
 * decided here, so it is tested here rather than through a database.
 */
describe('resolveStatus', () => {
  it('attributes a confirmed conversion for an active account', () => {
    expect(resolveStatus(parsed(), true, null, null)).toEqual({
      status: CONVERSION_STATUSES.ATTRIBUTED,
      reviewReason: null,
    });
  });

  it('holds a confirmed conversion for an account that is not active', () => {
    const result = resolveStatus(parsed(), false, null, null);

    /*
     * §10.3 step 3. Held, not refused: a false positive that refuses a
     * legitimate conversion produces an angry user and no recoverable record,
     * while one that holds it produces a delay an admin can clear. Both are
     * wrong; only one is recoverable.
     */
    expect(result.status).toBe(CONVERSION_STATUSES.HELD);
    expect(result.reviewReason).toContain('not active');
  });

  it('keeps a provider-pending conversion pending, whatever the account is', () => {
    // Some networks report an install the moment it happens and confirm it
    // days later. Nothing may be credited for one.
    expect(resolveStatus(parsed({ status: 'pending' }), true, null, null).status).toBe(
      CONVERSION_STATUSES.PENDING,
    );
    expect(resolveStatus(parsed({ status: 'pending' }), false, null, null).status).toBe(
      CONVERSION_STATUSES.PENDING,
    );
  });

  it('records the provider having rejected it, and does not hold it for review', () => {
    const result = resolveStatus(parsed({ status: 'rejected' }), true, null, null);

    // The provider refused it, so there is no decision for an admin to make.
    // Holding it would put someone else's call in front of them.
    expect(result.status).toBe(CONVERSION_STATUSES.REJECTED);
    expect(result.reviewReason).toContain('rejected');
  });

  it('lets the provider decide before the account check', () => {
    /*
     * A rejected conversion for a banned user is REJECTED, not HELD. Order
     * matters: reviewing something the provider already refused wastes the one
     * resource the review queue is short of, which is attention.
     */
    expect(resolveStatus(parsed({ status: 'rejected' }), false, null, null).status).toBe(
      CONVERSION_STATUSES.REJECTED,
    );
  });
});

describe('recognising the conversion-level constraint firing', () => {
  it('recognises Prisma P2002', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
  });

  it.each([
    ['a connection failure', { code: 'P1001' }],
    ['a plain error', new Error('boom')],
    ['null', null],
  ])('does not mistake %s for a duplicate', (_label, error) => {
    // A broad catch here would report "already processed" while the database
    // was down — and the postback would sit unprocessed with nobody looking.
    expect(isUniqueViolation(error)).toBe(false);
  });
});

describe('describeFailure', () => {
  it('reports the error code, not the class name', () => {
    // A class name in `error_detail` tells an admin which TypeScript file
    // threw. The code tells them what happened.
    const detail = describeFailure(
      new DomainError('PROVIDER_DISABLED' as never, 'Provider is disabled'),
    );

    expect(detail).toBe('PROVIDER_DISABLED: Provider is disabled');
  });

  it('flattens and bounds an ordinary error', () => {
    expect(describeFailure(new Error('line one\n  line two'))).toBe('line one line two');
    expect(describeFailure(new Error('x'.repeat(5000)))).toHaveLength(500);
  });

  it('handles a thrown non-error', () => {
    expect(describeFailure('just a string')).toBe('just a string');
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(100);
  });
});

/**
 * Which conversions move points — ARCHITECTURE.md §10.3, step 6.
 *
 * The reversal case here is a bug this codebase actually shipped for the
 * length of one test run: a chargeback's own conversion is `ATTRIBUTED`, so a
 * plan that read only the status credited it *and* reversed the original,
 * leaving the user holding exactly the points the chargeback existed to remove.
 */
describe('planCredit', () => {
  const { planCredit } = __testing;

  it('credits an attributed conversion, maturing normally', () => {
    expect(planCredit(CONVERSION_STATUSES.ATTRIBUTED, 171, false)).toMatchObject({
      credits: true,
      holdIndefinitely: false,
    });
  });

  it('credits a held conversion but never lets it mature', () => {
    // §10.3 step 7: the points exist and are visible as pending, and no clock
    // will make them withdrawable.
    expect(planCredit(CONVERSION_STATUSES.HELD, 171, false)).toMatchObject({
      credits: true,
      holdIndefinitely: true,
    });
  });

  it.each([
    [CONVERSION_STATUSES.PENDING],
    [CONVERSION_STATUSES.REJECTED],
    [CONVERSION_STATUSES.REVERSED],
  ])('credits nothing for %s', (status) => {
    expect(planCredit(status, 171, false).credits).toBe(false);
  });

  it('never credits a reversal, whatever its own status says', () => {
    /*
     * The regression. A chargeback takes points back; it never grants any —
     * and its status is `ATTRIBUTED` precisely because it *was* matched and
     * priced, which is what made the status-only reading look correct.
     */
    expect(planCredit(CONVERSION_STATUSES.ATTRIBUTED, 171, true).credits).toBe(false);
    expect(planCredit(CONVERSION_STATUSES.HELD, 171, true).credits).toBe(false);
  });

  it('credits nothing worth nothing', () => {
    // A zero-point movement is a line on a statement saying nothing happened.
    expect(planCredit(CONVERSION_STATUSES.ATTRIBUTED, 0, false).credits).toBe(false);
  });
});
