import { Global, Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module';
import { ConfigurationService } from './configuration.service';

/**
 * Business-rule configuration (P3) — ARCHITECTURE.md §4.9.
 *
 * Global because nearly every business rule will read from it, and threading
 * it through module imports would add ceremony without adding a boundary.
 *
 * Distinct from EnvModule, which holds infrastructure (§5.1). The two are
 * deliberately separate: environment breaks the *process* when wrong,
 * configuration changes the *business* when wrong, and mixing them is how a
 * reward rate ends up in a .env file where no admin can reach it.
 */
@Global()
@Module({
  /*
   * Imported explicitly even though `EventsModule` is itself global.
   *
   * The cache subscribes to §14.3's channel, so this is a real dependency and
   * declaring it means any graph that can build `ConfigurationModule` can build
   * a working one. Relying on a sibling module to have registered the global
   * first is the kind of ordering that holds until a narrower graph — a test,
   * a future entrypoint — leaves it out, and then fails at injection time with
   * a message about a symbol nobody was thinking about.
   */
  imports: [EventsModule],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
