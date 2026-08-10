import { Test } from '@nestjs/testing';
import { REWARD_SOURCE_TYPES } from '@gemone/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { ReconciliationProcessor } from '../../src/jobs/reconciliation.processor';
import { RewardAccountingService } from '../../src/modules/rewards/reward-accounting.service';
import { RECONCILIATION_BATCH_SIZE } from '../../src/modules/rewards/rewards.config';
import { UsersService } from '../../src/modules/users/users.service';

/**
 * The nightly reconciliation against a real ledger — §12.1, PROJECT.md R4/R5.
 *
 * The unit tests cover the sweep's control flow with a mocked service. What
 * cannot be mocked is the thing this job exists for: that a balance which
 * disagrees with its own recorded history is actually *found*. That needs a
 * real row, corrupted the way the failure would corrupt it — a balance written
 * without the transaction that explains it — and a real aggregate over real
 * history to catch it.
 */
describe('nightly reconciliation (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let rewards: RewardAccountingService;
  let users: UsersService;
  let configuration: ConfigurationService;
  let processor: ReconciliationProcessor;

  let counter = 0;
  const nextEmail = () => `recon-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    rewards = moduleRef.get(RewardAccountingService);
    users = moduleRef.get(UsersService);
    configuration = moduleRef.get(ConfigurationService);

    /*
     * Constructed directly rather than resolved from `WorkerModule`.
     *
     * The processor's only collaborators are the queue and the service, and
     * booting the worker here would register a real repeatable job against the
     * shared Redis for every run of this file. `sweep()` is the whole job —
     * `process()` is a name check in front of it — so driving it directly tests
     * the same code without leaving a schedule behind.
     */
    processor = new ReconciliationProcessor(
      { add: async () => undefined } as never,
      rewards,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await prisma.payoutRequest.deleteMany();
    await prisma.rewardTransaction.deleteMany();
    await prisma.userBalance.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.fraudEvaluation.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.provider.deleteMany();
    configuration.invalidateAll();
  });

  async function createUser() {
    return users.create({ email: nextEmail(), passwordHash: 'not-a-real-hash' });
  }

  async function creditedUser(points: number) {
    const user = await createUser();
    await rewards.credit({
      userId: user.id,
      amountPoints: points,
      source: { type: REWARD_SOURCE_TYPES.CONVERSION, id: `conv-${user.id}` },
    });
    return user;
  }

  /**
   * Drift, created the only way it can happen: the balance row moves without a
   * transaction explaining it.
   *
   * This is what a lost update, a bad manual `UPDATE`, or a bug in a future
   * mutation path would leave behind — and it is invisible to every other test
   * in the suite, because every other test goes through the service.
   */
  async function corruptBalance(userId: string, byPoints: number) {
    await prisma.userBalance.update({
      where: { userId },
      data: { pendingPoints: { increment: byPoints } },
    });
  }

  it('reports a clean ledger as clean', async () => {
    await creditedUser(100);
    await creditedUser(250);

    const result = await processor.sweep(null);

    expect(result).toMatchObject({ checked: 2, drifted: 0, failed: 0, complete: true });
  });

  it('finds a balance its history cannot explain', async () => {
    const honest = await creditedUser(100);
    const drifted = await creditedUser(250);
    await corruptBalance(drifted.id, 70);

    const result = await processor.sweep(null);

    expect(result.checked).toBe(2);
    expect(result.drifted).toBe(1);

    // And it is the corrupted one, not merely "one of them".
    await expect(rewards.reconcile(drifted.id)).resolves.toMatchObject({ balanced: false });
    await expect(rewards.reconcile(honest.id)).resolves.toMatchObject({ balanced: true });
  });

  it('leaves the drifted balance exactly as it found it', async () => {
    /*
     * PROJECT.md R5: drift is "the signal to migrate — not a bug to patch".
     * Repairing the row here would erase the evidence the P2 decision is
     * supposed to be made on, so the sweep must be observably read-only.
     */
    const user = await creditedUser(250);
    await corruptBalance(user.id, 70);

    const before = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } });
    await processor.sweep(null);
    const after = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } });

    expect(after.pendingPoints).toBe(before.pendingPoints);
    expect(after.availablePoints).toBe(before.availablePoints);
    expect(after.lockedPoints).toBe(before.lockedPoints);
    expect(after.version).toBe(before.version);
  });

  it('covers every balance, including one a full first page would have hidden', async () => {
    /*
     * The completeness property, and the reason the cursor is a unique key.
     *
     * A sweep that silently stops after one page reports "all clear" for
     * accounts it never opened, which is worse than not running at all. Enough
     * users to fill a page and spill over, with the drift planted in the
     * spill — so a single-page sweep passes and a complete one does not.
     */
    const users = [];
    for (let index = 0; index < RECONCILIATION_BATCH_SIZE + 3; index += 1) {
      users.push(await creditedUser(10));
    }

    const ordered = await rewards.findUsersToReconcile(null, RECONCILIATION_BATCH_SIZE + 10);
    const beyondTheFirstPage = ordered[RECONCILIATION_BATCH_SIZE + 1];
    expect(beyondTheFirstPage).toBeDefined();
    await corruptBalance(beyondTheFirstPage, 5);

    // Walk the chain the queue would walk.
    let after: string | null = null;
    let checked = 0;
    let drifted = 0;

    for (;;) {
      const page = await processor.sweep(after);
      checked += page.checked;
      drifted += page.drifted;
      if (page.complete) break;
      after = (await rewards.findUsersToReconcile(after, RECONCILIATION_BATCH_SIZE)).at(-1) ?? null;
    }

    expect(checked).toBe(users.length);
    expect(drifted).toBe(1);
  });

  it('pages by a unique key, so no balance is repeated or skipped', async () => {
    for (let index = 0; index < 5; index += 1) await creditedUser(10);

    const all = await rewards.findUsersToReconcile(null, 100);
    const firstTwo = await rewards.findUsersToReconcile(null, 2);
    const rest = await rewards.findUsersToReconcile(firstTwo.at(-1) ?? null, 100);

    expect([...firstTwo, ...rest]).toEqual(all);
    expect(new Set([...firstTwo, ...rest]).size).toBe(all.length);
  });

  it('never reports drift on a ledger that is only being written to', async () => {
    /*
     * The false-positive regression.
     *
     * A balance and the history explaining it must be read as of one instant.
     * Read under separate snapshots, a credit committing between the two reads
     * lands on one side and not the other, and this reports drift on a ledger
     * that is perfectly consistent — which, per R5, is the signal to migrate
     * the whole accounting model. The evidence has to be trustworthy before the
     * sweep that produces it is worth running.
     *
     * Writers and readers overlap deliberately: the window only exists while a
     * commit lands between the two reads, so a lockstep loop misses it almost
     * every time. This shape reproduced ~70 false positives per run against a
     * non-transactional read and zero against a snapshot.
     */
    const user = await createUser();

    const falsePositives: unknown[] = [];
    let writing = true;

    const writer = (async () => {
      for (let index = 0; writing && index < 4000; index += 1) {
        await rewards.credit({
          userId: user.id,
          amountPoints: 1,
          source: { type: REWARD_SOURCE_TYPES.CONVERSION, id: `settle-${index}` },
        });
      }
    })();

    const readers = Array.from({ length: 8 }, () =>
      (async () => {
        for (let index = 0; index < 400; index += 1) {
          const report = await rewards.reconcile(user.id);
          if (!report.balanced) falsePositives.push(report.drift);
        }
      })(),
    );

    await Promise.all(readers);
    writing = false;
    await writer;

    // The ledger really is consistent, so every report above should have said
    // so. This assertion is what makes the ones above false *positives* rather
    // than a detector doing its job.
    await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });

    expect(falsePositives).toEqual([]);
  });
});
