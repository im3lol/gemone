import type { PayoutStatus } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  PAYOUT_STATUSES_IN_QUEUE_ORDER,
  accountReference,
  actionsFor,
  payoutReference,
  queueState,
} from './payout-queue';

/**
 * The table under test mirrors `payout-state-machine.ts`. These assertions are
 * written against that file's own edges, so a change there that is not made
 * here fails a test rather than shipping a button the API will refuse.
 */

describe('queueState', () => {
  it('covers every status the contract has', () => {
    expect(PAYOUT_STATUSES_IN_QUEUE_ORDER).toEqual([
      'PENDING_REVIEW',
      'APPROVED',
      'PAID',
      'REJECTED',
      'FAILED',
    ]);

    for (const status of PAYOUT_STATUSES_IN_QUEUE_ORDER) {
      expect(queueState(status).label, status).toBeTruthy();
      expect(queueState(status).hint, status).toBeTruthy();
    }
  });

  it('uses the machine’s vocabulary, not the user-facing one', () => {
    // `$lib/payouts/payout.ts` calls this state "Being paid" because a user
    // reading "Approved" goes looking for money nobody has sent. The admin is
    // the person who has not sent it.
    expect(queueState('APPROVED').label).toBe('Approved');
    expect(queueState('APPROVED').hint).toMatch(/not yet sent/);
  });

  it('says where the points went for both releases', () => {
    for (const status of ['REJECTED', 'FAILED'] as PayoutStatus[]) {
      expect(queueState(status).hint, status).toMatch(/back to the account/);
    }
  });

  it('never renders undefined for a status this build has not heard of', () => {
    expect(queueState('SETTLING' as PayoutStatus).label).toBe('Recorded');
  });
});

describe('actionsFor', () => {
  it('offers exactly the edges the server permits', () => {
    // PAYOUT_TRANSITIONS: PENDING_REVIEW -> APPROVED | REJECTED
    expect(actionsFor('PENDING_REVIEW').map((a) => a.action)).toEqual(['approve', 'reject']);

    // APPROVED -> PAID | FAILED. Two steps, because the payment happens
    // between them.
    expect(actionsFor('APPROVED').map((a) => a.action)).toEqual(['settle', 'fail']);
  });

  it('offers nothing from a terminal state', () => {
    for (const status of ['PAID', 'REJECTED', 'FAILED'] as PayoutStatus[]) {
      expect(actionsFor(status), status).toEqual([]);
    }
  });

  it('demands a reason everywhere one is mandatory, and not on approval', () => {
    const approve = actionsFor('PENDING_REVIEW').find((a) => a.action === 'approve');
    expect(approve?.field?.label).toMatch(/optional/i);

    const reject = actionsFor('PENDING_REVIEW').find((a) => a.action === 'reject');
    expect(reject?.field?.name).toBe('reason');
    expect(reject?.field?.label).not.toMatch(/optional/i);

    const fail = actionsFor('APPROVED').find((a) => a.action === 'fail');
    expect(fail?.field?.name).toBe('reason');
  });

  it('asks for the reference on the one transition that records a payment', () => {
    const settle = actionsFor('APPROVED').find((a) => a.action === 'settle');

    expect(settle?.field?.name).toBe('externalReference');
    expect(settle?.variant).toBe('primary');
  });

  it('never makes refusing the primary action', () => {
    for (const status of PAYOUT_STATUSES_IN_QUEUE_ORDER) {
      for (const action of actionsFor(status)) {
        if (action.action === 'reject' || action.action === 'fail') {
          expect(action.variant, action.action).not.toBe('primary');
        }
      }
    }
  });
});

describe('references', () => {
  it('takes the distinguishing end of a UUIDv7, not the timestamp end', () => {
    expect(payoutReference('019ff2b1-508f-715c-b700-3f444642e60a')).toBe('4642E60A');
    expect(accountReference('019ff2b1-508f-715c-b700-3f444642e60a')).toBe('4642E60A');
  });

  it('distinguishes two ids created in the same second', () => {
    expect(payoutReference('019ff2b1-508f-715c-b700-aaaaaaaa1111')).not.toBe(
      payoutReference('019ff2b1-508f-715c-b700-aaaaaaaa2222'),
    );
  });
});
