import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ClicksModule } from '../clicks/clicks.module';
import { ConversionsModule } from '../conversions/conversions.module';
import { FraudModule } from '../fraud/fraud.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RewardsModule } from '../rewards/rewards.module';
import { OffersModule } from '../offers/offers.module';
import { ProvidersModule } from '../providers/providers.module';
import { UsersModule } from '../users/users.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminClicksController } from './admin-clicks.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminConfigurationController } from './admin-configuration.controller';
import { AdminConfigurationService } from './admin-configuration.service';
import { AdminController } from './admin.controller';
import { AdminFraudController } from './admin-fraud.controller';
import { AdminFraudService } from './admin-fraud.service';
import { AdminConversionsController } from './admin-conversions.controller';
import { AdminPayoutsController } from './admin-payouts.controller';
import { AdminPayoutsService } from './admin-payouts.service';
import { AdminPostbacksController } from './admin-postbacks.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminProvidersService } from './admin-providers.service';
import { AdminUsersService } from './admin-users.service';

/**
 * Owns exactly one table — `admin_audit_log` (DATABASE.md §11).
 *
 * Everything else it does is calling other modules' public services and
 * shaping the result for an admin screen (ARCHITECTURE.md §4.3). Future
 * administrative surfaces — provider configuration, the payout queue, the
 * postback quarantine — extend this module by composing their own domain's
 * services, not by reaching into their tables.
 */
@Module({
  imports: [
    UsersModule,
    AuthModule,
    ProvidersModule,
    OffersModule,
    ClicksModule,
    ConversionsModule,
    FraudModule,
    RewardsModule,
    PayoutsModule,
  ],
  controllers: [
    AdminController,
    AdminProvidersController,
    AdminCatalogController,
    AdminClicksController,
    AdminPostbacksController,
    AdminConversionsController,
    AdminPayoutsController,
    AdminFraudController,
    AdminConfigurationController,
  ],
  providers: [
    AdminUsersService,
    AdminProvidersService,
    AdminCatalogService,
    AdminAuditService,
    AdminPayoutsService,
    AdminFraudService,
    AdminConfigurationService,
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}
