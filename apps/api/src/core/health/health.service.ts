import { Injectable, Logger } from '@nestjs/common';

import type { ReadinessCheck } from './readiness-check';

/**
 * Health evaluation — ARCHITECTURE.md §17.2.
 *
 * Liveness and readiness answer different questions and are deliberately not
 * the same check. Liveness answers "should this process be killed"; readiness
 * answers "should traffic be sent here". A liveness probe that touches the
 * database restarts a healthy process whenever the database hiccups, turning
 * a brief dependency blip into a restart loop that makes the outage worse.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  /** Keyed by check name, so registering the same dependency twice is a no-op. */
  private readonly checks = new Map<string, ReadinessCheck>();

  /**
   * Registers a dependency to be reported on by `/health/ready`.
   *
   * Called by each dependency's own module during initialisation. This keeps
   * the dependency direction pointing at `core/health`: health owns the
   * contract and knows nothing about who implements it.
   */
  register(check: ReadinessCheck): void {
    if (this.checks.has(check.name)) {
      this.logger.debug({ check: check.name }, 'Readiness check already registered');
      return;
    }

    this.checks.set(check.name, check);
    this.logger.debug({ check: check.name }, 'Readiness check registered');
  }

  /** Names of the registered dependencies. Diagnostics and tests only. */
  registeredChecks(): string[] {
    return [...this.checks.keys()];
  }

  /** Checks nothing external, by design. If this returns, we are alive. */
  isAlive(): true {
    return true;
  }

  /**
   * True only when every registered dependency is reachable.
   *
   * Checks run concurrently — readiness is polled often, and running them in
   * series would make the endpoint's latency the sum of every dependency's.
   *
   * A check that throws counts as not ready. The contract says `isReady` must
   * not throw, but a probe endpoint is the wrong place to trust a contract:
   * an exception escaping here would surface as a 500, which reads as "the
   * app is broken" rather than "a dependency is down".
   */
  async isReady(): Promise<boolean> {
    if (this.checks.size === 0) return true;

    const checks = [...this.checks.values()];

    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          return await check.isReady();
        } catch (error) {
          this.logger.warn(
            {
              check: check.name,
              err: error instanceof Error ? error.message : String(error),
            },
            'Readiness check threw',
          );
          return false;
        }
      }),
    );

    const failed = checks
      .filter((_, index) => results[index] === false)
      .map((check) => check.name);

    if (failed.length > 0) {
      this.logger.warn({ failed }, 'Readiness check failed');
      return false;
    }

    return true;
  }
}
