import { Test } from '@nestjs/testing';
import {
  ERROR_CODES,
  PAYOUT_STATUSES,
  REWARD_SOURCE_TYPES,
  REWARD_TRANSACTION_TYPES,
} from '@gemone/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { AdminPayoutsService } from '../../src/modules/admin/admin-payouts.service';
import { PayoutsService } from '../../src/modules/payouts/payouts.service';
import {
  PAYOUTS_ENABLED_METHODS,
  PAYOUTS_MAXIMUM_POINTS,
  PAYOUTS_MAX_REQUESTS_PER_DAY,
  PAYOUTS_MINIMUM_POINTS,
  PAYOUTS_POINTS_PER_CURRENCY_UNIT,
} from '../../src/modules/payouts/payouts.config';
import { RewardAccountingService } from '../../src/modules/rewards/reward-accounting.service';
import { UsersService } from '../../src/modules/users/users.service';

/**
 * The withdrawal system against a real Postgres — ARCHITECTURE.md §11, §18.3.
 *
 * Every claim this feature makes is a claim about a transaction: that a lock
 * and a request are created together, that a status change and the money it
 * implies commit together, and that two admins cannot resolve one lock twice.
 * None of the three can be tested with a mocked client.
 *
 * Every test ends by reconciling the balance against its own history. A payout
 * that leaves a balance unexplainable is the failure PROJECT.md R4 exists to
 * prevent, and it is the only assertion here that would catch all of them.
 */
describe('payouts (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let payouts: PayoutsService;
  let adminPayouts: AdminPayoutsService;
  let rewards: RewardAccountingService;
  let users: UsersService;
  let configuration: ConfigurationService;

  let counter = 0;
  const nextEmail = () => `payout-${++counter}.${Date.now()}@example.com`;

  const DESTINATION = 'withdrawals@example.com';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    payouts = moduleRef.get(PayoutsService);
    adminPayouts = moduleRef.get(AdminPayoutsService);
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
    await prisma.adminAuditLog.deleteMany();
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.provider.deleteMany();
    configuration.invalidateAll();
  });

  // --- Building a user who has money to withdraw ---------------------------

  /** Credits and matures, so the points are genuinely `available`. */
  async function userWithAvailable(points: number) {
    const user = await users.create({
      email: nextEmail(),
      passwordHash: 'not-a-real-hash',
    });

    if (points > 0) {
      const credit = await rewards.credit({
        userId: user.id,
        amountPoints: points,
        source: { type: REWARD_SOURCE_TYPES.CONVERSION, id: `conv-${user.id}` },
      });

      await prisma.rewardTransaction.update({
        where: { id: credit.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await rewards.mature(credit.id);
    }

    return user;
  }

  async function createAdmin() {
    const admin = await users.create({
      email: nextEmail(),
      passwordHash: 'not-a-real-hash',
    });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });

    return { adminId: admin.id, ip: '198.51.100.1' };
  }

  const submit = (userId: string, amountPoints = 5000) =>
    payouts.submit({ userId, amountPoints, method: 'paypal', destination: DESTINATION });

  /** Every test ends here. A payout that breaks this broke the ledger. */
  async function expectBalanced(userId: string) {
    const result = await rewards.reconcile(userId);
    expect(result.drift).toEqual({ pending: 0, available: 0, locked: 0 });
  }

  // --- Submission ----------------------------------------------------------

  describe('submitting a withdrawal', () => {
    it('locks the points and creates the request together', async () => {
      const user = await userWithAvailable(10_000);

      const payout = await submit(user.id, 5000);
      const balance = await rewards.getBalance(user.id);

      /*
       * DATABASE.md §10.1: "Lock points → create payout request. A lock without
       * a request strands points; a request without a lock allows
       * double-spend."
       */
      expect(payout.status).toBe(PAYOUT_STATUSES.PENDING_REVIEW);
      expect(balance.available).toBe(5000);
      expect(balance.locked).toBe(5000);

      const stored = await prisma.payoutRequest.findUniqueOrThrow({
        where: { id: payout.id },
      });
      const lock = await rewards.findBySource(REWARD_SOURCE_TYPES.PAYOUT, payout.id);
      expect(stored.lockTransactionId).toBe(lock?.id);

      await expectBalanced(user.id);
    });

    it('locks nothing when the request is refused', async () => {
      const user = await userWithAvailable(10_000);

      await expect(
        payouts.submit({
          userId: user.id,
          amountPoints: 5000,
          method: 'not_a_method',
          destination: DESTINATION,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PAYOUT_METHOD_UNSUPPORTED });

      // There is no state where points are reserved for a request that does
      // not exist.
      expect((await rewards.getBalance(user.id)).locked).toBe(0);
      expect(await prisma.payoutRequest.count()).toBe(0);
      await expectBalanced(user.id);
    });

    it('refuses more than the user has available', async () => {
      const user = await userWithAvailable(1000);
      await configuration.set(PAYOUTS_MINIMUM_POINTS.key, 100, { actor: { type: 'system' } });

      await expect(submit(user.id, 5000)).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INSUFFICIENT_BALANCE,
      });
      await expectBalanced(user.id);
    });

    it('refuses points that are still pending', async () => {
      const user = await users.create({
        email: nextEmail(),
        passwordHash: 'not-a-real-hash',
      });
      await rewards.credit({
        userId: user.id,
        amountPoints: 10_000,
        source: { type: REWARD_SOURCE_TYPES.CONVERSION, id: 'c1' },
      });

      /*
       * §11.2: "only `available` points are lockable". Pending points are
       * inside their hold period — a withdrawal that could reach them would be
       * paying out money the provider can still charge back.
       */
      await expect(submit(user.id, 5000)).rejects.toMatchObject({
        code: ERROR_CODES.REWARD_INSUFFICIENT_BALANCE,
      });
      expect((await rewards.getBalance(user.id)).pending).toBe(10_000);
    });

    it('enforces the configured minimum and maximum', async () => {
      const user = await userWithAvailable(1_000_000);
      await configuration.set(PAYOUTS_MINIMUM_POINTS.key, 2000, { actor: { type: 'system' } });
      await configuration.set(PAYOUTS_MAXIMUM_POINTS.key, 50_000, {
        actor: { type: 'system' },
      });

      await expect(submit(user.id, 1999)).rejects.toMatchObject({
        code: ERROR_CODES.PAYOUT_AMOUNT_OUT_OF_RANGE,
      });
      await expect(submit(user.id, 50_001)).rejects.toMatchObject({
        code: ERROR_CODES.PAYOUT_AMOUNT_OUT_OF_RANGE,
      });
      await expect(submit(user.id, 2000)).resolves.toMatchObject({ amountPoints: 2000 });
    });

    it('enforces the daily request cap', async () => {
      const user = await userWithAvailable(100_000);
      await configuration.set(PAYOUTS_MAX_REQUESTS_PER_DAY.key, 2, {
        actor: { type: 'system' },
      });

      await submit(user.id, 1000);
      await submit(user.id, 1000);

      await expect(submit(user.id, 1000)).rejects.toMatchObject({
        code: ERROR_CODES.PAYOUT_DAILY_LIMIT_REACHED,
        httpStatus: 429,
      });

      // The refused request locked nothing.
      expect((await rewards.getBalance(user.id)).locked).toBe(2000);
      await expectBalanced(user.id);
    });

    it('accepts only methods an admin has enabled', async () => {
      const user = await userWithAvailable(10_000);

      await expect(
        payouts.submit({
          userId: user.id,
          amountPoints: 5000,
          method: 'monero',
          destination: DESTINATION,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PAYOUT_METHOD_UNSUPPORTED });

      /*
       * PROJECT.md §4.6: adding a payment method an admin can settle by hand
       * requires no deployment. One configuration write, and it works.
       */
      await configuration.set(PAYOUTS_ENABLED_METHODS.key, ['paypal', 'monero'], {
        actor: { type: 'system' },
      });

      await expect(
        payouts.submit({
          userId: user.id,
          amountPoints: 5000,
          method: 'monero',
          destination: DESTINATION,
        }),
      ).resolves.toMatchObject({ method: 'monero' });
    });

    it('stores the cash value and the rate it was computed at', async () => {
      const user = await userWithAvailable(10_000);
      await configuration.set(PAYOUTS_POINTS_PER_CURRENCY_UNIT.key, 1000, {
        actor: { type: 'system' },
      });

      const payout = await submit(user.id, 5000);

      expect(payout.cashAmountMinor).toBe(500);
      expect(payout.cashCurrency).toBe('USD');

      /*
       * D42, answering DATABASE.md §13's first open question. Without the
       * stored rate, a payout's cash value cannot be explained once
       * configuration moves — and a user asking "why was my 5000 points worth
       * less than my friend's" has no answer.
       */
      await configuration.set(PAYOUTS_POINTS_PER_CURRENCY_UNIT.key, 5000, {
        actor: { type: 'system' },
      });

      const stored = await prisma.payoutRequest.findUniqueOrThrow({
        where: { id: payout.id },
      });
      expect(stored.pointsPerCurrencyUnit).toBe(1000);
      expect(stored.cashAmountMinor).toBe(500);
    });
  });

  // --- The rules, as the form reads them -----------------------------------

  /**
   * `GET /payouts/options` exists so the withdrawal form stops guessing. The
   * shipped page hard-coded `['paypal']` and could show neither the minimum
   * nor what a point is worth — which is TODO T78, and a contradiction of
   * PROJECT.md §4.6 besides.
   *
   * So what these assert is not that the endpoint returns numbers, but that it
   * returns *the same* numbers submission enforces. Two readings of one
   * configuration key that can disagree is the failure worth testing.
   */
  describe('the configured options', () => {
    it('reports the limits, rate and currency an admin set', async () => {
      await configuration.set(PAYOUTS_MINIMUM_POINTS.key, 2500, { actor: { type: 'system' } });
      await configuration.set(PAYOUTS_MAXIMUM_POINTS.key, 90_000, {
        actor: { type: 'system' },
      });
      await configuration.set(PAYOUTS_POINTS_PER_CURRENCY_UNIT.key, 250, {
        actor: { type: 'system' },
      });

      expect(await payouts.options()).toMatchObject({
        minimumPoints: 2500,
        maximumPoints: 90_000,
        pointsPerCurrencyUnit: 250,
        currency: 'USD',
      });
    });

    it('offers exactly the methods a submission would accept', async () => {
      const user = await userWithAvailable(20_000);

      await configuration.set(PAYOUTS_ENABLED_METHODS.key, ['paypal', 'monero'], {
        actor: { type: 'system' },
      });

      const { methods } = await payouts.options();
      expect(methods).toEqual(['paypal', 'monero']);

      // Every method the form would offer has to survive the next click.
      for (const method of methods) {
        await expect(
          payouts.submit({ userId: user.id, amountPoints: 5000, method, destination: DESTINATION }),
        ).resolves.toMatchObject({ method });
      }
    });

    it('reports a minimum that the same submission refuses to go under', async () => {
      const user = await userWithAvailable(20_000);
      await configuration.set(PAYOUTS_MINIMUM_POINTS.key, 4000, { actor: { type: 'system' } });

      const { minimumPoints } = await payouts.options();

      await expect(
        payouts.submit({
          userId: user.id,
          amountPoints: minimumPoints - 1,
          method: 'paypal',
          destination: DESTINATION,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PAYOUT_AMOUNT_OUT_OF_RANGE });

      await expect(
        payouts.submit({
          userId: user.id,
          amountPoints: minimumPoints,
          method: 'paypal',
          destination: DESTINATION,
        }),
      ).resolves.toMatchObject({ amountPoints: minimumPoints });
    });

    it('quotes the rate a request submitted now would be stamped with', async () => {
      const user = await userWithAvailable(20_000);
      await configuration.set(PAYOUTS_POINTS_PER_CURRENCY_UNIT.key, 400, {
        actor: { type: 'system' },
      });

      const { pointsPerCurrencyUnit, currency } = await payouts.options();
      const payout = await submit(user.id, 8000);

      /*
       * The form multiplies the quoted rate to show "≈ $20.00" before anyone
       * submits. If that arithmetic and the service's disagreed, the page
       * would be quoting a price the system does not honour.
       */
      const stored = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: payout.id } });
      expect(stored.pointsPerCurrencyUnit).toBe(pointsPerCurrencyUnit);
      expect(payout.cashCurrency).toBe(currency);
      expect(payout.cashAmountMinor).toBe(Math.floor((8000 * 100) / pointsPerCurrencyUnit));
    });
  });

  // --- The lifecycle -------------------------------------------------------

  describe('approve then settle', () => {
    it('moves no money on approval', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      const approved = await adminPayouts.approve(payout.id, undefined, admin);
      const balance = await rewards.getBalance(user.id);

      /*
       * §11.3: approval and settlement are two steps because the external
       * payment happens between them. Collapsing them would mark money paid
       * before it was.
       */
      expect(approved.status).toBe(PAYOUT_STATUSES.APPROVED);
      expect(balance.locked).toBe(5000);
      expect(balance.available).toBe(5000);
      await expectBalanced(user.id);
    });

    it('consumes the lock on settlement and records the reference', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      const settled = await adminPayouts.settle(payout.id, 'BANK-REF-99', admin);

      const balance = await rewards.getBalance(user.id);
      expect(settled.status).toBe(PAYOUT_STATUSES.PAID);
      expect(settled.externalReference).toBe('BANK-REF-99');
      expect(balance.locked).toBe(0);
      expect(balance.available).toBe(5000);
      expect(balance.lifetimeWithdrawn).toBe(5000);

      const history = await rewards.getHistory(user.id);
      expect(history.items.map((item) => item.type)).toEqual([
        REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE,
        REWARD_TRANSACTION_TYPES.PAYOUT_LOCK,
        REWARD_TRANSACTION_TYPES.REWARD_MATURATION,
        REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
      ]);

      await expectBalanced(user.id);
    });

    it('refuses to settle a request nobody approved', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      // The transition that would pay money nobody approved.
      await expect(adminPayouts.settle(payout.id, 'REF', admin)).rejects.toMatchObject({
        code: ERROR_CODES.PAYOUT_INVALID_TRANSITION,
      });
      expect((await rewards.getBalance(user.id)).locked).toBe(5000);
    });

    it('refuses to settle the same request twice', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      await adminPayouts.settle(payout.id, 'REF-1', admin);

      // Settling twice consumes points reserved once. The state machine
      // refuses before the lock is even reached.
      await expect(adminPayouts.settle(payout.id, 'REF-2', admin)).rejects.toMatchObject({
        code: ERROR_CODES.PAYOUT_INVALID_TRANSITION,
      });
      expect((await rewards.getBalance(user.id)).available).toBe(5000);
      await expectBalanced(user.id);
    });
  });

  describe('rejection and failure', () => {
    it('returns the points on rejection', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      const rejected = await adminPayouts.reject(payout.id, 'duplicate account', admin);
      const balance = await rewards.getBalance(user.id);

      expect(rejected.status).toBe(PAYOUT_STATUSES.REJECTED);
      expect(rejected.reviewReason).toBe('duplicate account');
      expect(balance.locked).toBe(0);
      expect(balance.available).toBe(10_000);
      await expectBalanced(user.id);
    });

    it('returns the points when an approved payment fails', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      await adminPayouts.markFailed(payout.id, 'bank rejected the transfer', admin);

      const balance = await rewards.getBalance(user.id);
      expect(balance.locked).toBe(0);
      expect(balance.available).toBe(10_000);
      // Not withdrawn — the money never left.
      expect(balance.lifetimeWithdrawn).toBe(0);
      await expectBalanced(user.id);
    });

    it('demands a reason for rejection and for failure', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      /*
       * The user is shown this text. "Rejected" with no explanation is the
       * support ticket the field exists to prevent.
       *
       * Asserted as a validation failure naming the field, not as
       * `PAYOUT_INVALID_TRANSITION`: an admin who left the box empty and an
       * admin who clicked approve on a request a colleague just rejected have
       * different problems, and one error code for both makes them
       * indistinguishable to the client (§15.1).
       */
      await expect(adminPayouts.reject(payout.id, '   ', admin)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        httpStatus: 422,
        fields: [{ field: 'reason' }],
      });

      await adminPayouts.approve(payout.id, undefined, admin);
      await expect(adminPayouts.markFailed(payout.id, undefined, admin)).rejects.toMatchObject(
        { code: ERROR_CODES.VALIDATION_FAILED, fields: [{ field: 'reason' }] },
      );

      // Nothing moved while it was being refused.
      expect((await rewards.getBalance(user.id)).locked).toBe(5000);
      await expectBalanced(user.id);
    });

    it('treats a failed payout as finished', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      await adminPayouts.markFailed(payout.id, 'bank rejected', admin);

      /*
       * D41. Its lock is released and the points may already be spent, so any
       * continuation is a new request with a new lock rather than this one
       * resuming.
       */
      for (const attempt of [
        () => adminPayouts.approve(payout.id, undefined, admin),
        () => adminPayouts.settle(payout.id, 'REF', admin),
        () => adminPayouts.reject(payout.id, 'changed my mind', admin),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: ERROR_CODES.PAYOUT_INVALID_TRANSITION,
        });
      }

      await expectBalanced(user.id);
    });
  });

  // --- Concurrency ---------------------------------------------------------

  describe('two admins at once', () => {
    it('lets exactly one of two concurrent approvals through', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const other = await createAdmin();
      const payout = await submit(user.id, 5000);

      /*
       * Both read `PENDING_REVIEW` and both would pass a check made outside a
       * transaction. `SELECT ... FOR UPDATE` on the request row serialises
       * them, so the loser sees `APPROVED` and the machine refuses it.
       */
      const outcomes = await Promise.allSettled([
        adminPayouts.approve(payout.id, undefined, admin),
        adminPayouts.approve(payout.id, undefined, other),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      await expectBalanced(user.id);
    });

    it('never settles and rejects the same request', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const other = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);

      // One consumes the lock, the other returns it. Both succeeding would
      // pay the user and give them their points back.
      const outcomes = await Promise.allSettled([
        adminPayouts.settle(payout.id, 'REF', admin),
        adminPayouts.markFailed(payout.id, 'bank rejected', other),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

      const balance = await rewards.getBalance(user.id);
      expect(balance.locked).toBe(0);
      expect(balance.available === 5000 || balance.available === 10_000).toBe(true);
      await expectBalanced(user.id);
    });

    it('never lets two concurrent submissions overdraw one balance', async () => {
      const user = await userWithAvailable(5000);
      await configuration.set(PAYOUTS_MAX_REQUESTS_PER_DAY.key, 10, {
        actor: { type: 'system' },
      });

      // Five withdrawals of the full balance. The balance row lock decides.
      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, () => submit(user.id, 5000)),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

      const balance = await rewards.getBalance(user.id);
      expect(balance.available).toBe(0);
      expect(balance.locked).toBe(5000);
      await expectBalanced(user.id);
    });
  });

  // --- The audit trail -----------------------------------------------------

  describe('the audit trail', () => {
    it('records every transition in the same transaction as the money', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, 'looks legitimate', admin);
      await adminPayouts.settle(payout.id, 'BANK-REF-1', admin);

      const entries = await prisma.adminAuditLog.findMany({
        where: { targetId: payout.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((entry) => entry.action)).toEqual([
        'payout.approved',
        'payout.settled',
      ]);
      expect(entries[0]!.adminId).toBe(admin.adminId);
      expect(entries[0]!.before).toMatchObject({ status: PAYOUT_STATUSES.PENDING_REVIEW });
    });

    it('leaves no audit entry behind when a transition is refused', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await expect(adminPayouts.settle(payout.id, 'REF', admin)).rejects.toThrow();

      // The entry is inside the transaction it audits (§10.2, rule 5) — so a
      // refused action leaves no trace claiming it happened.
      expect(await prisma.adminAuditLog.count({ where: { targetId: payout.id } })).toBe(0);
    });

    it('never writes the payment destination into the audit trail', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      await adminPayouts.settle(payout.id, 'BANK-REF-1', admin);

      const entries = await prisma.adminAuditLog.findMany({
        where: { targetId: payout.id },
      });

      // An audit trail holding the secret it audits is a second copy of the
      // secret (§16.4).
      expect(JSON.stringify(entries)).not.toContain(DESTINATION);
    });
  });

  // --- The destination is sensitive ----------------------------------------

  describe('the payment destination', () => {
    it('is masked for the user who supplied it', async () => {
      const user = await userWithAvailable(10_000);
      const payout = await submit(user.id, 5000);

      expect(payout.destinationMasked).not.toBe(DESTINATION);
      expect(payout.destinationMasked).toMatch(/\.com$/);
      expect(JSON.stringify(payout)).not.toContain('withdrawals@');
    });

    it('is absent from every admin list response', async () => {
      const user = await userWithAvailable(10_000);
      await submit(user.id, 5000);

      const page = await payouts.findMany({});
      const shaped = page.items.map((item) => payouts.toAdminSummary(item));

      // §3.5: "never returned in list responses, only on the detail view an
      // admin explicitly opens, and that view is audited."
      expect(JSON.stringify(shaped)).not.toContain(DESTINATION);
      expect(shaped[0]).not.toHaveProperty('destination');
    });

    it('is on the detail view, with the review context', async () => {
      const user = await userWithAvailable(10_000);
      const payout = await submit(user.id, 5000);

      const detail = await adminPayouts.detail(
        await prisma.payoutRequest.findUniqueOrThrow({ where: { id: payout.id } }),
      );

      expect(detail.destination).toBe(DESTINATION);
      expect(detail.reviewContext.balance.locked).toBe(5000);
      expect(detail.reviewContext.accountStatus).toBe('ACTIVE');
      expect(detail.reviewContext.paidPayoutCount).toBe(0);
    });
  });

  // --- Ownership -----------------------------------------------------------

  describe('ownership', () => {
    it('shows one user nothing of another', async () => {
      const mine = await userWithAvailable(10_000);
      const theirs = await userWithAvailable(10_000);
      await submit(theirs.id, 5000);

      expect((await payouts.findManyForUser(mine.id, {})).total).toBe(0);
      expect((await payouts.findManyForUser(theirs.id, {})).total).toBe(1);
    });

    it('answers "not found" rather than "not yours"', async () => {
      const mine = await userWithAvailable(10_000);
      const theirs = await userWithAvailable(10_000);
      const payout = await submit(theirs.id, 5000);

      // Telling a caller that a payout exists but is not theirs confirms the id.
      await expect(payouts.requireOwnedBy(payout.id, mine.id)).rejects.toMatchObject({
        code: ERROR_CODES.PAYOUT_NOT_FOUND,
        httpStatus: 404,
      });
    });
  });

  // --- Interaction with the rest of the ledger -----------------------------

  describe('accounting interactions', () => {
    it('does not let a chargeback reach points reserved for a payout', async () => {
      const user = await userWithAvailable(10_000);
      const payout = await submit(user.id, 10_000);

      const credit = await prisma.rewardTransaction.findFirstOrThrow({
        where: { userId: user.id, type: REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT },
      });
      await rewards.reverse(credit.id, 'chargeback after withdrawal requested');

      const balance = await rewards.getBalance(user.id);

      /*
       * §9.5: a reversal takes from `pending`, then `available`, and goes
       * negative rather than clamping — but it never touches `locked`. Those
       * points are reserved for a payout an admin may be part-way through
       * sending, and taking them back under it would leave the payout unfunded
       * without the payout knowing.
       */
      expect(balance.locked).toBe(10_000);
      expect(balance.available).toBe(-10_000);
      await expectBalanced(user.id);

      // And the request is still perfectly settleable — which is the point.
      const stored = await prisma.payoutRequest.findUniqueOrThrow({
        where: { id: payout.id },
      });
      expect(stored.status).toBe(PAYOUT_STATUSES.PENDING_REVIEW);
    });

    it('leaves a settled payout explainable from the ledger alone', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      await adminPayouts.settle(payout.id, 'BANK-REF-1', admin);

      const movements = await rewards.findMany({ sourceId: payout.id });

      // The lock and the settle both point at the payout, so "where did these
      // points go" is one query.
      expect(movements.total).toBe(2);
      expect(movements.items.every((m) => m.sourceType === REWARD_SOURCE_TYPES.PAYOUT)).toBe(
        true,
      );
      await expectBalanced(user.id);
    });

    /**
     * D85 applied to withdrawals: the method is recorded on the movement, not
     * looked up from it. Methods are configuration and one an admin removes
     * later would otherwise leave a settled withdrawal on the statement with
     * nothing to say about where the money went.
     */
    it('records the method on every movement of one withdrawal', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.approve(payout.id, undefined, admin);
      await adminPayouts.settle(payout.id, 'BANK-REF-2', admin);

      const movements = await rewards.findMany({ sourceId: payout.id });

      // The lock and the settle are the same withdrawal; a statement naming the
      // method on one line and not the next reads as two unrelated events.
      expect(movements.items.map((m) => m.type).sort()).toEqual([
        REWARD_TRANSACTION_TYPES.PAYOUT_LOCK,
        REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE,
      ]);
      expect(movements.items.every((m) => m.sourceLabel === 'paypal')).toBe(true);
    });

    it('keeps the method on the refund when a withdrawal is rejected', async () => {
      const user = await userWithAvailable(10_000);
      const admin = await createAdmin();
      const payout = await submit(user.id, 5000);

      await adminPayouts.reject(payout.id, 'destination did not match the account', admin);

      const movements = await rewards.findMany({ sourceId: payout.id });
      const refund = movements.items.find(
        (m) => m.type === REWARD_TRANSACTION_TYPES.PAYOUT_REFUND,
      );

      expect(refund?.sourceLabel).toBe('paypal');
      await expectBalanced(user.id);
    });
  });
});
