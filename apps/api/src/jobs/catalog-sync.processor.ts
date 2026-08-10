import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';

import {
  CATALOG_JOBS,
  QUEUES,
  type CatalogSyncJobData,
} from '../core/queue/queue.constants';
import { CLOCK, type Clock } from '../core/time/clock';
import { CatalogSyncService } from '../modules/offers/catalog-sync.service';

/** How often the tick runs. Not configuration — see the comment on registration. */
const TICK_INTERVAL_MS = 60_000;

/**
 * The catalog queue's consumer — ARCHITECTURE.md §12.
 *
 * Two job types on one queue. The tick decides *what* is due; the sync job
 * does one provider's work. Splitting them means a provider whose sync takes
 * four minutes cannot delay the decision to sync a different provider, and a
 * failed sync retries on its own without re-running the scheduling logic.
 *
 * This class is loaded only by `WorkerModule`. The `api` process can enqueue
 * onto this queue and never consumes from it, which is the whole reason the
 * two entrypoints exist: a catalog sync takes seconds to minutes, and sharing
 * an event loop with it delays everything the API is supposed to answer in
 * milliseconds (§1.2).
 */
@Injectable()
@Processor(QUEUES.CATALOG, {
  /*
   * Low concurrency (§13.1). These are long-running, provider-rate-limited
   * outbound calls, and hammering a network's API is how an integration gets
   * throttled — at which point a healthy provider is indistinguishable from a
   * broken one.
   */
  concurrency: 2,
})
export class CatalogSyncProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogSyncProcessor.name);

  constructor(
    @InjectQueue(QUEUES.CATALOG) private readonly queue: Queue,
    private readonly catalog: CatalogSyncService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  /**
   * Registers the single repeatable job.
   *
   * A BullMQ repeatable job, **not** an in-process timer (§12.3). A timer
   * fires once per process, so two worker replicas would run every scheduled
   * sync twice. That is not premature scaling — it is declining to build a
   * correctness bug that appears the first time somebody starts a second
   * worker (P5).
   *
   * The interval is a constant rather than configuration on purpose. It is not
   * a business rule: it bounds how *late* a due sync can be, not how often any
   * provider is actually synced, which comes from the provider row. An admin
   * has no reason to tune it and §5.1's test says so.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CATALOG_JOBS.TICK,
      { every: TICK_INTERVAL_MS },
      { name: CATALOG_JOBS.TICK },
    );

    this.logger.log({ everyMs: TICK_INTERVAL_MS }, 'Catalog tick scheduled');
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === CATALOG_JOBS.TICK) return this.tick();
    if (job.name === CATALOG_JOBS.SYNC) return this.runSync(job as Job<CatalogSyncJobData>);

    // A job name nobody handles would otherwise be marked completed, which is
    // the quietest possible way for scheduled work to stop happening.
    throw new Error(`Unknown catalog job: ${job.name}`);
  }

  /**
   * Asks the database which providers are due and enqueues one job each.
   *
   * The tick itself does no provider work, so it is fast and its failure is
   * cheap: the next one is a minute away and reads the same rows.
   */
  private async tick(): Promise<{ enqueued: number }> {
    const now = this.clock.now();
    const due = await this.catalog.dueProviders(now);

    for (const item of due) {
      await this.queue.add(
        CATALOG_JOBS.SYNC,
        { providerId: item.providerId, mode: item.mode, requestedBy: 'schedule' },
        {
          /*
           * An explicit jobId derived from the work's natural key (§13.2), so
           * enqueueing the same work twice is a no-op rather than a duplicate.
           *
           * The minute bucket is what makes it a natural key: without it the
           * id would be identical forever and the *second* legitimate sync an
           * hour later would be silently dropped as a duplicate.
           *
           * Separated by `_` and not `:`. BullMQ builds its Redis keys as
           * `bull:<queue>:<id>` and rejects a custom id containing a colon —
           * which throws inside the tick, so a colon here would mean no
           * scheduled sync ever runs.
           */
          jobId: buildSyncJobId(item.providerId, item.mode, now),
        },
      );
    }

    if (due.length > 0) {
      this.logger.log({ enqueued: due.length }, 'Catalog syncs enqueued');
    }

    return { enqueued: due.length };
  }

  /**
   * Runs one provider's sync.
   *
   * `CatalogSyncService.sync` records its own failures and returns a run
   * rather than throwing, so an unreachable provider does not burn BullMQ
   * retries on a condition retrying cannot fix within the backoff window —
   * the health counter and the recorded run are the durable signal, and the
   * next tick will try again anyway.
   */
  private async runSync(job: Job<CatalogSyncJobData>): Promise<{ runId: string; outcome: string }> {
    const { providerId, mode, requestedBy } = job.data;

    const run = await this.catalog.sync(providerId, mode);

    this.logger.log(
      { providerId, mode, requestedBy, runId: run.id, outcome: run.outcome },
      'Catalog sync job finished',
    );

    return { runId: run.id, outcome: run.outcome };
  }
}

/** Minutes since the epoch — the window that makes a repeated enqueue idempotent. */
function minuteBucket(now: Date): number {
  return Math.floor(now.getTime() / 60_000);
}

/**
 * The natural key of one scheduled sync.
 *
 * Contains no `:` — BullMQ composes its Redis keys as `bull:<queue>:<id>` and
 * refuses a custom id with a colon in it. The refusal is an exception thrown
 * inside the tick, so the failure mode is not "a duplicate job" but "no
 * scheduled sync ever runs".
 */
function buildSyncJobId(providerId: string, mode: string, now: Date): string {
  return `${CATALOG_JOBS.SYNC}_${providerId}_${mode}_${minuteBucket(now)}`;
}

export const __testing = { minuteBucket, buildSyncJobId, TICK_INTERVAL_MS };
