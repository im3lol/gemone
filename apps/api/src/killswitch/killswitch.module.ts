import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PAYOUT_QUEUE } from '../payouts/payout.queue';
import { KillSwitchController } from './killswitch.controller';
import { KillSwitchService } from './killswitch.service';

@Module({
  imports: [BullModule.registerQueue({ name: PAYOUT_QUEUE })],
  controllers: [KillSwitchController],
  providers: [KillSwitchService],
  exports: [KillSwitchService],
})
export class KillSwitchModule {}
