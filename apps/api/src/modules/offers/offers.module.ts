import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ConfigurationService } from '../../core/config/configuration.service';
import { ProvidersModule } from '../providers/providers.module';
import { CatalogSyncService } from './catalog-sync.service';
import { OfferWallService } from './offer-wall.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { OFFERS_CONFIGURATION_KEYS } from './offers.config';
import { RatesService } from './rates.service';
import { SyncRunsService } from './sync-runs.service';

/**
 * Owns `offers` and `offer_sync_runs` — ARCHITECTURE.md §4, DATABASE.md §11.
 *
 * **The authenticated surface §4's table gives `offers` is the wall**, and it
 * arrived in Feature 15 exactly where that table said it would — nothing moved
 * to accommodate it. The admin catalog screens still compose these same
 * services from `admin` (§4.3), and the two read paths share `OffersService`
 * rather than each holding their own query.
 *
 * Depends on `providers` and nothing else in the domain. It reaches an adapter
 * only through `ProviderRegistry`, and it imports the provider *contracts* for
 * the normalized offer shape — never a concrete adapter (§5, rule 6).
 */
@Module({
  imports: [ProvidersModule],
  controllers: [OffersController],
  providers: [OffersService, SyncRunsService, CatalogSyncService, RatesService, OfferWallService],
  /*
   * `OfferWallService` is deliberately not exported. It is this module's own
   * HTTP composition and has one consumer, the controller beside it; exporting
   * it would invite `admin` to reach for the user-facing serialiser and get a
   * screen missing the payout column it needs.
   */
  exports: [OffersService, SyncRunsService, CatalogSyncService, RatesService],
})
export class OffersModule implements OnApplicationBootstrap {
  constructor(private readonly configuration: ConfigurationService) {}

  /**
   * Registers this module's configuration keys.
   *
   * Keys are declared by the module that owns the rule (§4.9), at startup, so
   * a value can never be written for a key nothing reads — and so the admin
   * configuration screen can list every key without a registry of registries.
   */
  onApplicationBootstrap(): void {
    for (const definition of OFFERS_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }
  }
}
