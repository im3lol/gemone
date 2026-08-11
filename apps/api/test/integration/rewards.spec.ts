import { Test } from '@nestjs/testing';
import {
  REWARD_SOURCE_TYPES,
  REWARD_TRANSACTION_TYPES,
  ERROR_CODES,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { RewardAccountingService } from '../../src/modules/rewards/reward-accounting.service';
import { REWARDS_HOLD_PERIOD_DAYS } from '../../src/modules/rewards/rewards.config';
import { UsersService } from '../../src/modules/users/users.service';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * Reward accounting against a real Postgres — ARCHITECTURE.md §9, §18.3.
 *
 * Everything that makes this service correct is a property of the database:
 * `SELECT ... FOR UPDATE`, one transaction per mutation, and the invariant
 * that a balance equals the sum of its history. None of the three can be
 * tested with a mocked client — a mock cannot lose a race, and losing races is
 * the entire risk (PROJECT.md R4).
 */
describe('reward accounting (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let rewards: RewardAccountingService;
  let users: UsersService;
  let configuration: ConfigurationService;

  let counter = 0;
  const nextEmail = () => `reward-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    rewards = moduleRef.get(RewardAccountingService);
    users = moduleRef.get(UsersService);
    configuration = moduleRef.get(ConfigurationService);
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
    // Pinned to the rate these expectations were written against. The shipped
    // default changed from 1 to 10 when it was found to pay users a tenth of
    // the configured revenue share; what these tests check is mechanics, not
    // the launch economics, so they set the rate they depend on.
    await configuration.set(OFFERS_POINTS_PER_MINOR_UNIT.key, 1, {
      actor: { type: 'system' },
    });
  });

  async function createUser() {
    return users.create({ email: nextEmail(), passwordHash: 'not-a-real-hash' });
  }

  const conversionSource = (id = 'conv-1') => ({
    type: REWARD_SOURCE_TYPES.CONVERSION,
    id,
  });

  /** Every test ends here. The invariant is the feature. */
  async function expectBalanced(userId: string) {
    const result = await rewards.reconcile(userId);

    expect(result.drift).toEqual({ pending: 0, available: 0, locked: 0 });
    expect(result.balanced).toBe(true);

    return result;
  }

  // --- The row exists before anything needs it -----------------------------

  describe('opening an account', () => {
    it('creates the balance row with the user, not on first credit', async () => {
      const user = await createUser();

      /*
       * DATABASE.md §3.5: "A missing balance row during a credit is an error
       * path nobody tests; an always-present zero row is one less branch."
       */
      const balance = await rewards.getBalance(user.id);
      expect(balance).toMatchObject({ pending: 0, available: 0, locked: 0, total: 0 });

      expect(await prisma.userBalance.count({ where: { userId: user.id } })).toBe(1);
    });

    it('rolls the balance back with the user when registration fails', async () => {
      const email = nextEmail();
      await users.create({ email, passwordHash: 'not-a-real-hash' });

      // The second registration loses on the unique constraint. Its balance
      // insert must go with it — a balance row for a user that does not exist
      // is a row nothing will ever clean up.
      await expect(
        users.create({ email, passwordHash: 'not-a-real-hash' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.AUTH_EMAIL_TAKEN });

      expect(await prisma.userBalance.count()).toBe(1);
    });

    it('refuses to move points for a user that has no balance', async () => {
      // Not "create one silently": the missing row is the only evidence that
      // something else went wrong, and a credit for a non-existent user should
      // not be the thing that succeeds.
      await expect(
        rewards.credit({
          userId: '0192f0a0-0000-7000-8000-0000000000aa',
          amountPoints: 10,
          source: conversionSource(),
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.USER_NOT_FOUND });
    });
  });

  // --- Crediting -----------------------------------------------------------

  describe('credit', () => {
    it('lands in pending, never in available', async () => {
      const user = await createUser();

      await rewards.credit({
        userId: user.id,
        amountPoints: 171,
        source: conversionSource(),
        holdScopeProviderId: null,
      });

      const balance = await rewards.getBalance(user.id);

      // §9.3: credited points are inside their hold period. A credit that
      // landed in `available` would be withdrawable before the provider could
      // charge it back.
      expect(balance.pending).toBe(171);
      expect(balance.available).toBe(0);
      expect(balance.lifetimeEarned).toBe(171);

      await expectBalanced(user.id);
    });

    it('stores the resolved hold period rather than a reference to it', async () => {
      const user = await createUser();
      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 7, { actor: { type: 'system' } });

      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      expect(credit.holdPeriodDays).toBe(7);
      const originalMaturity = credit.maturesAt;

      /*
       * §9.4, the whole point of storing it: an admin changing the hold period
       * must not retroactively re-hold points a user was already told are
       * available, nor release points early. The maturation job reads this
       * stored value and never re-resolves configuration.
       */
      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 90, { actor: { type: 'system' } });

      const stored = await prisma.rewardTransaction.findUniqueOrThrow({
        where: { id: credit.id },
      });
      expect(stored.holdPeriodDays).toBe(7);
      expect(stored.maturesAt?.toISOString()).toBe(originalMaturity);
    });

    it('resolves the hold period per provider', async () => {
      const user = await createUser();
      const provider = await prisma.provider.create({
        data: { id: uuidv7(), slug: 'mock', displayName: 'Mock Offerwall' },
      });

      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 30, { actor: { type: 'system' } });
      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 3, {
        scope: 'PROVIDER',
        scopeId: provider.id,
        actor: { type: 'system' },
      });

      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
        holdScopeProviderId: provider.id,
      });

      // The risk a hold prices is per provider: a network that charges back
      // three weeks later needs a longer hold than one that confirms in hours.
      expect(credit.holdPeriodDays).toBe(3);
    });

    it('holds indefinitely when asked, with no maturity date at all', async () => {
      const user = await createUser();

      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
        holdIndefinitely: true,
      });

      /*
       * §10.3 step 7's hold, expressed structurally: no clock will ever make
       * these points withdrawable, because there is no date for one to pass.
       * A far-future date would have been a lie with an expiry.
       */
      expect(credit.maturesAt).toBeNull();
      expect(credit.holdPeriodDays).toBeNull();
      expect((await rewards.getBalance(user.id)).pending).toBe(100);
    });

    it('refuses a non-positive amount', async () => {
      const user = await createUser();

      await expect(
        rewards.credit({ userId: user.id, amountPoints: 0, source: conversionSource() }),
      ).rejects.toThrow();
      await expect(
        rewards.credit({ userId: user.id, amountPoints: -5, source: conversionSource() }),
      ).rejects.toThrow();
    });
  });

  // --- Maturation ----------------------------------------------------------

  describe('maturation', () => {
    async function creditMaturingNow(userId: string, amount: number) {
      const credit = await rewards.credit({
        userId,
        amountPoints: amount,
        source: conversionSource(`conv-${amount}`),
      });

      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });

      return credit;
    }

    it('moves points from pending to available', async () => {
      const user = await createUser();
      const credit = await creditMaturingNow(user.id, 171);

      await rewards.mature(credit.id);
      const balance = await rewards.getBalance(user.id);

      expect(balance.pending).toBe(0);
      expect(balance.available).toBe(171);
      await expectBalanced(user.id);
    });

    it('writes a transaction for the move, so the balance stays explainable', async () => {
      const user = await createUser();
      const credit = await creditMaturingNow(user.id, 100);

      const maturation = await rewards.mature(credit.id);

      /*
       * The reason maturation is a row rather than a flag on the credit
       * (D38). Without it, this is the one balance change with nothing behind
       * it, and reconciliation — the mechanism R4 and R5 both rest on — stops
       * being a sum over history.
       */
      expect(maturation?.type).toBe(REWARD_TRANSACTION_TYPES.REWARD_MATURATION);
      expect(maturation?.amountPoints).toBe(0);
      expect(maturation?.pendingDelta).toBe(-100);
      expect(maturation?.availableDelta).toBe(100);
      expect(maturation?.sourceTransactionId).toBe(credit.id);
    });

    it('is idempotent — a job may always run twice', async () => {
      const user = await createUser();
      const credit = await creditMaturingNow(user.id, 100);

      await rewards.mature(credit.id);
      const second = await rewards.mature(credit.id);

      expect(second).toBeNull();
      expect((await rewards.getBalance(user.id)).available).toBe(100);
      await expectBalanced(user.id);
    });

    it('never matures a credit that was charged back first', async () => {
      const user = await createUser();
      const credit = await creditMaturingNow(user.id, 100);

      await rewards.reverse(credit.id, 'chargeback');
      const matured = await rewards.mature(credit.id);

      /*
       * The points are already gone from `pending`. Maturing anyway would
       * move them to `available` a second time — inventing withdrawable points
       * out of a credit that had been taken back.
       */
      expect(matured).toBeNull();
      expect(await rewards.getBalance(user.id)).toMatchObject({ pending: 0, available: 0 });
      await expectBalanced(user.id);
    });

    it('never picks up a credit held indefinitely', async () => {
      const user = await createUser();
      await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
        holdIndefinitely: true,
      });

      // A null maturity is excluded by the comparison itself, which is exactly
      // what an indefinite hold means.
      expect(await rewards.findMaturable(new Date(Date.now() + 86_400_000_000), 100)).toEqual(
        [],
      );
    });

    it('does not pick up a credit before its hold has elapsed', async () => {
      const user = await createUser();
      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 14, { actor: { type: 'system' } });
      await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      expect(await rewards.findMaturable(new Date(Date.now()), 100)).toEqual([]);
    });

    it('finds exactly the credits that are due', async () => {
      const user = await createUser();
      const due = await creditMaturingNow(user.id, 50);
      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 30, { actor: { type: 'system' } });
      await rewards.credit({ userId: user.id, amountPoints: 60, source: conversionSource('b') });

      expect(await rewards.findMaturable(new Date(Date.now()), 100)).toEqual([due.id]);
    });
  });

  // --- Chargebacks ---------------------------------------------------------

  describe('reverse', () => {
    it('takes from pending first', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      const reversal = await rewards.reverse(credit.id, 'chargeback');

      // Those points were never withdrawable, so taking them back costs the
      // user nothing they had been told was theirs (§9.5).
      expect(reversal.pendingDelta).toBe(-100);
      expect(reversal.availableDelta).toBe(0);
      expect(await rewards.getBalance(user.id)).toMatchObject({ pending: 0, available: 0 });
      await expectBalanced(user.id);
    });

    it('falls through to available when pending is short', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });
      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await rewards.mature(credit.id);

      const reversal = await rewards.reverse(credit.id, 'late chargeback');

      expect(reversal.pendingDelta).toBe(0);
      expect(reversal.availableDelta).toBe(-100);
      await expectBalanced(user.id);
    });

    it('drives the balance negative rather than clamping it', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });
      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await rewards.mature(credit.id);

      // Spend them, so the chargeback has nothing to take.
      await rewards.lock(user.id, 100, 'payout-1');

      const reversal = await rewards.reverse(credit.id, 'chargeback after payout');
      const balance = await rewards.getBalance(user.id);

      /*
       * §9.5: "if both are exhausted the balance goes negative rather than
       * being clamped. **A clamped balance is a silently lost debt.**" The
       * money left, and a zero here would say it had not — so the next credit
       * would quietly pay off a debt nobody could see.
       *
       * `locked` is untouched: those points are reserved for a payout an admin
       * may be about to send, and taking them back under it would leave the
       * payout unfunded without the payout knowing.
       */
      expect(balance.available).toBe(-100);
      expect(balance.locked).toBe(100);
      expect(reversal.lockedDelta).toBe(0);
      await expectBalanced(user.id);
    });

    it('refuses to reverse the same credit twice', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      await rewards.reverse(credit.id, 'chargeback');

      // Twice would take the points away twice, for one event.
      await expect(rewards.reverse(credit.id, 'again')).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INVALID_OPERATION,
      });
      await expectBalanced(user.id);
    });

    it('refuses to reverse something that never added points', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });
      const reversal = await rewards.reverse(credit.id, 'chargeback');

      // Reversing a debit is a credit, and a credit dressed as a reversal is
      // how points appear with no reason attached.
      await expect(rewards.reverse(reversal.id, 'undo')).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INVALID_OPERATION,
      });
    });

    it('reports an unknown reference rather than doing nothing', async () => {
      await expect(
        rewards.reverse('0192f0a0-0000-7000-8000-0000000000aa', 'x'),
      ).rejects.toMatchObject({ code: ERROR_CODES.REWARD_TRANSACTION_NOT_FOUND });
    });
  });

  // --- The payout seam -----------------------------------------------------

  describe('locking for a payout', () => {
    async function userWithAvailable(amount: number) {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: amount,
        source: conversionSource(),
      });
      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await rewards.mature(credit.id);

      return user;
    }

    it('moves available to locked', async () => {
      const user = await userWithAvailable(500);

      await rewards.lock(user.id, 200, 'payout-1');
      const balance = await rewards.getBalance(user.id);

      expect(balance.available).toBe(300);
      expect(balance.locked).toBe(200);
      await expectBalanced(user.id);
    });

    it('locks only available points, never pending', async () => {
      const user = await createUser();
      await rewards.credit({
        userId: user.id,
        amountPoints: 500,
        source: conversionSource(),
      });

      /*
       * §11.2: "only `available` points are lockable". Pending points are
       * inside their hold period — a withdrawal that could reach them would be
       * paying out money the provider can still charge back.
       */
      await expect(rewards.lock(user.id, 100, 'payout-1')).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INSUFFICIENT_BALANCE,
      });
      await expectBalanced(user.id);
    });

    it('settles a lock by consuming it', async () => {
      const user = await userWithAvailable(500);
      const lock = await rewards.lock(user.id, 200, 'payout-1');

      const settle = await rewards.settleLock(lock.id, 'paid externally');
      const balance = await rewards.getBalance(user.id);

      expect(balance.locked).toBe(0);
      expect(balance.available).toBe(300);
      expect(settle.amountPoints).toBe(-200);
      expect(balance.lifetimeWithdrawn).toBe(200);
      await expectBalanced(user.id);
    });

    it('releases a lock back to available', async () => {
      const user = await userWithAvailable(500);
      const lock = await rewards.lock(user.id, 200, 'payout-1');

      await rewards.releaseLock(lock.id, 'rejected by an admin');
      const balance = await rewards.getBalance(user.id);

      expect(balance.locked).toBe(0);
      expect(balance.available).toBe(500);
      await expectBalanced(user.id);
    });

    it('refuses to resolve one lock twice', async () => {
      const user = await userWithAvailable(500);
      const lock = await rewards.lock(user.id, 200, 'payout-1');

      await rewards.settleLock(lock.id, 'paid');

      // Settling twice consumes points reserved once; refunding after settling
      // invents them. Both are money.
      await expect(rewards.settleLock(lock.id, 'paid again')).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INVALID_OPERATION,
      });
      await expect(rewards.releaseLock(lock.id, 'refund')).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INVALID_OPERATION,
      });
      await expectBalanced(user.id);
    });
  });

  // --- The risk this whole design is arranged around -----------------------

  describe('concurrency (PROJECT.md R4)', () => {
    it('loses no credit when twenty arrive at once', async () => {
      const user = await createUser();

      /*
       * **The test the row lock exists for.**
       *
       * A read-modify-write without `SELECT ... FOR UPDATE` loses updates here
       * — every caller reads the same balance and writes back its own total,
       * and the last writer wins. That is not a rare race: it is what happens
       * whenever a user converts twice in the same instant, which multi-step
       * offers do routinely.
       */
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          rewards.credit({
            userId: user.id,
            amountPoints: 10,
            source: conversionSource(`conv-${index}`),
          }),
        ),
      );

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(200);
      expect(balance.lifetimeEarned).toBe(200);

      const result = await expectBalanced(user.id);
      expect(result.transactionCount).toBe(20);
    });

    it('never lets two concurrent locks overdraw one balance', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });
      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await rewards.mature(credit.id);

      // Ten withdrawals of 100 against a balance of 100. Exactly one may win.
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          rewards.lock(user.id, 100, `payout-${index}`),
        ),
      );

      const succeeded = outcomes.filter((o) => o.status === 'fulfilled');
      expect(succeeded).toHaveLength(1);

      const balance = await rewards.getBalance(user.id);
      expect(balance.available).toBe(0);
      expect(balance.locked).toBe(100);
      await expectBalanced(user.id);
    });

    it('survives a mixed storm of credits, maturations and reversals', async () => {
      const user = await createUser();

      const credits = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          rewards.credit({
            userId: user.id,
            amountPoints: 25,
            source: conversionSource(`mixed-${index}`),
          }),
        ),
      );

      await prisma.rewardTransaction.updateMany({
        where: { id: { in: credits.map((c) => c.id) } },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });

      // Mature half and reverse the other half, all at once, in an order
      // nobody chose.
      await Promise.allSettled([
        ...credits.slice(0, 5).map((c) => rewards.mature(c.id)),
        ...credits.slice(5).map((c) => rewards.reverse(c.id, 'chargeback')),
      ]);

      const balance = await rewards.getBalance(user.id);

      expect(balance.available).toBe(125);
      expect(balance.pending).toBe(0);
      await expectBalanced(user.id);
    });
  });

  // --- Reconciliation ------------------------------------------------------

  describe('reconciliation', () => {
    it('reports drift rather than repairing it', async () => {
      const user = await createUser();
      await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      // Corrupt the balance behind the service's back — the shape a lost
      // update would leave.
      await prisma.userBalance.update({
        where: { userId: user.id },
        data: { availablePoints: 999 },
      });

      const result = await rewards.reconcile(user.id);

      expect(result.balanced).toBe(false);
      expect(result.drift.available).toBe(999);

      /*
       * PROJECT.md R5: "If reconciliation reports any unexplained drift in
       * production, **that is the signal to migrate — not a bug to patch**."
       * Silently correcting the row would destroy the only evidence that the
       * simple balance model had failed, which is the evidence the P2 decision
       * is meant to be made on.
       */
      const after = await prisma.userBalance.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(after.availablePoints).toBe(999);
    });

    it('balances a user with no history at all', async () => {
      const user = await createUser();
      await expectBalanced(user.id);
    });
  });

  // --- The statement -------------------------------------------------------

  describe('history', () => {
    it('returns movements newest first, filterable by type', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });
      await rewards.reverse(credit.id, 'chargeback');

      const all = await rewards.getHistory(user.id);
      expect(all.total).toBe(2);
      expect(all.items[0]!.type).toBe(REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT);

      const credits = await rewards.getHistory(user.id, {
        type: REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
      });
      expect(credits.total).toBe(1);
    });

    it('shows one user nothing of another', async () => {
      const mine = await createUser();
      const theirs = await createUser();

      await rewards.credit({
        userId: theirs.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      expect((await rewards.getHistory(mine.id)).total).toBe(0);
    });

    it('carries the name the caller gave the source, and gives it to the movements that act on it', async () => {
      const user = await createUser();

      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: { ...conversionSource('conv-labelled'), label: 'Quick Survey' },
      });

      // Recorded at write time. There is nothing to join to — `sourceId`
      // carries no foreign key and this module knows nothing about
      // conversions (P2) — so the caller that moved the points supplied it.
      expect(credit.sourceLabel).toBe('Quick Survey');

      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });

      // A maturation and a chargeback are the same offer's story continuing.
      // Without the copy, a statement reads "Points cleared" with no
      // indication of which points.
      const maturation = await rewards.mature(credit.id);
      expect(maturation?.sourceLabel).toBe('Quick Survey');

      const reversal = await rewards.reverse(credit.id, 'chargeback');
      expect(reversal.sourceLabel).toBe('Quick Survey');
    });

    it('leaves the name null when the caller had none to give', async () => {
      const user = await createUser();

      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      // Null is the honest answer, and the reason nothing backfills it: the
      // only name that would be recoverable is today's offer title, which is
      // not what the user was shown.
      expect(credit.sourceLabel).toBeNull();
    });

    it('lets a caller name a different source than the one it is acting on', async () => {
      const user = await createUser();

      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: { ...conversionSource('conv-a'), label: 'Original offer' },
      });

      const reversal = await rewards.reverse(credit.id, 'chargeback', {
        source: { type: REWARD_SOURCE_TYPES.CONVERSION, id: 'conv-b', label: 'Something else' },
      });

      expect(reversal.sourceLabel).toBe('Something else');
    });

    it('finds the movement a given source caused', async () => {
      const user = await createUser();
      await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource('conv-xyz'),
      });

      const found = await rewards.findBySource(
        REWARD_SOURCE_TYPES.CONVERSION,
        'conv-xyz',
        REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
      );

      expect(found?.amountPoints).toBe(100);
    });
  });

  // --- Append-only ---------------------------------------------------------

  describe('the history is append-only', () => {
    it('records an action on an earlier movement as a new row pointing at it', async () => {
      const user = await createUser();
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: 100,
        source: conversionSource(),
      });

      await rewards.reverse(credit.id, 'chargeback');

      /*
       * Nothing is ever marked, flagged or settled in place. "Has this credit
       * been charged back?" is answered by the existence of a child row —
       * which is what lets the table have no `updated_at` at all, and an
       * `updated_at` on an append-only table is a lie that invites someone to
       * write to it (DATABASE.md §8).
       */
      const original = await prisma.rewardTransaction.findUniqueOrThrow({
        where: { id: credit.id },
      });
      expect(original.amountPoints).toBe(100);

      const children = await prisma.rewardTransaction.findMany({
        where: { sourceTransactionId: credit.id },
      });
      expect(children).toHaveLength(1);
      expect(children[0]!.type).toBe(REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT);
    });

    it('has no updated_at column to write to', async () => {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'reward_transactions'`;

      expect(columns.map((c) => c.column_name)).not.toContain('updated_at');
    });
  });
});
