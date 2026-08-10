import { createHmac } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CONVERSION_STATUSES,
  FRAUD_ACTIONS,
  FRAUD_RULES,
  REWARD_SOURCE_TYPES,
  REWARD_TRANSACTION_TYPES,
  SYNC_MODES,
} from '@gemone/contracts';
import type { Job, Queue } from 'bullmq';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { QUEUES } from '../../src/core/queue/queue.constants';
import { CatalogSyncProcessor } from '../../src/jobs/catalog-sync.processor';
import { PostbackProcessProcessor } from '../../src/jobs/postback-process.processor';
import { RewardMaturationProcessor } from '../../src/jobs/reward-maturation.processor';
import {
  FRAUD_ENABLED,
  FRAUD_RULE_KEYS,
  FRAUD_DISPOSABLE_EMAIL_DOMAINS,
} from '../../src/modules/fraud/fraud.config';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { RewardAccountingService } from '../../src/modules/rewards/reward-accounting.service';
import { WorkerModule } from '../../src/worker.module';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * Fraud scoring, end to end — PROJECT.md §4.7.
 *
 * The unit tests prove the rules are right about numbers. This proves the
 * things only a real run can: that a rule firing actually withholds money, that
 * withheld money can be released, that releasing it credits exactly once, and
 * that the evidence needed to explain any of it survives.
 *
 * **The invariant every test here ends on** is that the balance still equals
 * the sum of its history. Fraud is the first feature that can hold, release and
 * reverse the same credit, and each of those is a way for a balance to drift
 * away from what happened.
 */
describe('fraud scoring (integration)', () => {
  let app: INestApplication;
  let worker: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;
  /**
   * The worker's own instance.
   *
   * `app` and `worker` are separate Nest containers, so each holds its own
   * in-process configuration cache (§14.3). Writing a threshold through one
   * leaves the other reading the value it cached at boot — which is precisely
   * how a test can set a rule and watch the worker ignore it.
   */
  let workerConfiguration: ConfigurationService;
  let rewards: RewardAccountingService;
  let postbackProcessor: PostbackProcessProcessor;
  let queue: Queue;

  let offerId: string;
  let providerId: string;

  const SECRET = process.env.PROVIDER_MOCK_SECRET ?? 'mock-fixture-secret';
  const password = 'correct-horse-battery-staple';

  let counter = 0;
  const nextEmail = (domain = 'example.com') => `fraud-${++counter}.${Date.now()}@${domain}`;
  const nextTransactionId = () => `TX-FRAUD-${Date.now()}-${++counter}`;

  beforeAll(async () => {
    const appRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = appRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();

    prisma = app.get(PrismaService);
    providers = app.get(ProvidersService);
    catalog = app.get(CatalogSyncService);
    configuration = app.get(ConfigurationService);
    rewards = app.get(RewardAccountingService);
    queue = app.get<Queue>(getQueueToken(QUEUES.POSTBACKS));

    postbackProcessor = worker.get(PostbackProcessProcessor);
    workerConfiguration = worker.get(ConfigurationService);

    for (const processor of [
      postbackProcessor,
      worker.get(RewardMaturationProcessor),
      worker.get(CatalogSyncProcessor),
    ]) {
      await processor.worker.waitUntilReady();
      await processor.worker.close().catch(() => undefined);
    }
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await worker?.close();
    await app?.close();
  });

  beforeEach(async () => {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);

    await prisma.payoutRequest.deleteMany();
    await prisma.rewardTransaction.deleteMany();
    await prisma.userBalance.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.fraudEvaluation.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.provider.deleteMany();
    configuration.invalidateAll();
    // Pinned to the rate these expectations were written against. The shipped
    // default changed from 1 to 10 when it was found to pay users a tenth of
    // the configured revenue share; what these tests check is mechanics, not
    // the launch economics, so they set the rate they depend on.
    await configuration.set(OFFERS_POINTS_PER_MINOR_UNIT.key, 1, {
      actor: { type: 'system' },
    });
    workerConfiguration.invalidateAll();
    await queue.obliterate({ force: true }).catch(() => undefined);

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    await providers.setEnabled(provider.id, true);
    await providers.reload();
    await catalog.sync(provider.id, SYNC_MODES.FULL);

    providerId = provider.id;
    offerId = (await prisma.offer.findFirstOrThrow({ where: { externalId: 'MK-100241' } })).id;
  });

  // --- Scoring at conversion time ------------------------------------------

  describe('a clean conversion', () => {
    it('is credited, scored, and left alone', async () => {
      const { user } = await earn();

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.CREDITED);

      /*
       * Scored, not skipped. A pipeline that only evaluated suspicious-looking
       * conversions would have no baseline, and `fraud_evaluations` would
       * answer "what did we think of this one?" with silence for the majority.
       */
      expect(conversion.fraudEvaluationId).not.toBeNull();

      const evaluation = await prisma.fraudEvaluation.findFirstOrThrow();
      expect(evaluation.score).toBe(0);
      expect(evaluation.action).toBe(FRAUD_ACTIONS.ALLOW);
      expect(evaluation.appliedAction).toBe(FRAUD_ACTIONS.ALLOW);

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(171);

      await expectBalanced(user.id);
    });

    it('records the thresholds in force, not just the ones that fired', async () => {
      /*
       * DATABASE.md §3.6, the whole reason this table exists: *"Without the
       * snapshot, a held conversion from last month cannot be explained —
       * 'which rule held this, at what threshold?' is exactly what an admin
       * asks when reviewing, and re-reading current configuration answers a
       * different question."*
       */
      await earn();

      const evaluation = await prisma.fraudEvaluation.findFirstOrThrow();
      const snapshot = evaluation.ruleSnapshot as unknown as { rule: string }[];

      expect(snapshot.map((rule) => rule.rule).sort()).toEqual(
        Object.values(FRAUD_RULES).sort(),
      );
    });
  });

  describe('a rule that fires', () => {
    it('holds the points instead of refusing them', async () => {
      /*
       * §4.7's central choice: *"high-risk conversions are credited but held
       * (not withdrawable) pending admin review, rather than rejected
       * outright. Rejecting legitimate users is more expensive than a short
       * hold."*
       *
       * So the points must exist. A test asserting only "not available" would
       * pass against an implementation that refused the conversion outright,
       * which is the failure mode this design exists to avoid.
       */
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });

      const { user } = await earn();

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.HELD);
      expect(conversion.reviewReason).toContain('after the click');

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(171);
      expect(balance.available).toBe(0);

      await expectBalanced(user.id);
    });

    it('holds them past the maturity date a clean conversion would have', async () => {
      /*
       * §10.3 step 7: a held conversion *"stays in `pending` past its maturity
       * date until an admin clears it"*. The distinction between "held" and
       * "not yet matured" is invisible in a balance and total in a ledger —
       * a held credit has no maturity date at all, so no clock will ever
       * release it.
       */
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });

      const { user } = await earn();

      const credit = await creditFor(user.id);
      expect(credit?.maturesAt ?? null).toBeNull();
    });

    it('names the rule and the numbers behind it on the evaluation', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });

      await earn();

      const evaluation = await prisma.fraudEvaluation.findFirstOrThrow();
      const triggered = evaluation.triggered as unknown as {
        rule: string;
        observed: number;
        threshold: number;
      }[];

      expect(triggered).toHaveLength(1);
      expect(triggered[0]).toMatchObject({
        rule: FRAUD_RULES.IMPOSSIBLE_TIMING,
        threshold: 86_400,
      });
      expect(evaluation.action).toBe(FRAUD_ACTIONS.HOLD);
      expect(evaluation.appliedAction).toBe(FRAUD_ACTIONS.HOLD);
    });

    it('refuses outright only when an admin configured it to', async () => {
      /*
       * `BLOCK` is reachable through configuration and unreachable by default
       * (P3). Nothing is credited, and the conversion is still recorded —
       * refusing to pay is not the same as pretending the event never
       * happened.
       */
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, {
        threshold: 86_400,
        action: FRAUD_ACTIONS.BLOCK,
      });

      const { user } = await earn();

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.REJECTED);
      expect(conversion.rewardPoints).toBe(171);

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(0);
      expect(balance.available).toBe(0);

      await expectBalanced(user.id);
    });
  });

  describe('velocity across a shared address', () => {
    it('holds once one IP has produced more conversions than the threshold', async () => {
      await tighten(FRAUD_RULES.IP_CONVERSION_VELOCITY, { threshold: 1 });

      const ip = '203.0.113.77';
      await earn({ ip });
      await earn({ ip });
      const third = await earn({ ip });

      const conversions = await prisma.conversion.findMany({ orderBy: { createdAt: 'asc' } });

      /*
       * The first two are under the threshold and the third is over it — the
       * signal is cumulative, and only the conversion that crossed the line is
       * held. Earlier ones are not retroactively re-scored: an evaluation is
       * of a moment, and re-judging settled events would make a user's balance
       * depend on what happened after they earned it.
       */
      expect(conversions.map((row) => row.status)).toEqual([
        CONVERSION_STATUSES.CREDITED,
        CONVERSION_STATUSES.CREDITED,
        CONVERSION_STATUSES.HELD,
      ]);

      await expectBalanced(third.user.id);
    });
  });

  describe('multi-accounting', () => {
    it('counts other accounts behind one address, not the account itself', async () => {
      /*
       * The off-by-one that would make this rule useless: counting the user
       * being scored means every conversion from an address nobody else uses
       * still reports one account, and a threshold of one holds everybody.
       */
      await tighten(FRAUD_RULES.SHARED_IP_ACCOUNTS, { threshold: 1 });

      const ip = '203.0.113.88';

      const alone = await earn({ ip });
      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.CREDITED,
      );
      await expectBalanced(alone.user.id);

      // Two strangers later, the third conversion from this address sees two
      // other accounts and crosses the threshold.
      await earn({ ip });
      const third = await earn({ ip });

      const held = await prisma.conversion.findFirst({
        where: { userId: third.user.id },
      });
      expect(held?.status).toBe(CONVERSION_STATUSES.HELD);
    });

    it('uses the device fingerprint as a signal and never as a refusal', async () => {
      /*
       * The fingerprint is client-supplied. Its default action is REVIEW, and
       * a REVIEW still holds rather than blocks — otherwise copying somebody
       * else's fingerprint would be a way to get *their* conversions refused.
       */
      // Zero, meaning "any other account at all". The rule fires *above* the
      // threshold, so 1 would need two strangers rather than one.
      await tighten(FRAUD_RULES.SHARED_DEVICE_ACCOUNTS, { threshold: 0 });

      const fingerprint = 'shared-device-abc';
      await earn({ fingerprint });
      const second = await earn({ fingerprint });

      const conversion = await prisma.conversion.findFirstOrThrow({
        where: { userId: second.user.id },
      });

      expect(conversion.status).toBe(CONVERSION_STATUSES.HELD);
      expect((await rewards.getBalance(second.user.id)).pending).toBe(171);

      const evaluation = await prisma.fraudEvaluation.findFirstOrThrow({
        where: { userId: second.user.id },
      });
      expect(evaluation.action).toBe(FRAUD_ACTIONS.REVIEW);
    });
  });

  describe('the disposable-domain blocklist', () => {
    it('holds a registration on a listed domain', async () => {
      await setConfig(FRAUD_DISPOSABLE_EMAIL_DOMAINS.key, ['throwaway.test']);

      const { user } = await earn({ emailDomain: 'throwaway.test' });

      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.HELD,
      );
      await expectBalanced(user.id);
    });

    it('lets an unlisted domain through', async () => {
      await setConfig(FRAUD_DISPOSABLE_EMAIL_DOMAINS.key, ['throwaway.test']);

      await earn();

      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.CREDITED,
      );
    });
  });

  // --- The review queue ----------------------------------------------------

  describe('clearing a hold', () => {
    it('matures the points and makes them withdrawable', async () => {
      /*
       * TODO T29's whole point: *"Nothing can currently clear one, so those
       * points are stranded — deliberately, but permanently, which is not the
       * design."* This is the way out.
       */
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');

      const conversion = await prisma.conversion.findFirstOrThrow();

      const response = await request(server())
        .post(`/admin/fraud/held/${conversion.id}/review`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ decision: 'CLEAR', reason: 'verified with the provider' })
        .expect(201);

      expect(response.body.conversionId).toBe(conversion.id);

      const balance = await rewards.getBalance(user.id);
      expect(balance.available).toBe(171);
      expect(balance.pending).toBe(0);

      const after = await prisma.conversion.findFirstOrThrow();
      expect(after.status).toBe(CONVERSION_STATUSES.CREDITED);
      expect(after.reviewedByAdminId).toBe(admin.id);
      expect(after.reviewReason).toBe('verified with the provider');

      await expectBalanced(user.id);
    });

    it('cannot be cleared twice', async () => {
      /*
       * The second clear would mature a credit already matured — 171 points
       * appearing from nowhere. Refused by the status check under the row
       * lock, which is why the status is re-read inside the transaction.
       */
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      await review(admin.token, conversion.id, 'CLEAR', 'first').expect(201);
      await review(admin.token, conversion.id, 'CLEAR', 'second').expect(409);

      expect((await rewards.getBalance(user.id)).available).toBe(171);
      await expectBalanced(user.id);
    });

    it('lets exactly one of two concurrent clears through', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      const [first, second] = await Promise.all([
        review(admin.token, conversion.id, 'CLEAR', 'admin one'),
        review(admin.token, conversion.id, 'CLEAR', 'admin two'),
      ]);

      const codes = [first.status, second.status].sort();
      expect(codes).toEqual([201, 409]);

      // The number that matters: the points moved once.
      expect((await rewards.getBalance(user.id)).available).toBe(171);
      await expectBalanced(user.id);
    });
  });

  describe('confirming fraud', () => {
    it('reverses the credit and takes the points back', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      await review(admin.token, conversion.id, 'CONFIRM', 'confirmed emulator farm').expect(
        201,
      );

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(0);
      expect(balance.available).toBe(0);
      expect(balance.lifetimeReversed).toBe(171);

      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.REJECTED,
      );

      await expectBalanced(user.id);
    });

    it('cannot be reversed a second time', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      await review(admin.token, conversion.id, 'CONFIRM', 'first').expect(201);
      await review(admin.token, conversion.id, 'CONFIRM', 'second').expect(409);

      expect((await rewards.getBalance(user.id)).lifetimeReversed).toBe(171);
      await expectBalanced(user.id);
    });

    it('cannot be cleared after being confirmed', async () => {
      // The two decisions are opposite and both terminal. Clearing a confirmed
      // hold would mature a credit that has already been reversed.
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      await review(admin.token, conversion.id, 'CONFIRM', 'fraud').expect(201);
      await review(admin.token, conversion.id, 'CLEAR', 'changed my mind').expect(409);

      expect((await rewards.getBalance(user.id)).available).toBe(0);
      await expectBalanced(user.id);
    });
  });

  describe('the review surface', () => {
    it('lists what is waiting, oldest first, with the score that held it', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      await earn();
      await earn();
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get('/admin/fraud/held')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.total).toBe(2);
      expect(response.body.items[0].fraudScore).toBeGreaterThan(0);
      expect(response.body.items[0].triggeredRules).toContain(FRAUD_RULES.IMPOSSIBLE_TIMING);

      const [first, second] = response.body.items;
      expect(new Date(first.createdAt).getTime()).toBeLessThanOrEqual(
        new Date(second.createdAt).getTime(),
      );
    });

    it('shows which rules never ran, not only which stayed quiet', async () => {
      /*
       * A click carrying no device fingerprint cannot be scored for
       * multi-accounting by device. Reporting that as "did not fire" would tell
       * an admin the account was checked and cleared when it was never checked.
       *
       * The fingerprint is the honest case to assert here: a click over HTTP
       * always has a socket address, so the IP rules never legitimately skip in
       * this harness. Their skip path is covered in the unit tests, where a
       * context with a null IP can actually be constructed.
       */
      const { user } = await earn();
      const admin = await createUser('ADMIN');

      const conversion = await prisma.conversion.findFirstOrThrow({
        where: { userId: user.id },
      });

      const response = await request(server())
        .get(`/admin/fraud/evaluations/${conversion.fraudEvaluationId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const skipped = response.body.skipped.map((entry: { rule: string }) => entry.rule);
      expect(skipped).toContain(FRAUD_RULES.SHARED_DEVICE_ACCOUNTS);
      // And the ones that did run are not in the skipped list.
      expect(skipped).not.toContain(FRAUD_RULES.USER_CONVERSION_VELOCITY);
    });

    it('audits both decisions with the reason inside them', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      await earn();
      await earn();
      const admin = await createUser('ADMIN');

      const [a, b] = await prisma.conversion.findMany({ orderBy: { createdAt: 'asc' } });

      await review(admin.token, a!.id, 'CLEAR', 'legitimate').expect(201);
      await review(admin.token, b!.id, 'CONFIRM', 'emulator farm').expect(201);

      const entries = await prisma.adminAuditLog.findMany({
        where: { targetType: 'conversion' },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((entry) => entry.action)).toEqual([
        'conversion.hold_cleared',
        'conversion.hold_confirmed',
      ]);
      expect(entries[0]?.reason).toBe('legitimate');
      expect(entries.every((entry) => entry.adminId === admin.id)).toBe(true);
    });

    it('is closed to ordinary users', async () => {
      const user = await createUser();

      await request(server())
        .get('/admin/fraud/held')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);
    });

    it('refuses to resolve a conversion that was never held', async () => {
      const { user } = await earn();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      await review(admin.token, conversion.id, 'CLEAR', 'nothing to clear').expect(409);

      // And it moved nothing on the way to refusing.
      expect((await rewards.getBalance(user.id)).pending).toBe(171);
      await expectBalanced(user.id);
    });
  });

  // --- Interaction with the rest of the system -----------------------------

  describe('the payout review screen', () => {
    it('carries the account’s fraud signals (T32, §11.3)', async () => {
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });
      const { user } = await earn();
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get(`/admin/fraud/users/${user.id}/signals`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.peakScore).toBeGreaterThan(0);
      expect(response.body.flaggedCount).toBe(1);
      expect(response.body.rulesEverTriggered).toContain(FRAUD_RULES.IMPOSSIBLE_TIMING);
    });

    it('reports nothing rather than a clean score for an unscored account', async () => {
      // Null, not zero. `peakScore: 0` would read as "we looked and found
      // nothing", which is the opposite of "never looked".
      const user = await createUser();
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get(`/admin/fraud/users/${user.id}/signals`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.latestScore).toBeNull();
      expect(response.body.flaggedCount).toBe(0);
    });
  });

  describe('held points and withdrawals', () => {
    it('cannot be withdrawn while the hold stands, and can once cleared', async () => {
      /*
       * The end-to-end statement of what a hold *is*. Everything else in this
       * file is a step toward this: held points are visible to the user and
       * unavailable to withdraw, and clearing the hold is what changes that.
       */
      await tighten(FRAUD_RULES.IMPOSSIBLE_TIMING, { threshold: 86_400 });

      const { user } = await earn();
      const admin = await createUser('ADMIN');

      // 171 points, all pending. A withdrawal needs available points.
      const refused = await request(server())
        .post('/payouts')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ amountPoints: 1000, method: 'paypal', destination: 'user@example.com' })
        .expect(409);

      expect(refused.body.error.code).toBe('REWARD_INSUFFICIENT_BALANCE');

      const conversion = await prisma.conversion.findFirstOrThrow();
      await review(admin.token, conversion.id, 'CLEAR', 'verified').expect(201);

      expect((await rewards.getBalance(user.id)).available).toBe(171);
      await expectBalanced(user.id);
    });
  });

  describe('when scoring cannot run', () => {
    it('records an evaluation with every rule skipped rather than a silent gap', async () => {
      /*
       * A window with scoring disabled must be visible afterwards as exactly
       * that. An implementation that skipped writing anything would leave a
       * period that looks, in hindsight, like a quiet stretch with no fraud.
       */
      await setConfig(FRAUD_ENABLED.key, false);

      const { user } = await earn();

      const evaluation = await prisma.fraudEvaluation.findFirstOrThrow();
      const skipped = evaluation.skipped as unknown as { rule: string }[];

      expect(skipped).toHaveLength(Object.values(FRAUD_RULES).length);
      expect(evaluation.action).toBe(FRAUD_ACTIONS.ALLOW);

      // And the conversion was credited normally — the switch turns scoring
      // off, not earning.
      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.CREDITED,
      );
      await expectBalanced(user.id);
    });
  });

  describe('chargebacks', () => {
    it('are not scored — a reversal grants nothing to judge', async () => {
      const { user, clicked } = await earn();

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery(clicked.subId, { reversed: '1', payout: '2.45' }))
        .expect(200);
      await drainPostbacks();

      const reversal = await prisma.conversion.findFirstOrThrow({
        where: { type: 'REVERSAL' },
      });

      /*
       * No evaluation on the reversal row. Scoring it would file a fraud
       * record against a user for an event the *provider* initiated, and the
       * score would be meaningless — there is no credit for it to withhold.
       */
      expect(reversal.fraudEvaluationId).toBeNull();
      expect(await prisma.fraudEvaluation.count()).toBe(1);

      await expectBalanced(user.id);
    });
  });

  // --- Helpers -------------------------------------------------------------

  const server = () => app.getHttpServer();

  /** The invariant every test ends on: balance equals the sum of its history. */
  async function expectBalanced(userId: string): Promise<void> {
    const reconciliation = await rewards.reconcile(userId);

    expect(reconciliation.balanced, JSON.stringify(reconciliation.drift)).toBe(true);
  }

  /** Writes a configuration value and drops it from *both* containers' caches. */
  async function setConfig(key: string, value: unknown): Promise<void> {
    await configuration.set(key, value, { actor: { type: 'system' } });
    workerConfiguration.invalidateAll();
  }

  async function tighten(
    rule: (typeof FRAUD_RULES)[keyof typeof FRAUD_RULES],
    overrides: Partial<{ threshold: number; action: string; weight: number }>,
  ): Promise<void> {
    const definition = FRAUD_RULE_KEYS[rule];

    await setConfig(definition.key, { ...definition.defaultValue, ...overrides });
  }

  function review(token: string, conversionId: string, decision: string, reason: string) {
    return request(server())
      .post(`/admin/fraud/held/${conversionId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision, reason });
  }

  function sign(query: Record<string, string>): Record<string, string> {
    const canonical = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');

    return { ...query, sig: createHmac('sha256', SECRET).update(canonical).digest('hex') };
  }

  /**
   * `event_time` defaults to five minutes *after* now, not to a fixed past
   * timestamp.
   *
   * The timing rule measures click-to-conversion elapsed time, and a fixture
   * whose event predates the click it belongs to is scored as clock skew and
   * skipped — which silently disables the rule in every test that uses it.
   * Five minutes is comfortably above the thirty-second default floor, so the
   * ordinary fixture reads as an ordinary conversion.
   */
  function postbackQuery(subId: string, overrides: Record<string, string> = {}) {
    return sign({
      campaign_id: 'MK-100241',
      currency: 'USD',
      event_time: new Date(Date.now() + 300_000).toISOString(),
      payout: '2.45',
      reversed: '0',
      status: '1',
      sub_id: subId,
      transaction_id: nextTransactionId(),
      ...overrides,
    });
  }

  async function createUser(role: 'USER' | 'ADMIN' = 'USER', domain = 'example.com') {
    const email = nextEmail(domain);
    const registration = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
      const relogin = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return { id: relogin.body.user.id as string, token: relogin.body.accessToken as string };
    }

    return {
      id: registration.body.user.id as string,
      token: registration.body.accessToken as string,
    };
  }

  async function drainPostbacks(): Promise<void> {
    for (const job of await queue.getJobs(['waiting', 'delayed'])) {
      await postbackProcessor.process(job as Job);
    }
  }

  /**
   * Click → postback → worker, with the fraud evidence a click carries.
   *
   * The IP is set through `X-Forwarded-For` because that is how it arrives in
   * production behind a proxy, and the trust-proxy setting above is what makes
   * the app believe it.
   */
  async function earn(
    options: {
      ip?: string | null;
      fingerprint?: string;
      emailDomain?: string;
      postback?: Record<string, string>;
    } = {},
  ) {
    const user = await createUser('USER', options.emailDomain ?? 'example.com');

    const clickRequest = request(server())
      .post('/clicks')
      .set('Authorization', `Bearer ${user.token}`);

    if (options.ip !== null) {
      clickRequest.set('X-Forwarded-For', options.ip ?? '203.0.113.10');
    }

    const clicked = (
      await clickRequest
        .send({
          offerId,
          ...(options.fingerprint ? { deviceFingerprint: options.fingerprint } : {}),
        })
        .expect(201)
    ).body as { id: string; subId: string; rewardPoints: number };

    await request(server())
      .post('/postback/mock')
      .query(postbackQuery(clicked.subId, options.postback ?? {}))
      .expect(200);

    await drainPostbacks();

    return { user, clicked };
  }

  async function creditFor(userId: string) {
    return rewards
      .getHistory(userId, { limit: 50 })
      .then((history) =>
        history.items.find(
          (entry) =>
            entry.type === REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT &&
            entry.sourceType === REWARD_SOURCE_TYPES.CONVERSION,
        ),
      );
  }

  void providerId;
});
