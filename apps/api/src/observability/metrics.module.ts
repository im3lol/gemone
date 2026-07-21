import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PAYOUT_QUEUE } from '../payouts/payout.queue';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: PAYOUT_QUEUE })],
  controllers: [MetricsController, HealthController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
