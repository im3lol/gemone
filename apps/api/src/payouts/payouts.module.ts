import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { KillSwitchModule } from '../killswitch/killswitch.module';
import { PAYOUT_QUEUE } from './payout.queue';
import { PayoutProcessor } from './payout.processor';
import { PayoutsAdminController } from './payouts.admin.controller';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PaypalProvider } from './providers/paypal.provider';
import { ReloadlyProvider } from './providers/reloadly.provider';

// The queue processor only runs where RUN_WORKERS !== 'false' — i.e. on worker
// deployments (and single-container/dev by default). The API sets it to 'false'
// so it enqueues without competing for jobs.
const runWorkers = process.env.RUN_WORKERS !== 'false';

@Module({
  imports: [BullModule.registerQueue({ name: PAYOUT_QUEUE }), FraudModule, KillSwitchModule],
  controllers: [PayoutsController, PayoutsAdminController],
  providers: [
    PayoutsService,
    PaypalProvider,
    ReloadlyProvider,
    ...(runWorkers ? [PayoutProcessor] : []),
  ],
})
export class PayoutsModule {}
