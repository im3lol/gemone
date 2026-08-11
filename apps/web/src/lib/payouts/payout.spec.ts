import type { PayoutStatus } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  approxCash,
  cashMinorFor,
  formatCash,
  methodName,
  payoutReference,
  payoutState,
} from './payout';

/** Every status the contract has. Written out for the reason `payout.ts` gives. */
const ALL_STATUSES: PayoutStatus[] = [
  'PENDING_REVIEW',
  'APPROVED',
  'PAID',
  'REJECTED',
  'FAILED',
];

describe('payoutState', () => {
  it('gives every contract status a label, a tone and a hint', () => {
    for (const status of ALL_STATUSES) {
      const state = payoutState(status);

      expect(state.label, status).toBeTruthy();
      expect(state.hint, status).toBeTruthy();
      expect(['success', 'warning', 'error', 'info', 'neutral']).toContain(state.tone);
    }
  });

  it('does not tell a user an approved payout has been sent', () => {
    // Approval and settlement are two steps with an external payment between
    // them (§11.1). "Approved" on a user's screen invites them to go looking
    // for money nobody has sent yet.
    const approved = payoutState('APPROVED');

    expect(approved.label).toBe('Being paid');
    expect(approved.label).not.toBe(payoutState('PAID').label);
    expect(approved.hint).toMatch(/still reserved/);
    expect(payoutState('PAID').label).toBe('Paid');
  });

  it('says where the points went for both terminal failures', () => {
    for (const status of ['REJECTED', 'FAILED'] as PayoutStatus[]) {
      expect(payoutState(status).hint, status).toMatch(/back to your available balance/);
      expect(payoutState(status).tone).toBe('error');
    }
  });

  it('never renders undefined for a status this build has not heard of', () => {
    expect(payoutState('SOMETHING_NEW' as PayoutStatus).label).toBe('Recorded');
  });
});

describe('methodName', () => {
  it('spells the known methods the way their owners do', () => {
    expect(methodName('paypal')).toBe('PayPal');
  });

  it('renders a method enabled after this build shipped', () => {
    // P3: enabling a payment method is one configuration edit and no
    // deployment. A slug this map has never seen still has to look like a name.
    expect(methodName('skrill')).toBe('Skrill');
    expect(methodName('bank_transfer')).toBe('Bank Transfer');
  });
});

describe('cashMinorFor', () => {
  it('converts at the configured rate', () => {
    expect(cashMinorFor(5000, 1000)).toBe(500);
    expect(cashMinorFor(8000, 400)).toBe(2000);
  });

  it('rounds down, exactly as the API does', () => {
    // `toCashMinor` in payouts.service.ts floors. Rounding up here would quote
    // a figure a cent above what the request is actually worth.
    expect(cashMinorFor(1005, 1000)).toBe(100);
    expect(cashMinorFor(999, 1000)).toBe(99);
  });

  it('is zero for anything that is not a usable amount', () => {
    // The amount comes from a number input that is empty until someone types.
    expect(cashMinorFor(Number.NaN, 1000)).toBe(0);
    expect(cashMinorFor(0, 1000)).toBe(0);
    expect(cashMinorFor(-500, 1000)).toBe(0);
    expect(cashMinorFor(5000, 0)).toBe(0);
  });
});

describe('formatCash', () => {
  it('formats minor units as money', () => {
    expect(formatCash(500, 'USD')).toBe('$5.00');
    expect(formatCash(0, 'USD')).toBe('$0.00');
  });

  it('keeps two decimals on a round amount', () => {
    expect(formatCash(2000, 'USD')).toBe('$20.00');
  });

  it('still prints an amount for a currency Intl refuses', () => {
    // The code comes from configuration an admin types. A blank withdrawal
    // screen is a worse answer than an amount with its code beside it.
    expect(formatCash(500, 'NOT-A-CODE')).toBe('5.00 NOT-A-CODE');
  });

  it('marks the preview as an approximation', () => {
    expect(approxCash(5000, 1000, 'USD')).toBe('≈ $5.00');
  });
});

describe('payoutReference', () => {
  it('takes the distinguishing end of the id, not the timestamp end', () => {
    // UUIDv7 leads with a timestamp: two requests a second apart share it.
    const a = payoutReference('01997a5c-1e00-7000-8000-aaaaaaaa1111');
    const b = payoutReference('01997a5c-1e00-7000-8000-aaaaaaaa2222');

    expect(a).toBe('AAAA1111');
    expect(b).toBe('AAAA2222');
    expect(a).not.toBe(b);
  });
});
