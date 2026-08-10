import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../core/errors/app-error';
import { __testing } from './reward-accounting.service';

const { requirePositive, clampLimit, toBalance } = __testing;

describe('requirePositive', () => {
  it('accepts a positive integer', () => {
    expect(requirePositive(171)).toBe(171);
  });

  it.each([
    ['zero', 0],
    ['a negative amount', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s', (_label, amount) => {
    /*
     * The *direction* is the operation's job, not the caller's. A
     * `credit(-100)` that quietly debited would be a bug invisible at the call
     * site, and a fractional point is not a thing that exists (DATABASE.md §5)
     * — every points calculation in the system is integer arithmetic end to
     * end precisely so that no rounding decision is ever made implicitly.
     */
    expect(() => requirePositive(amount)).toThrow(ValidationError);
  });
});

describe('toBalance', () => {
  it('exposes three buckets and their total', () => {
    const balance = toBalance({
      pendingPoints: 100,
      availablePoints: 250,
      lockedPoints: 50,
      lifetimeEarnedPoints: 400,
      lifetimeWithdrawnPoints: 0,
      lifetimeReversedPoints: 0,
    } as never);

    expect(balance.pending).toBe(100);
    expect(balance.available).toBe(250);
    expect(balance.locked).toBe(50);
    expect(balance.total).toBe(400);
  });

  it('reads a missing row as a balance of nothing, not as an error', () => {
    /*
     * The row is created with the user, so this should not happen. If it does,
     * a user with no balance has a balance of zero — turning that into a
     * thrown error would break the profile page rather than describe it.
     */
    const balance = toBalance(null);

    expect(balance).toMatchObject({ pending: 0, available: 0, locked: 0, total: 0 });
  });

  it('never presents the balance as a single spendable number', () => {
    // `total` includes points inside their hold period and points reserved for
    // an in-flight payout. A client showing it as "your balance" tells a user
    // they can withdraw money they cannot — the most common way an offerwall
    // creates a support ticket (§9.2).
    const balance = toBalance({
      pendingPoints: 500,
      availablePoints: 0,
      lockedPoints: 0,
      lifetimeEarnedPoints: 500,
      lifetimeWithdrawnPoints: 0,
      lifetimeReversedPoints: 0,
    } as never);

    expect(balance.total).toBe(500);
    expect(balance.available).toBe(0);
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(100);
    expect(clampLimit(40)).toBe(40);
  });
});
