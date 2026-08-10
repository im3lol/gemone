import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';

import { ENV } from '../config/env.module';
import type { Env } from '../config/env.schema';
import { HealthModule } from '../health/health.module';
import { QUEUES, REDIS_CONNECTION } from './queue.constants';
import { RedisReadinessCheck } from './redis-readiness.check';

/**
 * Queue infrastructure — ARCHITECTURE.md §13.
 *
 * BullMQ on the Redis we already run, rather than a dedicated broker. Redis is
 * required for caching and rate limiting regardless, so RabbitMQ or NATS would
 * be a second piece of infrastructure to run, monitor and back up in exchange
 * for guarantees we do not need (P4, P6).
 *
 * Global because both entrypoints need it and threading it through imports
 * would add ceremony without adding a boundary. Producing and consuming are
 * **not** the same thing, though: this module lets any module enqueue, and
 * only `WorkerModule` pulls in the processors that consume. That split is what
 * keeps a slow catalog sync out of the API's event loop (§1.2), and it is the
 * reason the two entrypoints exist at all.
 */
@Global()
@Module({
  imports: [
    HealthModule,
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL },
        defaultJobOptions: {
          /*
           * Exponential backoff, bounded by attempt count (§13.2). A provider
           * that is down stays down for minutes, not milliseconds, so a tight
           * retry loop only burns the attempts before anyone could have fixed
           * anything.
           */
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },

          /*
           * Completed jobs are trimmed; failed ones are kept for a week.
           *
           * BullMQ's failed set IS the dead-letter queue (§13.2), and failures
           * nobody can see are failures nobody fixes. Successes need no second
           * home — `offer_sync_runs` already records them, durably, where an
           * admin can query them.
           */
          removeOnComplete: { count: 100 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.CATALOG }),
    BullModule.registerQueue({ name: QUEUES.POSTBACKS }),
    BullModule.registerQueue({ name: QUEUES.REWARDS }),
    BullModule.registerQueue({ name: QUEUES.MAINTENANCE }),
    BullModule.registerQueue({ name: QUEUES.NOTIFICATIONS }),
  ],
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env): Redis =>
        new Redis(env.REDIS_URL, {
          // The readiness check has to be able to answer "Redis is gone"
          // rather than queue the PING forever waiting to reconnect — an
          // unbounded retry here would hang the probe instead of failing it.
          maxRetriesPerRequest: 1,
        }),
    },
    RedisReadinessCheck,
  ],
  exports: [BullModule, REDIS_CONNECTION],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CONNECTION) private readonly redis: Redis) {}

  /**
   * Closes the connection this module opened.
   *
   * BullMQ owns and closes its own; this is the one behind the health check.
   * Without closing it the process holds a socket open and never exits, which
   * turns every deploy into a `SIGKILL` after the shutdown timeout.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
