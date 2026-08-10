import { Module } from '@nestjs/common';

import { ClicksModule } from '../clicks/clicks.module';
import { FraudModule } from '../fraud/fraud.module';
import { OffersModule } from '../offers/offers.module';
import { ProvidersModule } from '../providers/providers.module';
import { RewardsModule } from '../rewards/rewards.module';
import { UsersModule } from '../users/users.module';
import { ConversionsService } from './conversions.service';
import { FraudContextBuilder } from './fraud-context.builder';
import { PostbackIntakeService } from './postback-intake.service';
import { PostbacksController } from './postbacks.controller';

/**
 * Owns `provider_postbacks` and `conversions` — ARCHITECTURE.md §4,
 * DATABASE.md §11.
 *
 * Two services, one per half of the flow, because the two halves have opposite
 * priorities. `PostbackIntakeService` is the synchronous surface (§10.1): fast
 * and dumb, because a provider is waiting on the socket and a slow
 * acknowledgement manufactures duplicates. `ConversionsService` is the
 * asynchronous one (§10.3): slow and careful, on the worker, where nobody is
 * waiting and correctness costs nothing but time.
 *
 * Dependencies match §4.1's graph exactly — `conversions → clicks`,
 * `conversions → providers`, plus `users` for the account check §10.3 step 3
 * requires and `offers` for the configured rate step 5 prices with. No table
 * outside this module is read directly (§5, rules 3 and 4): the click comes
 * from `ClicksService`, the user from `UsersService`, the rates from
 * `RatesService`.
 *
 * `conversions → rewards` is §4.1's arrow, and crediting happens inside the
 * same transaction as the conversion row (DATABASE.md §10.1) rather than after
 * it — partial completion there is a missing or duplicated credit.
 *
 * `conversions → fraud` is §4.1's last arrow, and it is **call-in only**:
 * `FraudContextBuilder` assembles a plain object of primitives and hands it
 * over (§4.2). Nothing comes back but a score and a recommendation, and
 * applying that recommendation is this module's job — which is why the arrow
 * to `rewards` is still the only way a point moves here.
 */
@Module({
  imports: [
    ProvidersModule,
    ClicksModule,
    OffersModule,
    UsersModule,
    RewardsModule,
    FraudModule,
  ],
  controllers: [PostbacksController],
  providers: [PostbackIntakeService, ConversionsService, FraudContextBuilder],
  exports: [PostbackIntakeService, ConversionsService],
})
export class ConversionsModule {}
