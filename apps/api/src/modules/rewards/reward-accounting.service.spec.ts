import { describe, expect, it } from 'vitest';
import {
  REWARD_STATUSES,
  REWARD_TRANSACTION_TYPES,
  rewardStatusOf,
  type RewardTransactionType,
} from '@gemone/contracts';

import { ValidationError } from '../../core/errors/app-error';
import { __testing } from './reward-accounting.service';

const { requirePositive, clampLimit, toBalance, whereForStatus } = __testing;

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

/**
 * The status filter — TODO T80.
 *
 * The objection T80 raised was that filtering on a derived value duplicates the
 * derivation: once as the rule the UI renders, once as a `where` clause, in two
 * languages that can drift apart. These tests are the answer. They do not check
 * that the clause is *a* clause; they check that it selects exactly the rows
 * `rewardStatusOf` would give that status to, over every combination the
 * contract admits.
 *
 * A drift would have to survive that, and it cannot: both sides read
 * `REWARD_STATUS_RULES` and neither of them contains the list.
 */
describe('whereForStatus', () => {
  /** Applies the emitted clause the way Prisma would, so it can be compared. */
  function matches(clause: ReturnType<typeof whereForStatus>, row: Movement): boolean {
    if (!clause.type.in.includes(row.type)) return false;
    if (clause.pendingDelta?.gt !== undefined && !(row.pendingDelta > clause.pendingDelta.gt)) {
      return false;
    }
    if (clause.pendingDelta?.lte !== undefined && !(row.pendingDelta <= clause.pendingDelta.lte)) {
      return false;
    }

    return true;
  }

  interface Movement {
    type: RewardTransactionType;
    pendingDelta: number;
  }

  /* Every type against a pending credit, a settled one and a debit. */
  const ROWS: Movement[] = Object.values(REWARD_TRANSACTION_TYPES).flatMap((type) =>
    [1200, 0, -1200].map((pendingDelta) => ({ type, pendingDelta })),
  );

  it.each(Object.values(REWARD_STATUSES))(
    'selects exactly the rows %s would be derived for',
    (status) => {
      const clause = whereForStatus(status);

      for (const row of ROWS) {
        expect(matches(clause, row)).toBe(rewardStatusOf(row) === status);
      }
    },
  );

  it('gives every row exactly one status, so the filters partition the ledger', () => {
    for (const row of ROWS) {
      const hits = Object.values(REWARD_STATUSES).filter((status) =>
        matches(whereForStatus(status), row),
      );

      expect(hits).toHaveLength(1);
      expect(hits[0]).toBe(rewardStatusOf(row));
    }
  });

  it('splits credits on the bucket they landed in, which is the point of the axis', () => {
    // One transaction type, two answers: a credit inside its hold period and a
    // credit that cleared it are the same event and different money.
    expect(rewardStatusOf({ type: 'CONVERSION_CREDIT', pendingDelta: 1200 })).toBe('PENDING');
    expect(rewardStatusOf({ type: 'CONVERSION_CREDIT', pendingDelta: 0 })).toBe('AVAILABLE');
  });

  it('has no opinion about a type this build has never heard of', () => {
    // A newer server, a replayed record. `null` is what makes the caller say
    // something about not knowing, instead of printing a confident wrong word.
    expect(rewardStatusOf({ type: 'SOMETHING_NEW' as RewardTransactionType, pendingDelta: 0 })).toBe(
      null,
    );
  });
});
