import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROVIDER_HEALTH_STATES, type ProviderHealthState } from '@gemone/contracts';

import { ConfigurationService } from '../../core/config/configuration.service';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { Provider } from '../../generated/prisma/client';
import {
  PROVIDER_HEALTH_DEGRADED_AFTER,
  PROVIDER_HEALTH_DOWN_AFTER,
} from './providers.config';

/**
 * Provider health — DATABASE.md §3.2, ARCHITECTURE.md §17.2.
 *
 * Health is *recorded*, not probed. Every operation against a provider — a
 * catalog sync, a postback verification, an outbound call — reports its
 * outcome here, and the state is derived from consecutive failures.
 *
 * **Why not an active probe endpoint.** A synthetic health check answers a
 * question nobody has: whether the provider responds to *our probe*. The
 * question that matters is whether the work we actually do against them is
 * succeeding, and recorded outcomes answer it exactly, for free, with no
 * extra API quota spent and no probe that passes while every real sync fails.
 *
 * **Why providers are deliberately NOT registered as a readiness check.**
 * `/health/ready` answers "should traffic be routed to this process" (§17.2).
 * A provider being down does not make this process unable to serve: users can
 * still log in, browse other providers' offers, and withdraw. Reporting
 * not-ready would pull a healthy replica out of rotation because a third
 * party is having a bad hour — turning someone else's outage into ours. The
 * dependency that *does* register is the database, because without it we can
 * serve nothing.
 *
 * Health state is persisted rather than computed because it must survive a
 * restart and be visible in the admin panel without re-deriving it from sync
 * history on every page load (DATABASE.md §3.2).
 */
@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * A successful operation. Clears the failure streak outright.
   *
   * Reset to zero, not decremented. A provider that alternates success and
   * failure is working — badly, but working — and a decaying counter would
   * eventually mark it DOWN for a fault it keeps recovering from. What we care
   * about is a *streak*, because that is what distinguishes a blip from an
   * outage.
   */
  async recordSuccess(providerId: string): Promise<Provider> {
    return this.prisma.provider.update({
      where: { id: providerId },
      data: {
        healthState: PROVIDER_HEALTH_STATES.HEALTHY,
        consecutiveFailureCount: 0,
        lastFailureReason: null,
        lastSuccessfulSyncAt: this.clock.now(),
      },
    });
  }

  /**
   * A failed operation. Increments the streak and re-derives the state.
   *
   * The increment and the state change are one transaction, and the increment
   * is expressed as an atomic `increment` rather than a read-modify-write.
   * Two workers failing against the same provider concurrently would
   * otherwise both read the same count and both write count+1, so a run of
   * failures would under-count and a provider would take far longer to be
   * marked DOWN than the configured threshold promises.
   */
  async recordFailure(providerId: string, reason: string): Promise<Provider> {
    const [degradedAfter, downAfter] = await this.thresholds(providerId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const incremented = await tx.provider.update({
        where: { id: providerId },
        data: {
          consecutiveFailureCount: { increment: 1 },
          lastFailureReason: reason.slice(0, 500),
        },
      });

      const state = deriveHealthState(
        incremented.consecutiveFailureCount,
        degradedAfter,
        downAfter,
      );

      if (state === incremented.healthState) return incremented;

      return tx.provider.update({
        where: { id: providerId },
        data: { healthState: state },
      });
    });

    // Warn, not error: a provider failing is an expected event on a platform
    // that depends on third parties, and logging it as an error would train
    // everyone to ignore the error log (§15.1).
    this.logger.warn(
      {
        providerId,
        slug: updated.slug,
        consecutiveFailures: updated.consecutiveFailureCount,
        healthState: updated.healthState,
        reason,
      },
      'Provider operation failed',
    );

    return updated;
  }

  /**
   * Clears health back to HEALTHY without recording an operation.
   *
   * A real operational need, not a convenience: when a provider confirms they
   * have fixed their side, an operator should not have to wait for the next
   * scheduled sync to find out. Takes a transaction client so `admin` can
   * write the audit entry alongside it.
   */
  async reset(
    providerId: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Provider> {
    return client.provider.update({
      where: { id: providerId },
      data: {
        healthState: PROVIDER_HEALTH_STATES.HEALTHY,
        consecutiveFailureCount: 0,
        lastFailureReason: null,
      },
    });
  }

  /**
   * Resolves both thresholds, scoped to this provider.
   *
   * The scope id is the provider's **id**, not its slug. A slug is editable
   * in principle and reads better in the database; an id is the actual
   * identity of the row. Scoping configuration by slug would mean a rename
   * silently orphans every value set for that provider — which is also why
   * `ProvidersService.update` refuses to rename one.
   */
  private async thresholds(providerId: string): Promise<[number, number]> {
    const [degradedAfter, downAfter] = await Promise.all([
      this.configuration.get<number>(PROVIDER_HEALTH_DEGRADED_AFTER.key, providerId),
      this.configuration.get<number>(PROVIDER_HEALTH_DOWN_AFTER.key, providerId),
    ]);

    /*
     * The two keys are validated independently, so nothing stops an admin
     * setting `down_after` below `degraded_after`. Cross-key validation is not
     * expressible in a per-key schema, and adding a rules engine to express it
     * would be a large mechanism for one relationship (P6).
     *
     * Handled here instead: DOWN is never reached before DEGRADED. The
     * alternative — trusting the values — makes a provider jump straight to
     * DOWN on its first failure, which is a far worse outcome than a logged
     * warning.
     */
    if (downAfter <= degradedAfter) {
      this.logger.warn(
        { providerId, degradedAfter, downAfter },
        'Provider health thresholds are inverted; treating DOWN as one step beyond DEGRADED',
      );
      return [degradedAfter, degradedAfter + 1];
    }

    return [degradedAfter, downAfter];
  }
}

/**
 * Consecutive failures to a health state.
 *
 * A pure function, exported for tests: this is the rule the whole feature
 * exists to express, and it should be verifiable without a database.
 */
export function deriveHealthState(
  consecutiveFailures: number,
  degradedAfter: number,
  downAfter: number,
): ProviderHealthState {
  if (consecutiveFailures >= downAfter) return PROVIDER_HEALTH_STATES.DOWN;
  if (consecutiveFailures >= degradedAfter) return PROVIDER_HEALTH_STATES.DEGRADED;
  return PROVIDER_HEALTH_STATES.HEALTHY;
}
