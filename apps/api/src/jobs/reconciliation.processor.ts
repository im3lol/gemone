import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';

import {
  MAINTENANCE_JOBS,
  QUEUES,
  type ReconciliationJobData,
} from '../core/queue/queue.constants';
import { RewardAccountingService } from '../modules/rewards/reward-accounting.service';
import { RECONCILIATION_BATCH_SIZE } from '../modules/rewards/rewards.config';

/**
 * 03:00 UTC (§12.1, "cron, nightly").
 *
 * A fixed hour rather than `{ every: 24h }`, which would drift to whatever time
 * the worker last restarted — so the heaviest scan in the system would
 * eventually land in peak hours, and nobody would know why. Early morning UTC
 * because the sweep contends with live credits for nothing but read bandwidth,
 * and the cheapest hour is the one with fewest of them.
 */
const NIGHTLY_AT_0300 = '0 3 * * *';

/**
 * Stated explicitly, because BullMQ resolves a cron pattern in the **server's
 * local timezone** when none is given.
 *
 * Found by reading the scheduled time back out of Redis rather than by
 * reasoning about it: on a machine at UTC+3 the pattern above registered its
 * next run at `00:00Z`. In a container that happens to be UTC that is invisible,
 * which is what makes it worth pinning — the hour this job runs would otherwise
 * be a property of the host it was deployed to, and two replicas in different
 * zones would disagree about when "nightly" is.
 */
const SCHEDULE_TIMEZONE = 'UTC';

/**
 * The nightly reconciliation — ARCHITECTURE.md §12.1, PROJECT.md R4 and R5.
 *
 * Asserts that every balance is explainable by its own recorded history. This
 * is the mitigation R4 names and the evidence R5 is decided on: the P2 choice
 * to keep a simple balance model behind the service interface is supposed to be
 * revisited *"after the first month of production data, with the reconciliation
 * job's drift rate as the deciding evidence"*. Until this job ran, that drift
 * rate did not exist, and §23.1's trigger for the append-only ledger — "when
 * reconciliation reports unexplained drift" — could never fire.
 *
 * ## Reports; never repairs
 *
 * R5 is explicit: *"If reconciliation reports any unexplained drift in
 * production, that is the signal to migrate — not a bug to patch."* Correcting
 * a drifted row here would destroy the only evidence that the simple balance
 * model had failed, which is precisely the evidence the decision needs. The
 * service's `reconcile` returns a report and touches nothing; this job counts
 * the reports and writes them down.
 *
 * ## Bounded and re-enqueued
 *
 * §12.2 rule 2. One page per job, and a full page enqueues the next carrying a
 * keyset cursor. An unbounded scan over every balance is the job most likely to
 * be fine for a year and then hold a worker for an hour.
 */
@Injectable()
@Processor(QUEUES.MAINTENANCE, {
  /*
   * One (§13.1). These jobs are scans: two at once contend for the same pages
   * and neither finishes sooner, and the continuation chain below is
   * sequential by nature anyway.
   */
  concurrency: 1,
})
export class ReconciliationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(
    @InjectQueue(QUEUES.MAINTENANCE) private readonly queue: Queue,
    private readonly rewards: RewardAccountingService,
  ) {
    super();
  }

  /**
   * A BullMQ repeatable job, not an in-process timer (§12.3) — a timer fires
   * once per process, so two worker replicas would sweep every balance twice.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      MAINTENANCE_JOBS.RECONCILIATION,
      { pattern: NIGHTLY_AT_0300, tz: SCHEDULE_TIMEZONE },
      { name: MAINTENANCE_JOBS.RECONCILIATION },
    );

    this.logger.log(
      { pattern: NIGHTLY_AT_0300, tz: SCHEDULE_TIMEZONE },
      'Reconciliation scheduled',
    );
  }

  async process(job: Job<ReconciliationJobData>): Promise<ReconciliationPageResult> {
    if (job.name !== MAINTENANCE_JOBS.RECONCILIATION) {
      throw new Error(`Unknown maintenance job: ${job.name}`);
    }

    return this.sweep(job.data?.after ?? null);
  }

  /**
   * Reconciles one page and, if it filled, queues the next.
   *
   * A failure on one user is logged and skipped rather than aborting the sweep.
   * The alternative — one unreadable account stopping the scan — would mean a
   * single bad row hides drift on every account after it, which is the opposite
   * of what this job is for.
   */
  async sweep(after: string | null): Promise<ReconciliationPageResult> {
    const userIds = await this.rewards.findUsersToReconcile(after, RECONCILIATION_BATCH_SIZE);

    let checked = 0;
    let drifted = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        const report = await this.rewards.reconcile(userId);
        checked += 1;
        if (!report.balanced) drifted += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          { userId, err: error instanceof Error ? error.message : String(error) },
          'Could not reconcile a balance',
        );
      }
    }

    /*
     * Only a full page continues, and only if the cursor moved.
     *
     * The cursor check is not defensive padding: `findUsersToReconcile` orders
     * by a unique key, so a page that filled without advancing would mean that
     * invariant had broken — and the failure mode of not checking is an
     * infinite chain of jobs re-reading one page forever.
     */
    const last = userIds.at(-1) ?? null;
    const complete = userIds.length < RECONCILIATION_BATCH_SIZE || last === null || last === after;

    if (!complete) {
      await this.queue.add(MAINTENANCE_JOBS.RECONCILIATION, { after: last });
    }

    /*
     * Logged on every page, including the clean ones (§12.2 rule 5). "The
     * sweep ran and found nothing" and "the sweep has not run" look identical
     * in a system that only logs when something is wrong — and this is the job
     * whose silence would mean nobody is checking the balances at all.
     *
     * At `error` when anything drifted, because that is the line R5 says to act
     * on rather than investigate at leisure.
     */
    const summary = { checked, drifted, failed, after, complete };

    if (drifted > 0 || failed > 0) {
      this.logger.error(summary, 'Reconciliation found balances it could not explain');
    } else {
      this.logger.log(summary, 'Reconciliation page clean');
    }

    return summary;
  }
}

/** What one page did. Returned so the job record carries it, not just the log. */
export interface ReconciliationPageResult {
  checked: number;
  drifted: number;
  failed: number;
  after: string | null;
  /** True when this page was the last one — no continuation was enqueued. */
  complete: boolean;
}

export const __testing = { NIGHTLY_AT_0300, SCHEDULE_TIMEZONE };
