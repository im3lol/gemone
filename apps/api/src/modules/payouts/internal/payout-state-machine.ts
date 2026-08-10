import { ERROR_CODES, PAYOUT_STATUSES, type PayoutStatus } from '@gemone/contracts';

import { DomainError } from '../../../core/errors/app-error';

/**
 * The withdrawal state machine — ARCHITECTURE.md §11.1.
 *
 * "Transitions are explicit and total: every state names its permitted next
 * states, and anything else is rejected."
 *
 * Written as data rather than as a chain of `if`s, and kept pure. This is the
 * part of the payout system where being wrong means money moves twice or not
 * at all, so it is exercisable without a database, a user, or an admin.
 */
export const PAYOUT_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  [PAYOUT_STATUSES.PENDING_REVIEW]: [PAYOUT_STATUSES.APPROVED, PAYOUT_STATUSES.REJECTED],

  /*
   * Approval and settlement are two steps because the external payment happens
   * between them (§11.3). `APPROVED` is therefore the only non-terminal state
   * in which money is neither reserved-and-waiting nor resolved — it is the
   * state an admin is standing in front of their banking app in.
   */
  [PAYOUT_STATUSES.APPROVED]: [PAYOUT_STATUSES.PAID, PAYOUT_STATUSES.FAILED],

  [PAYOUT_STATUSES.PAID]: [],
  [PAYOUT_STATUSES.REJECTED]: [],

  /*
   * Terminal, which §11.1 does not say in so many words — it names `PAID` and
   * `REJECTED` and leaves `FAILED` unstated.
   *
   * It has to be. `FAILED` releases the lock, so the points are back in the
   * user's available balance and may already have been spent. A transition out
   * of here would have to re-lock, which can fail, and a state machine with a
   * transition that can fail for reasons outside the machine is not one.
   * Retrying a failed payment is a new request with a new lock (DECISIONS.md
   * D41).
   */
  [PAYOUT_STATUSES.FAILED]: [],
};

/**
 * What a transition does to the points this request reserved.
 *
 * Every transition either leaves the lock alone, consumes it, or returns it —
 * and across any path from submission to a terminal state, **exactly one**
 * settle or release happens. That property is asserted directly in the tests,
 * because it is the difference between a user being paid twice and not at all.
 */
export type LockEffect = 'none' | 'settle' | 'release';

export function lockEffectOf(from: PayoutStatus, to: PayoutStatus): LockEffect {
  // Approval moves no money. It is a decision, recorded, and the reason the
  // lock survives it is that the payment has not happened yet.
  if (from === PAYOUT_STATUSES.PENDING_REVIEW && to === PAYOUT_STATUSES.APPROVED) {
    return 'none';
  }

  // The money actually left. The reserved points are consumed.
  if (to === PAYOUT_STATUSES.PAID) return 'settle';

  // Refused, or the payment did not go through. Either way the user gets their
  // points back — a payout that cannot happen must not strand them.
  if (to === PAYOUT_STATUSES.REJECTED || to === PAYOUT_STATUSES.FAILED) return 'release';

  return 'none';
}

export function canTransition(from: PayoutStatus, to: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[status].length === 0;
}

/**
 * Refuses anything the machine does not permit.
 *
 * A `DomainError`, not a validation error: the request is well-formed and the
 * rules forbid it, which is precisely the distinction §15.1 draws. It is also
 * the guard against the double-click that would otherwise approve a request
 * twice — and settling one lock twice is money leaving twice.
 */
export function assertTransition(
  from: PayoutStatus,
  to: PayoutStatus,
  payoutId: string,
): void {
  if (canTransition(from, to)) return;

  throw new DomainError(
    ERROR_CODES.PAYOUT_INVALID_TRANSITION,
    isTerminal(from)
      ? `This payout is already ${from.toLowerCase()} and cannot change`
      : `A payout cannot go from ${from} to ${to}`,
    409,
    { payoutId, from, to, permitted: PAYOUT_TRANSITIONS[from] },
  );
}
