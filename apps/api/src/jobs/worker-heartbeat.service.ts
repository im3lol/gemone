import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CONNECTION } from '../core/queue/queue.constants';

/**
 * Liveness for a process that serves no HTTP — ARCHITECTURE.md §17.2.
 *
 * `api` has a health endpoint an orchestrator can poll. The worker has no
 * port, so a container that is "running" tells nobody whether it is still
 * consuming: the failure that matters is a process whose event loop has
 * stopped turning while Docker still reports it up, and the visible symptom is
 * conversions that are never credited and email that is never sent.
 *
 * The heartbeat is a key with a TTL. Writing it proves the event loop is
 * running *and* that Redis — the thing every queue depends on — is reachable
 * from this process. If either stops being true the key expires and
 * `worker-health.js` starts failing.
 */
export const WORKER_HEARTBEAT_KEY = 'gemone:worker:heartbeat';

/**
 * Written every 15 seconds, expires after 60.
 *
 * The TTL is four intervals rather than two, so a single slow tick — a long
 * job holding the loop, a brief Redis blip — does not report a healthy worker
 * as dead. Restarting a working process costs more than noticing a dead one
 * fifteen seconds later.
 */
const INTERVAL_MS = 15_000;
export const HEARTBEAT_TTL_SECONDS = 60;

@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(REDIS_CONNECTION) private readonly redis: Redis) {}

  async onApplicationBootstrap(): Promise<void> {
    // Once immediately, so the container does not spend its first interval
    // looking unhealthy to a check that starts polling right away.
    await this.beat();

    this.timer = setInterval(() => {
      void this.beat();
    }, INTERVAL_MS);

    // Without this the interval alone would hold the process open, and a
    // worker that cannot be shut down is a deployment that hangs.
    this.timer.unref();

    this.logger.log({ intervalMs: INTERVAL_MS }, 'Worker heartbeat started');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async beat(): Promise<void> {
    try {
      await this.redis.set(WORKER_HEARTBEAT_KEY, Date.now().toString(), 'EX', HEARTBEAT_TTL_SECONDS);
    } catch (error) {
      // Logged, not thrown: an unhandled rejection on a timer would take the
      // process down, and a Redis blip is exactly what the TTL absorbs. If it
      // persists, the key expires and the health check reports it.
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Worker heartbeat could not be written',
      );
    }
  }
}
