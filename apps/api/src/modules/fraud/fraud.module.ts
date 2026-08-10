import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ConfigurationService } from '../../core/config/configuration.service';
import { FRAUD_CONFIGURATION_KEYS } from './fraud.config';
import { FraudService } from './fraud.service';

/**
 * Owns `fraud_evaluations` — ARCHITECTURE.md §4, DATABASE.md §11.
 *
 * **Imports no business module, permanently** (§4.2). The `imports` array below
 * is empty and must stay empty: everything the engine needs arrives as a plain
 * `FraudEvaluationContext` assembled by the caller. That is what keeps the
 * `conversions ──► fraud` arrow one-directional and the rule engine testable
 * with object literals.
 *
 * It also moves no money. Scoring produces a recommendation and a record; the
 * caller applies it through `RewardAccountingService` (P2), which is why
 * `RewardsModule` is absent here too.
 */
@Module({
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule implements OnApplicationBootstrap {
  constructor(private readonly configuration: ConfigurationService) {}

  onApplicationBootstrap(): void {
    for (const definition of FRAUD_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }
  }
}
