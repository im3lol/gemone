import { PROCESSOR_METADATA } from '@nestjs/bullmq/dist/bull.constants';
import { describe, expect, it, vi } from 'vitest';

import { MAINTENANCE_JOBS, QUEUES } from '../core/queue/queue.constants';
import { RECONCILIATION_BATCH_SIZE } from '../modules/rewards/rewards.config';
import { ReconciliationProcessor } from './reconciliation.processor';

/**
 * The sweep's control flow, without a queue or a database.
 *
 * What is worth testing here is not the arithmetic — `reconcile` owns that and
 * is tested against a real ledger — but the three decisions this job makes on
 * its own: when to continue, when to stop, and what it refuses to do about
 * drift.
 */

interface Report {
  balanced: boolean;
}

function build(options: {
  pages: string[][];
  reports?: Record<string, Report | Error>;
}) {
  const pages = [...options.pages];

  const rewards = {
    findUsersToReconcile: vi.fn(async () => pages.shift() ?? []),
    reconcile: vi.fn(async (userId: string) => {
      const outcome = options.reports?.[userId] ?? { balanced: true };
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };

  const queue = { add: vi.fn(async () => undefined), upsertJobScheduler: vi.fn() };

  const processor = new ReconciliationProcessor(
    queue as never,
    rewards as never,
  );

  return { processor, rewards, queue };
}

/** A page that fills the batch, so the sweep has a reason to continue. */
const fullPage = (prefix: string) =>
  Array.from({ length: RECONCILIATION_BATCH_SIZE }, (_, index) => `${prefix}-${index}`);

describe('the nightly reconciliation', () => {
  it('reports drift without repairing it', async () => {
    /*
     * PROJECT.md R5: "If reconciliation reports any unexplained drift in
     * production, that is the signal to migrate — not a bug to patch." The
     * service exposes no repair, and this asserts the job never reaches for
     * one — a drifted balance is counted and left exactly as it was.
     */
    const { processor, rewards } = build({
      pages: [['a', 'b', 'c']],
      reports: { b: { balanced: false } },
    });

    const result = await processor.sweep(null);

    expect(result).toMatchObject({ checked: 3, drifted: 1, failed: 0 });
    expect(Object.keys(rewards)).toEqual(['findUsersToReconcile', 'reconcile']);
  });

  it('stops when a page comes back short', async () => {
    const { processor, queue } = build({ pages: [['a', 'b']] });

    const result = await processor.sweep(null);

    expect(result.complete).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('continues from the last user when a page fills', async () => {
    const page = fullPage('u');
    const { processor, queue } = build({ pages: [page] });

    const result = await processor.sweep(null);

    expect(result.complete).toBe(false);
    expect(queue.add).toHaveBeenCalledWith(MAINTENANCE_JOBS.RECONCILIATION, {
      after: page.at(-1),
    });
  });

  it('passes the cursor through to the query', async () => {
    const { processor, rewards } = build({ pages: [[]] });

    await processor.sweep('cursor-user');

    expect(rewards.findUsersToReconcile).toHaveBeenCalledWith(
      'cursor-user',
      RECONCILIATION_BATCH_SIZE,
    );
  });

  it('refuses to continue if a full page did not advance the cursor', async () => {
    /*
     * The infinite-chain guard. `findUsersToReconcile` orders by a unique key,
     * so a full page ending on the cursor it started from means that invariant
     * has broken — and continuing would enqueue the same page forever, one job
     * at a time, until someone noticed the queue.
     */
    const page = fullPage('u');
    page[page.length - 1] = 'stuck';

    const { processor, queue } = build({ pages: [page] });

    const result = await processor.sweep('stuck');

    expect(result.complete).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips a user it cannot reconcile and keeps going', async () => {
    /*
     * One unreadable account must not hide drift on every account after it,
     * which is what aborting the page would do.
     */
    const { processor } = build({
      pages: [['a', 'b', 'c']],
      reports: { b: new Error('row vanished') },
    });

    const result = await processor.sweep(null);

    expect(result).toMatchObject({ checked: 2, failed: 1 });
  });

  it('registers the nightly schedule in UTC, not in the host timezone', async () => {
    /*
     * BullMQ resolves a cron pattern in the *server's* local timezone when none
     * is given, so `0 3 * * *` on a UTC+3 host registers a run at midnight UTC.
     * That shipped once and was caught only by reading the scheduled time back
     * out of Redis — nothing failed. This is the assertion that would have.
     *
     * Without the timezone the hour this job runs is a property of whatever
     * host it was deployed to, and two replicas in different zones disagree
     * about when "nightly" is.
     */
    const { processor, queue } = build({ pages: [[]] });

    await processor.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      MAINTENANCE_JOBS.RECONCILIATION,
      { pattern: '0 3 * * *', tz: 'UTC' },
      { name: MAINTENANCE_JOBS.RECONCILIATION },
    );
  });

  it('stays on the maintenance queue, off the one that carries maturation', async () => {
    /*
     * D69. Reading the decorator's own metadata rather than the source text, so
     * the assertion is about what Nest actually registers.
     *
     * The failure this prevents is a consolidation that looks tidy: moving this
     * onto `rewards` puts a scan of every balance in front of maturation for as
     * long as the scan takes, which is the exact starvation §13.1 separates
     * queues to avoid. Nothing else in the suite notices the move — the unit
     * tests construct the processor directly and the integration test injects
     * its own queue, so both pass either way.
     */
    const metadata = Reflect.getMetadata(PROCESSOR_METADATA, ReconciliationProcessor) as {
      name?: string;
    };

    expect(metadata?.name).toBe(QUEUES.MAINTENANCE);
  });

  it('rejects a job it does not recognise', async () => {
    const { processor } = build({ pages: [[]] });

    await expect(
      processor.process({ name: 'something-else', data: {} } as never),
    ).rejects.toThrow(/Unknown maintenance job/);
  });
});
