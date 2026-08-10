import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ConfigurationService } from '../../core/config/configuration.service';
import { RewardAccountingService } from './reward-accounting.service';
import { REWARDS_CONFIGURATION_KEYS } from './rewards.config';
import { RewardsController } from './rewards.controller';

/**
 * Owns `user_balances` and `reward_transactions` — ARCHITECTURE.md §4,
 * DATABASE.md §11. **The only module permitted to touch either** (P2).
 *
 * Depends on no other domain module, deliberately and permanently. Everything
 * that moves points calls *in*; this calls nothing back out. That direction is
 * what makes the service replaceable: a ledger implementation has to satisfy
 * these method signatures and nothing else, because there is no other module
 * whose internals it could have grown into.
 *
 * The consequence, which is the point of P2: `conversions`, `payouts`, `fraud`
 * and `admin` will all call this and none of them will know whether a balance
 * is a row or a fold.
 */
@Module({
  controllers: [RewardsController],
  providers: [RewardAccountingService],
  exports: [RewardAccountingService],
})
export class RewardsModule implements OnApplicationBootstrap {
  constructor(private readonly configuration: ConfigurationService) {}

  onApplicationBootstrap(): void {
    for (const definition of REWARDS_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }
  }
}
