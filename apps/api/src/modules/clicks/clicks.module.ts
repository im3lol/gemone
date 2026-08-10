import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ConfigurationService } from '../../core/config/configuration.service';
import { ENV } from '../../core/config/env.module';
import type { Env } from '../../core/config/env.schema';
import { OffersModule } from '../offers/offers.module';
import { ProvidersModule } from '../providers/providers.module';
import { ClicksController } from './clicks.controller';
import { CLICKS_CONFIGURATION_KEYS } from './clicks.config';
import { ClicksService } from './clicks.service';
import { SUB_ID_SIGNER } from './clicks.tokens';
import { SubIdSigner } from './internal/sub-id';

/**
 * Owns the `clicks` table — ARCHITECTURE.md §4, DATABASE.md §11.
 *
 * Depends on `offers` and `providers`, and on nothing else in the domain. It
 * reads neither module's tables: the offer snapshot comes from
 * `OffersService`, the provider from `ProvidersService`, and the adapter from
 * `ProviderRegistry` (§11.2).
 *
 * A note on §4.1's dependency diagram, which draws an arrow from `offers` down
 * to `clicks`. That arrow is the *user's* path — browse the wall, then click —
 * not a code dependency. Read as a dependency it would be backwards: `offers`
 * has no reason to know clicks exist, while a click cannot be recorded without
 * the offer it is a promise about. Recorded in DECISIONS.md (D19).
 */
@Module({
  imports: [OffersModule, ProvidersModule],
  controllers: [ClicksController],
  providers: [
    {
      /*
       * The signing key is environment, not configuration (§5.1): it is a
       * secret, and changing it is a deploy. It is read here, once, so the
       * signer is the only thing in the module that has ever seen it.
       */
      provide: SUB_ID_SIGNER,
      inject: [ENV],
      useFactory: (env: Env): SubIdSigner => new SubIdSigner(env.CLICK_SIGNING_SECRET),
    },
    ClicksService,
  ],
  exports: [ClicksService],
})
export class ClicksModule implements OnApplicationBootstrap {
  constructor(private readonly configuration: ConfigurationService) {}

  onApplicationBootstrap(): void {
    for (const definition of CLICKS_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }
  }
}
