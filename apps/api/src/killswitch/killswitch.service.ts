import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PAYOUT_QUEUE } from '../payouts/payout.queue';
import { REDIS } from '../redis/redis.module';

// Incident kill-switch: halts new withdrawals and pauses the payout queue. The
// flag lives in Redis so it is shared across every api + worker instance and
// survives restarts — flip it the moment a mass-exploit is suspected.
@Injectable()
export class KillSwitchService {
  private readonly log = new Logger(KillSwitchService.name);
  private readonly KEY = 'gemone:withdrawals_halted';

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(PAYOUT_QUEUE) private readonly queue: Queue,
  ) {}

  async isHalted(): Promise<boolean> {
    return (await this.redis.get(this.KEY)) === '1';
  }

  async halt(): Promise<void> {
    await this.redis.set(this.KEY, '1');
    await this.queue.pause();
    this.log.warn('KILL-SWITCH ENGAGED — withdrawals halted, payout queue paused');
  }

  async resume(): Promise<void> {
    await this.redis.set(this.KEY, '0');
    await this.queue.resume();
    this.log.log('Kill-switch released — withdrawals resumed');
  }

  async state() {
    return { halted: await this.isHalted(), queuePaused: await this.queue.isPaused() };
  }
}
