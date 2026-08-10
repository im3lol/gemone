import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ConfigurationModule } from './core/config/configuration.module';
import { EnvModule } from './core/config/env.module';
import { DatabaseModule } from './core/database/database.module';
import { GlobalExceptionFilter } from './core/errors/global-exception.filter';
import { EventsModule } from './core/events/events.module';
import { HealthModule } from './core/health/health.module';
import { TimeModule } from './core/time/time.module';
import { LoggingModule } from './core/logging/logging.module';
import { AdminModule } from './modules/admin/admin.module';
import { QueueModule } from './core/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClicksModule } from './modules/clicks/clicks.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { ConversionsModule } from './modules/conversions/conversions.module';
import { OffersModule } from './modules/offers/offers.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { UsersModule } from './modules/users/users.module';

/**
 * The application root.
 *
 * `api` and `worker` share this module graph — same services, same models,
 * same migrations (§1.2). They differ only in entrypoint: one opens an HTTP
 * listener, the other consumes queues. Business modules will be added here as
 * they land; `core` is what exists so far.
 */
@Module({
  imports: [
    EnvModule,
    LoggingModule,
    TimeModule,
    DatabaseModule,
    // Before ConfigurationModule: the configuration cache subscribes to it.
    // Both are global, so Nest would resolve either order — the sequence is
    // for whoever reads this list.
    EventsModule,
    ConfigurationModule,
    HealthModule,
    QueueModule,
    UsersModule,
    AuthModule,
    ProvidersModule,
    OffersModule,
    ClicksModule,
    ConversionsModule,
    RewardsModule,
    FraudModule,
    PayoutsModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
