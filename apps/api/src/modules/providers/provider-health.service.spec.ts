import { describe, expect, it } from 'vitest';
import { PROVIDER_HEALTH_STATES } from '@gemone/contracts';

import { deriveHealthState } from './provider-health.service';

/**
 * The health rule, verified without a database.
 *
 * This is the rule the whole feature exists to express, so it is a pure
 * function rather than something buried in an `update` call — the persistence
 * around it is tested against a real Postgres in the integration suite.
 */
describe('deriveHealthState', () => {
  const degradedAfter = 3;
  const downAfter = 10;

  it.each([
    [0, PROVIDER_HEALTH_STATES.HEALTHY],
    [1, PROVIDER_HEALTH_STATES.HEALTHY],
    [2, PROVIDER_HEALTH_STATES.HEALTHY],
    [3, PROVIDER_HEALTH_STATES.DEGRADED],
    [9, PROVIDER_HEALTH_STATES.DEGRADED],
    [10, PROVIDER_HEALTH_STATES.DOWN],
    [40, PROVIDER_HEALTH_STATES.DOWN],
  ])('maps %i consecutive failures to %s', (failures, expected) => {
    expect(deriveHealthState(failures, degradedAfter, downAfter)).toBe(expected);
  });

  it('does not degrade on a single failure', () => {
    // A blip is not an outage. Marking a provider degraded the first time a
    // request times out makes the state meaningless — everything is degraded
    // eventually, so nobody looks.
    expect(deriveHealthState(1, degradedAfter, downAfter)).toBe(
      PROVIDER_HEALTH_STATES.HEALTHY,
    );
  });

  it('treats the threshold as inclusive', () => {
    // "Degraded after 3 failures" has to mean the third failure degrades it.
    // An exclusive comparison would make the configured number silently mean
    // one more than it says.
    expect(deriveHealthState(3, 3, 10)).toBe(PROVIDER_HEALTH_STATES.DEGRADED);
    expect(deriveHealthState(10, 3, 10)).toBe(PROVIDER_HEALTH_STATES.DOWN);
  });

  it('is monotonic — more failures never means better health', () => {
    const rank = {
      [PROVIDER_HEALTH_STATES.HEALTHY]: 0,
      [PROVIDER_HEALTH_STATES.DEGRADED]: 1,
      [PROVIDER_HEALTH_STATES.DOWN]: 2,
    };

    let previous = 0;
    for (let failures = 0; failures <= 20; failures += 1) {
      const current = rank[deriveHealthState(failures, degradedAfter, downAfter)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});
