import { describe, expect, it } from 'vitest';

import { FixedClock, SystemClock } from './clock';

describe('SystemClock', () => {
  it('reports the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('agrees with itself across both accessors', () => {
    const clock = new SystemClock();

    expect(Math.abs(clock.now().getTime() - clock.nowMs())).toBeLessThan(50);
  });
});

describe('FixedClock', () => {
  const instant = new Date('2026-06-15T12:00:00.000Z');

  it('does not move on its own', () => {
    const clock = new FixedClock(instant);

    expect(clock.now().toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });

  it('advances only when told to', () => {
    const clock = new FixedClock(instant);

    clock.advance(60_000);

    expect(clock.now().toISOString()).toBe('2026-06-15T12:01:00.000Z');
  });

  it('can jump to an arbitrary instant', () => {
    const clock = new FixedClock(instant);

    clock.set(new Date('2027-01-01T00:00:00.000Z'));

    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('hands out copies, so a caller cannot mutate the clock', () => {
    const clock = new FixedClock(instant);

    const handed = clock.now();
    handed.setFullYear(1999);

    // Returning the internal Date would let one test's mutation silently
    // change what "now" means for everything afterwards.
    expect(clock.now().toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });

  it('keeps both accessors consistent', () => {
    const clock = new FixedClock(instant);

    expect(clock.nowMs()).toBe(clock.now().getTime());

    clock.advance(1_000);
    expect(clock.nowMs()).toBe(clock.now().getTime());
  });

  it('supports the expiry arithmetic tokens rely on', () => {
    const clock = new FixedClock(instant);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(clock.nowMs() + thirtyDays);

    expect(expiresAt.getTime()).toBeGreaterThan(clock.nowMs());

    clock.advance(thirtyDays + 1);

    // The check TokenService.rotate performs.
    expect(expiresAt.getTime() <= clock.nowMs()).toBe(true);
  });
});
