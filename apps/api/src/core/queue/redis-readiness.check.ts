import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import { HealthService } from '../health/health.service';
import type { ReadinessCheck } from '../health/readiness-check';
import { REDIS_CONNECTION } from './queue.constants';

/**
 * Reports Redis to `/health/ready` — ARCHITECTURE.md §17.2.
 *
 * Registered on the same grounds as the database and NOT on the same grounds
 * as a provider (which is deliberately absent from readiness, see
 * `ProviderHealthService`): Redis is our own infrastructure, declared in the
 * compose file since day one. A replica that cannot reach it cannot enqueue,
 * so it would accept work it then silently drops — and silently dropped work
 * is the failure mode §12.2 rule 5 exists to prevent.
 *
 * Liveness is deliberately untouched. A process whose Redis went away should
 * stop receiving traffic, not be killed: restarting does not bring Redis back,
 * and a restart loop during a blip makes the outage worse.
 */
@Injectable()
export class RedisReadinessCheck implements ReadinessCheck, OnModuleInit {
  readonly name = 'redis';

  private readonly logger = new Logger(RedisReadinessCheck.name);

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    private readonly health: HealthService,
  ) {}

  onModuleInit(): void {
    this.health.register(this);
  }

  /**
   * Round-trips a PING rather than reading a cached connection flag.
   *
   * `status === 'ready'` reflects what happened at connect time, and a Redis
   * that has since gone away would still report ready. Readiness has to ask.
   */
  async isReady(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Redis ping failed',
      );
      return false;
    }
  }
}
