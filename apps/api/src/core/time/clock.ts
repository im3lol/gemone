/**
 * The source of "now".
 *
 * Injected rather than read from the global `Date` because time is the input
 * that makes expiry, rotation and — shortly — reward hold periods testable.
 * Verifying that a token expires after 30 days, or that points mature exactly
 * when their stored maturity timestamp says, must not require a test that
 * waits 30 days or one that mutates global state.
 *
 * The lint rule forbidding bare `new Date()` (eslint.config.mjs) exists to
 * keep this the only way to ask.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;

  /** The current instant in epoch milliseconds. */
  nowMs(): number;
}

export const CLOCK = Symbol('CLOCK');

/**
 * The production implementation, and the one place in the codebase permitted
 * to read the wall clock.
 */
export class SystemClock implements Clock {
  now(): Date {
    // The single sanctioned read of the system clock in the whole codebase.
    // Everything else injects Clock, which is what the rule enforces.
    // eslint-disable-next-line no-restricted-syntax
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}

/**
 * A controllable clock for tests.
 *
 * Lives beside the interface rather than in a test helper so that every test
 * uses the same one — a per-test fake clock is how two tests end up disagreeing
 * about what "expired" means.
 */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowMs(): number {
    return this.current.getTime();
  }

  /** Moves time forward. */
  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  set(instant: Date): void {
    this.current = new Date(instant.getTime());
  }
}
