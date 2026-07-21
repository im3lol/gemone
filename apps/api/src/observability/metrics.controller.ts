import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { PAYOUT_QUEUE } from '../payouts/payout.queue';
import { MetricsService } from './metrics.service';

// Prometheus scrape target. Public (protect via network in prod).
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @InjectQueue(PAYOUT_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  async scrape(@Res() res: Response) {
    // Refresh queue-backlog gauge at scrape time.
    const c = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    this.metrics.queueDepth.set({ state: 'waiting' }, c.waiting ?? 0);
    this.metrics.queueDepth.set({ state: 'active' }, c.active ?? 0);
    this.metrics.queueDepth.set({ state: 'delayed' }, c.delayed ?? 0);
    this.metrics.queueDepth.set({ state: 'failed' }, c.failed ?? 0);

    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.metrics());
  }
}
