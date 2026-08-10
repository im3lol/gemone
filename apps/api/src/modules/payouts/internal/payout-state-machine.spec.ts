import { ERROR_CODES, PAYOUT_STATUSES, type PayoutStatus } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  PAYOUT_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
  lockEffectOf,
} from './payout-state-machine';

const ALL_STATUSES = Object.values(PAYOUT_STATUSES);

/**
 * The withdrawal state machine — ARCHITECTURE.md §11.1.
 *
 * Tested exhaustively rather than by example. There are five states and
 * twenty-five ordered pairs, so "every transition the design permits, and no
 * others" is a claim that can be checked completely — and on the one part of
 * the system where being wrong means money moves twice or not at all, checking
 * it completely costs nothing.
 */
describe('permitted transitions', () => {
  it.each([
    [PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.APPROVED],
    [PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.REJECTED],
    [PAYOUT_STATUSES.APPROVED, PAYOUT_STATUSES.PAID],
    [PAYOUT_STATUSES.APPROVED, PAYOUT_STATUSES.FAILED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('allows exactly those four and nothing else', () => {
    /*
     * The exhaustive half. §11.1: "Transitions are explicit and total: every
     * state names its permitted next states, **and anything else is
     * rejected**." A test that only checked the four permitted edges would
     * pass against a machine that permitted all twenty-five.
     */
    const permitted = ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}->${to}`),
    );

    expect(permitted.sort()).toEqual([
      'APPROVED->FAILED',
      'APPROVED->PAID',
      'PENDING_REVIEW->APPROVED',
      'PENDING_REVIEW->REJECTED',
    ]);
  });

  it('never allows a state to transition to itself', () => {
    // Self-transitions are how a double-clicked approve settles a lock twice.
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('never allows a terminal state to move', () => {
    for (const status of [
      PAYOUT_STATUSES.PAID,
      PAYOUT_STATUSES.REJECTED,
      PAYOUT_STATUSES.FAILED,
    ]) {
      expect(isTerminal(status)).toBe(true);
      expect(PAYOUT_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('does not let a request skip review and go straight to paid', () => {
    /*
     * The transition that would pay money nobody approved. Worth naming
     * separately from the exhaustive check, because it is the one an
     * "obvious" shortcut in a controller would introduce.
     */
    expect(canTransition(PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.PAID)).toBe(false);
  });

  it('does not let a rejected request be revived', () => {
    // Its lock was released and the points may already be spent.
    for (const to of ALL_STATUSES) {
      expect(canTransition(PAYOUT_STATUSES.REJECTED, to)).toBe(false);
      expect(canTransition(PAYOUT_STATUSES.FAILED, to)).toBe(false);
    }
  });
});

describe('what a transition does to the lock', () => {
  it('leaves the lock alone on approval', () => {
    // Approval is a decision, recorded. The payment has not happened, so the
    // points stay reserved (§11.3).
    expect(lockEffectOf(PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.APPROVED)).toBe(
      'none',
    );
  });

  it('settles the lock only when the money actually left', () => {
    expect(lockEffectOf(PAYOUT_STATUSES.APPROVED, PAYOUT_STATUSES.PAID)).toBe('settle');
  });

  it.each([
    [PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.REJECTED],
    [PAYOUT_STATUSES.APPROVED, PAYOUT_STATUSES.FAILED],
  ])('returns the points on %s → %s', (from, to) => {
    // A payout that cannot happen must not strand a user's points.
    expect(lockEffectOf(from, to)).toBe('release');
  });

  it('resolves the lock exactly once on every path to a terminal state', () => {
    /*
     * **The invariant the whole feature rests on.**
     *
     * Walk every path from submission to a terminal state and count the settles
     * and releases. Exactly one, always. More than one is money moving twice;
     * none is a user's points stranded in `locked` with nothing to release
     * them.
     */
    const paths = walkAllPaths(PAYOUT_STATUSES.PENDING_REVIEW);

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const resolutions = path.edges.filter(
        ({ from, to }) => lockEffectOf(from, to) !== 'none',
      );

      expect(
        resolutions,
        `path ${path.states.join(' → ')} resolved the lock ${resolutions.length} times`,
      ).toHaveLength(1);
    }
  });

  it('covers every terminal state with a path', () => {
    // Guards the walk above: an invariant proven over zero or two of the three
    // endings is not proven.
    const endings = new Set(walkAllPaths(PAYOUT_STATUSES.PENDING_REVIEW).map((p) => p.end));

    expect([...endings].sort()).toEqual(['FAILED', 'PAID', 'REJECTED']);
  });
});

describe('assertTransition', () => {
  it('passes a permitted transition silently', () => {
    expect(() =>
      assertTransition(PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.APPROVED, 'p1'),
    ).not.toThrow();
  });

  it('refuses a forbidden one with a domain error', () => {
    /*
     * A `DomainError`, not a validation error: the request is well-formed and
     * the rules forbid it, which is exactly the distinction §15.1 draws. 409,
     * so a client can tell "you cannot do that now" from "you sent nonsense".
     */
    expect(() =>
      assertTransition(PAYOUT_STATUSES.PENDING_REVIEW, PAYOUT_STATUSES.PAID, 'p1'),
    ).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.PAYOUT_INVALID_TRANSITION,
        httpStatus: 409,
      }),
    );
  });

  it('says a request is already finished rather than naming the transition', () => {
    // The message an admin sees when they click approve on a request a
    // colleague just rejected. "Already rejected" is actionable; "cannot go
    // from REJECTED to APPROVED" is a puzzle.
    try {
      assertTransition(PAYOUT_STATUSES.REJECTED, PAYOUT_STATUSES.APPROVED, 'p1');
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as Error).message).toContain('already rejected');
    }
  });

  it('refuses the second of two concurrent approvals', () => {
    // The double-click. The first moves the request to APPROVED; the second
    // reads APPROVED and is refused — which is why the row is re-read under a
    // lock inside the transaction rather than trusted from before it.
    expect(() =>
      assertTransition(PAYOUT_STATUSES.APPROVED, PAYOUT_STATUSES.APPROVED, 'p1'),
    ).toThrow();
  });
});

interface Path {
  states: PayoutStatus[];
  edges: { from: PayoutStatus; to: PayoutStatus }[];
  end: PayoutStatus;
}

/** Every path from a state to a terminal one. The graph is acyclic and tiny. */
function walkAllPaths(start: PayoutStatus): Path[] {
  const paths: Path[] = [];

  const walk = (current: PayoutStatus, path: Path): void => {
    const next = PAYOUT_TRANSITIONS[current];

    if (next.length === 0) {
      paths.push({ ...path, end: current });
      return;
    }

    for (const to of next) {
      walk(to, {
        states: [...path.states, to],
        edges: [...path.edges, { from: current, to }],
        end: to,
      });
    }
  };

  walk(start, { states: [start], edges: [], end: start });

  return paths;
}
