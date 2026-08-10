import { Module } from '@nestjs/common';

import { ConversionsModule } from '../modules/conversions/conversions.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { OffersModule } from '../modules/offers/offers.module';
import { RewardsModule } from '../modules/rewards/rewards.module';
import { CatalogSyncProcessor } from './catalog-sync.processor';
import { NotificationsProcessor } from './notifications.processor';
import { PostbackProcessProcessor } from './postback-process.processor';
import { ReconciliationProcessor } from './reconciliation.processor';
import { RewardMaturationProcessor } from './reward-maturation.processor';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

/**
 * Queue consumers and scheduled jobs — ARCHITECTURE.md §3, §12.
 *
 * Imported by `WorkerModule` only. `AppModule` deliberately does not include
 * it: the `api` process must be able to *enqueue* without *consuming*, or the
 * process split that exists to keep a slow catalog sync away from a postback
 * acknowledgement (§1.2) would be undone by a module import.
 *
 * Jobs orchestrate; they hold no business logic of their own. Every processor
 * here resolves the work to a module service and reports the outcome, which is
 * why the sync framework is testable without a queue at all.
 */
@Module({
  imports: [OffersModule, ConversionsModule, RewardsModule, NotificationsModule],
  providers: [
    CatalogSyncProcessor,
    NotificationsProcessor,
    PostbackProcessProcessor,
    ReconciliationProcessor,
    RewardMaturationProcessor,
    WorkerHeartbeatService,
  ],
})
export class JobsModule {}
