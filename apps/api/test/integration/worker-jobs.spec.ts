import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SYNC_MODES, SYNC_OUTCOMES } from '@gemone/contracts';
import type { Job, Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { CATALOG_JOBS, QUEUES } from '../../src/core/queue/queue.constants';
import { CLOCK, FixedClock } from '../../src/core/time/clock';
import { CatalogSyncProcessor } from '../../src/jobs/catalog-sync.processor';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { WorkerModule } from '../../src/worker.module';

/**
 * The scheduled path, against a real Redis and a real Postgres.
 *
 * Everything up to here tests the sync framework directly. This tests the part
 * that makes it *happen*: a repeatable tick, a queue, and a consumer that only
 * the worker process loads. Those three are exactly where a silent failure
 * lives — a job nobody consumes and a schedule nobody registered both look
 * like "the catalog just stopped updating".
 */
/** Shared with the module-scope helpers below. */
let catalogQueue: Queue;

describe('catalog jobs (integration)', () => {
  let worker: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let processor: CatalogSyncProcessor;
  let sync: CatalogSyncService;
  let queue: Queue;

  const catalogSync = (mode: (typeof SYNC_MODES)[keyof typeof SYNC_MODES]) =>
    sync.sync(providerId, mode);

  let providerId: string;

  /**
   * Captured at boot, before `beforeEach` can clear the queue.
   *
   * `obliterate` removes job schedulers along with jobs, so reading them later
   * would only ever prove that the cleanup worked. The claim under test is
   * that *bootstrap* registered the schedule.
   */
  let schedulersAtBoot: string[];

  beforeAll(async () => {
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      /*
       * The job id that makes a repeated tick idempotent is bucketed by the
       * minute, so two ticks either side of a boundary legitimately produce
       * two ids — and the assertion below would fail once an hour, for a
       * reason that has nothing to do with the code.
       *
       * This is precisely what `Clock` was introduced for: time is an input,
       * so a test that depends on it supplies one.
       */
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(new Date('2026-08-02T12:00:00.000Z')))
      .compile();
    await worker.init();

    prisma = worker.get(PrismaService);
    providers = worker.get(ProvidersService);
    processor = worker.get(CatalogSyncProcessor);
    sync = worker.get(CatalogSyncService);
    queue = worker.get<Queue>(getQueueToken(QUEUES.CATALOG));
    catalogQueue = queue;

    schedulersAtBoot = (await queue.getJobSchedulers()).map((scheduler) => scheduler.key);
    await processor.worker.waitUntilReady();

    /*
     * Both the repeating schedule and the consumer are shut down for this file.
     *
     * Bootstrap starts a live worker and a tick that fires immediately, and
     * leaving either running makes every assertion here a race: a scheduled
     * sync writes offer rows while `beforeEach` is deleting providers, and a
     * job is consumed between the line that enqueues it and the line that
     * inspects it. Retries make it worse — a job that failed 30 seconds ago
     * becomes ready again in the middle of an unrelated test.
     *
     * So the queue is used as a store and the processor is driven directly.
     * What that gives up is proof that BullMQ delivers a job it accepted —
     * BullMQ's own guarantee, verified against the real two-process
     * deployment rather than here. TODO T11 tracks automating that leg with a
     * worker the test owns rather than one the module started.
     */
    await queue.removeJobScheduler(CATALOG_JOBS.TICK).catch(() => undefined);
    await processor.worker.close().catch(() => undefined);
    await quiesce();
  });

  afterAll(async () => {
    // Closed before the queue is cleared, so nothing is mid-job when the keys
    // it is holding disappear.
    await worker?.close();

    // The scheduler lives in Redis and would otherwise outlive the suite,
    // ticking against whatever database the next run points at.
    await queue?.removeJobScheduler(CATALOG_JOBS.TICK).catch(() => undefined);
    await queue?.obliterate({ force: true }).catch(() => undefined);
  });

  beforeEach(async () => {
    await quiesce();
    // Clicks reference users, offers and providers, so they go first.
    await prisma.conversion.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.provider.deleteMany();

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
  });

  describe('process separation', () => {
    it('loads the consumer in the worker', () => {
      expect(worker.get(CatalogSyncProcessor)).toBeDefined();
    });

    it('does NOT load it in the api', async () => {
      const api = await Test.createTestingModule({ imports: [AppModule] }).compile();
      await api.init();

      /*
       * The claim the two entrypoints exist to make: the `api` process can
       * enqueue onto this queue and never picks anything up. If the processor
       * were provided by `AppModule`, a four-minute catalog sync would run on
       * the event loop that is supposed to acknowledge postbacks in
       * milliseconds (§1.2) — and nothing else would notice.
       */
      expect(() => api.get(CatalogSyncProcessor)).toThrow();

      // It can still produce, which is what the admin "sync now" button needs.
      expect(api.get<Queue>(getQueueToken(QUEUES.CATALOG))).toBeDefined();

      await api.close();
    });
  });

  describe('the repeatable tick', () => {
    it('registers a scheduler in Redis rather than an in-process timer', () => {
      /*
       * §12.3. An in-process timer fires once per process, so two worker
       * replicas would run every scheduled sync twice — and for maturation
       * and reconciliation later, twice means wrong. A scheduler in Redis is
       * dispatched once regardless of replica count.
       */
      expect(schedulersAtBoot).toContain(CATALOG_JOBS.TICK);
    });

    it('enqueues one sync per due provider', async () => {
      await processor.process({ name: CATALOG_JOBS.TICK } as Job);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
      const syncs = jobs.filter((job) => job.name === CATALOG_JOBS.SYNC);

      expect(syncs).toHaveLength(1);
      // No full run has happened, so the first must be authoritative.
      expect(syncs[0]!.data).toMatchObject({
        providerId,
        mode: SYNC_MODES.FULL,
        requestedBy: 'schedule',
      });
    });

    it('is idempotent within its window', async () => {
      await processor.process({ name: CATALOG_JOBS.TICK } as Job);
      await processor.process({ name: CATALOG_JOBS.TICK } as Job);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);

      /*
       * The explicit `jobId` derived from the work's natural key (§13.2). A
       * retried or overlapping tick must not double the work — two concurrent
       * full syncs of one provider would race each other's pruning.
       */
      expect(jobs.filter((job) => job.name === CATALOG_JOBS.SYNC)).toHaveLength(1);
    });

    it('enqueues nothing when no provider is due', async () => {
      // A completed full sync also marks the provider synced, so nothing is
      // due again until its interval elapses. Run directly rather than
      // through the queue — what is under test is the tick's decision.
      await catalogSync(SYNC_MODES.FULL);
      await queue.obliterate({ force: true });

      await processor.process({ name: CATALOG_JOBS.TICK } as Job);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
      expect(jobs.filter((job) => job.name === CATALOG_JOBS.SYNC)).toHaveLength(0);
    });

    it('refuses a job name nobody handles', async () => {
      // Otherwise an unknown job is marked completed, which is the quietest
      // possible way for scheduled work to stop happening.
      await expect(
        processor.process({ name: 'catalog-something-else' } as Job),
      ).rejects.toThrow(/Unknown catalog job/);
    });
  });

  describe('the enqueued job', () => {
    it('is the one that fills the catalog', async () => {
      await processor.process({ name: CATALOG_JOBS.TICK } as Job);

      const [enqueued] = (await queue.getJobs(['waiting', 'delayed'])).filter(
        (job) => job.name === CATALOG_JOBS.SYNC,
      );
      expect(enqueued).toBeDefined();

      // Handed to the processor exactly as BullMQ would hand it over: same
      // name, same payload, same handler.
      const result = await processor.process(enqueued!);

      expect(result).toMatchObject({ outcome: SYNC_OUTCOMES.SUCCESS });
      expect(await prisma.offer.count()).toBe(2);

      const run = await prisma.offerSyncRun.findFirstOrThrow({
        orderBy: { startedAt: 'desc' },
      });
      expect(run.mode).toBe(SYNC_MODES.FULL);
      expect(run.offersAccepted).toBe(2);

      // And the provider's health reflects the work that actually happened.
      const provider = await providers.requireById(providerId);
      expect(provider.lastSuccessfulSyncAt).not.toBeNull();
      expect(provider.consecutiveFailureCount).toBe(0);
    });
  });
});

/** Empties the queue between tests. */
async function quiesce(): Promise<void> {
  await catalogQueue.obliterate({ force: true }).catch(() => undefined);
}
