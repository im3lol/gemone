import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';

import { QUEUES, REWARD_JOBS } from '../core/queue/queue.constants';
import { CLOCK, type Clock } from '../core/time/clock';
import { RewardAccountingService } from '../modules/rewards/reward-accounting.service';
import { MATURATION_BATCH_SIZE } from '../modules/rewards/rewards.config';

/**
 * Hourly (§12.1).
 *
 * A hold period is measured in days, so the cost of being up to an hour late is
 * nothing, and the cost of sweeping more often is a query against a growing
 * table for work that is almost never there.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Moves matured credits from `pending` to `available` — ARCHITECTURE.md §9.3.
 *
 * This job is the only thing that makes the hold period mean anything. §12.2's
 * fifth rule names its failure mode exactly: "a silently failing scheduled job
 * is the classic way for maturation to stop and nobody to notice until users
 * complain their points never became withdrawable." So it logs what it did on
 * every run, including nothing.
 *
 * **Bounded and re-enqueued** (§12.2, rule 2). An unbounded sweep over a
 * growing table works in month one and takes the worker down in month six.
 *
 * **One transaction per credit, not one per batch** (DATABASE.md §10.3). A
 * single transaction over every maturing reward would hold locks on thousands
 * of balance rows while it ran, block every concurrent credit and withdrawal,
 * and lose all its progress to one failure.
 */
@Injectable()
@Processor(QUEUES.REWARDS, {
  /*
   * One. Every unit of work locks a balance row, so concurrency here buys
   * nothing — the jobs would queue on the same locks — while adding lock
   * contention against credits happening on the request path.
   */
  concurrency: 1,
})
export class RewardMaturationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(RewardMaturationProcessor.name);

  constructor(
    @InjectQueue(QUEUES.REWARDS) private readonly queue: Queue,
    private readonly rewards: RewardAccountingService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  /**
   * A BullMQ repeatable job, not an in-process timer (§12.3). A timer fires
   * once per process, so two worker replicas would mature every credit twice —
   * which the service's own idempotency would absorb, but relying on that is
   * building a correctness bug and then covering it.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REWARD_JOBS.MATURATION,
      { every: SWEEP_INTERVAL_MS },
      { name: REWARD_JOBS.MATURATION },
    );

    this.logger.log({ everyMs: SWEEP_INTERVAL_MS }, 'Reward maturation scheduled');
  }

  async process(job: Job): Promise<{ matured: number; scanned: number }> {
    if (job.name !== REWARD_JOBS.MATURATION) {
      throw new Error(`Unknown reward job: ${job.name}`);
    }

    return this.sweep();
  }

  /**
   * Matures one bounded batch.
   *
   * Each credit is matured in its own transaction, and a failure on one is
   * logged and skipped rather than aborting the sweep: one unmaturable credit
   * must not hold back everyone else's points, and the next run will find it
   * again.
   */
  async sweep(): Promise<{ matured: number; scanned: number }> {
    const now = this.clock.now();
    const candidates = await this.rewards.findMaturable(now, MATURATION_BATCH_SIZE);

    let matured = 0;

    for (const creditId of candidates) {
      try {
        const transaction = await this.rewards.mature(creditId);
        if (transaction) matured += 1;
      } catch (error) {
        this.logger.error(
          { creditId, err: error instanceof Error ? error.message : String(error) },
          'Could not mature a credit',
        );
      }
    }

    /*
     * Logged on every run, including the empty ones. "Maturation ran and found
     * nothing" and "maturation has not run" look identical in a system that
     * only logs when it does something — and they are the difference between
     * fine and users not being paid.
     */
    this.logger.log(
      { scanned: candidates.length, matured, batchSize: MATURATION_BATCH_SIZE },
      'Reward maturation swept',
    );

    return { matured, scanned: candidates.length };
  }
}

export const __testing = { SWEEP_INTERVAL_MS };
