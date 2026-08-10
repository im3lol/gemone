import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ConfigurationService } from '../../core/config/configuration.service';
import { RewardsModule } from '../rewards/rewards.module';
import { PAYOUT_PROVIDER } from './contracts/payout-provider';
import { ManualPayoutProvider } from './providers/manual-payout.provider';
import { PAYOUTS_CONFIGURATION_KEYS } from './payouts.config';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

/**
 * Owns `payout_requests` — ARCHITECTURE.md §4, DATABASE.md §11.
 *
 * Depends on `rewards` for every point it moves, and on nothing else in the
 * domain — §4.1's `payouts → rewards` arrow and no other. It reads no other
 * module's tables: the balance and every movement come from
 * `RewardAccountingService` (P2).
 *
 * It notably does **not** depend on `admin`. Administrative transitions open
 * their transaction in `admin` and pass it in, which is how every other
 * admin-driven action in this codebase already works — and it is what keeps
 * the dependency one-directional (DECISIONS.md D44).
 *
 * **The payout provider is bound to a token, with exactly one implementation
 * and no factory** (§11.4, P6). Providers are added routinely; payout
 * providers are not, and building a registry for a set of size one would be
 * the framework P1 declines to authorise.
 */
@Module({
  imports: [RewardsModule],
  controllers: [PayoutsController],
  providers: [
    PayoutsService,
    { provide: PAYOUT_PROVIDER, useClass: ManualPayoutProvider },
  ],
  exports: [PayoutsService],
})
export class PayoutsModule implements OnApplicationBootstrap {
  constructor(private readonly configuration: ConfigurationService) {}

  onApplicationBootstrap(): void {
    for (const definition of PAYOUTS_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }
  }
}
