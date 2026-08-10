import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  CONVERSION_STATUSES,
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
import { RewardAccountingService } from '../../src/modules/rewards/reward-accounting.service';
import { REWARDS_HOLD_PERIOD_DAYS } from '../../src/modules/rewards/rewards.config';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { WorkerModule } from '../../src/worker.module';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * The full earning path, end to end — PROJECT.md §18.4's first e2e scenario:
 * *"simulated conversion → points appear as `pending` → after maturation, they
 * are `available`."*
 *
 * Everything before this feature stopped at "a conversion was recorded". This
 * is where a user finally has points, and it is the first test in the codebase
 * that spans a click, a provider callback, a worker, a job schedule and a
 * balance.
 */
describe('earning points end to end (integration)', () => {
  let app: INestApplication;
  let worker: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;
  let rewards: RewardAccountingService;
  let postbackProcessor: PostbackProcessProcessor;
  let maturation: RewardMaturationProcessor;
  let queue: Queue;

  let offerId: string;

  const SECRET = process.env.PROVIDER_MOCK_SECRET ?? 'mock-fixture-secret';
  const password = 'correct-horse-battery-staple';

  let counter = 0;
  const nextEmail = () => `flow-${++counter}.${Date.now()}@example.com`;
  const nextTransactionId = () => `TX-FLOW-${Date.now()}-${++counter}`;

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
    maturation = worker.get(RewardMaturationProcessor);

    // The live consumers are shut down and the processors driven directly —
    // otherwise they drain queues on their own schedule and every assertion
    // races them. Learned the hard way in the previous feature.
    for (const processor of [
      postbackProcessor,
      maturation,
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
    app.getHttpAdapter().getInstance().set('trust proxy', 0);

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
    await queue.obliterate({ force: true }).catch(() => undefined);

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    await providers.setEnabled(provider.id, true);
    await providers.reload();
    await catalog.sync(provider.id, SYNC_MODES.FULL);

    offerId = (await prisma.offer.findFirstOrThrow({ where: { externalId: 'MK-100241' } })).id;
  });

  const server = () => app.getHttpServer();

  function sign(query: Record<string, string>): Record<string, string> {
    const canonical = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');

    return { ...query, sig: createHmac('sha256', SECRET).update(canonical).digest('hex') };
  }

  function postbackQuery(subId: string, overrides: Record<string, string> = {}) {
    return sign({
      campaign_id: 'MK-100241',
      currency: 'USD',
      event_time: '2026-08-03T09:00:00Z',
      payout: '2.45',
      reversed: '0',
      status: '1',
      sub_id: subId,
      transaction_id: nextTransactionId(),
      ...overrides,
    });
  }

  async function createUser(role: 'USER' | 'ADMIN' = 'USER') {
    const email = nextEmail();
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

  async function click(token: string) {
    const response = await request(server())
      .post('/clicks')
      .set('Authorization', `Bearer ${token}`)
      .send({ offerId })
      .expect(201);

    return response.body as { id: string; subId: string; rewardPoints: number };
  }

  async function drainPostbacks() {
    for (const job of await queue.getJobs(['waiting', 'delayed'])) {
      await postbackProcessor.process(job as Job);
    }
  }

  /** Click → postback → worker. Returns the user and what they were promised. */
  async function earn(overrides: Record<string, string> = {}) {
    const user = await createUser();
    const clicked = await click(user.token);

    await request(server())
      .post('/postback/mock')
      .query(postbackQuery(clicked.subId, overrides))
      .expect(200);

    await drainPostbacks();

    return { user, clicked };
  }

  // --- The scenario PROJECT.md §18.4 names ---------------------------------

  describe('conversion → pending → available', () => {
    it('credits the user the points their conversion was worth', async () => {
      const { user, clicked } = await earn();

      const balance = await rewards.getBalance(user.id);

      /*
       * The promise made at click time and the points actually credited are
       * the same number here, because this is a single-step offer whose payout
       * matched. When they differ — a multi-step offer paying in stages — both
       * numbers survive, on the click and on the conversion.
       */
      expect(clicked.rewardPoints).toBe(171);
      expect(balance.pending).toBe(171);
      expect(balance.available).toBe(0);
      expect(balance.lifetimeEarned).toBe(171);

      /*
       * And the conversion says so. `ATTRIBUTED` means matched and priced with
       * no balance effect applied (D31) — leaving it there after the points
       * moved would make the conversion row disagree with the ledger about
       * whether anyone had been paid.
       */
      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.CREDITED);
    });

    it('makes them available once the hold elapses, and not before', async () => {
      await configuration.set(REWARDS_HOLD_PERIOD_DAYS.key, 14, {
        actor: { type: 'system' },
      });

      const { user } = await earn();

      // The sweep runs and finds nothing: fourteen days have not passed.
      await expect(maturation.sweep()).resolves.toMatchObject({ matured: 0 });
      expect((await rewards.getBalance(user.id)).available).toBe(0);

      // Wind the stored maturity back — the honest way to simulate time
      // passing, since the value is stored precisely so nothing re-derives it.
      await prisma.rewardTransaction.updateMany({
        where: { userId: user.id, type: REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });

      await expect(maturation.sweep()).resolves.toMatchObject({ matured: 1 });

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(0);
      expect(balance.available).toBe(171);
    });

    it('leaves the balance explainable by its own history at every step', async () => {
      const { user } = await earn();

      await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });

      await prisma.rewardTransaction.updateMany({
        where: { userId: user.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await maturation.sweep();

      await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });
    });

    it('links the credit back to the conversion that caused it', async () => {
      const { user } = await earn();
      const conversion = await prisma.conversion.findFirstOrThrow();

      const credit = await rewards.findBySource(
        REWARD_SOURCE_TYPES.CONVERSION,
        conversion.id,
        REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
      );

      // Every point a user holds traces to a signed provider postback
      // (PROJECT.md §1). This is the link that makes the chain complete.
      expect(credit?.userId).toBe(user.id);
      expect(credit?.amountPoints).toBe(conversion.rewardPoints);
    });
  });

  // --- What does not credit ------------------------------------------------

  describe('conversions that move no points', () => {
    it('credits nothing for a provider-pending event', async () => {
      const { user } = await earn({ status: '0' });

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.PENDING);

      // Nothing is owed until the provider confirms. The conversion row
      // records that we heard about it, which is a different fact.
      expect(await rewards.getBalance(user.id)).toMatchObject({ pending: 0, available: 0 });
      expect((await rewards.getHistory(user.id)).total).toBe(0);
    });

    it('credits nothing for a provider-rejected event', async () => {
      const { user } = await earn({ status: '2' });

      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.REJECTED,
      );
      expect((await rewards.getHistory(user.id)).total).toBe(0);
    });

    it('credits a held conversion but never lets it mature', async () => {
      const user = await createUser();
      const clicked = await click(user.token);
      await prisma.user.update({ where: { id: user.id }, data: { status: 'BANNED' } });

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery(clicked.subId))
        .expect(200);
      await drainPostbacks();

      expect((await prisma.conversion.findFirstOrThrow()).status).toBe(
        CONVERSION_STATUSES.HELD,
      );

      /*
       * §10.3 step 7: the points exist, they are visible as pending, and they
       * stay there past any maturity date until an admin clears them. Held
       * rather than refused, because a false positive that holds is
       * recoverable and one that refuses leaves no record at all.
       */
      expect((await rewards.getBalance(user.id)).pending).toBe(171);

      const credit = await prisma.rewardTransaction.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(credit.maturesAt).toBeNull();

      await expect(maturation.sweep()).resolves.toMatchObject({ matured: 0 });
    });
  });

  // --- Chargebacks ---------------------------------------------------------

  describe('a chargeback takes the points back', () => {
    it('reverses the credit inside the same transaction as the reversal row', async () => {
      const { user, clicked } = await earn();
      expect((await rewards.getBalance(user.id)).pending).toBe(171);

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery(clicked.subId, { reversed: '1' }))
        .expect(200);
      await drainPostbacks();

      const balance = await rewards.getBalance(user.id);
      expect(balance.pending).toBe(0);
      expect(balance.lifetimeReversed).toBe(171);

      const history = await rewards.getHistory(user.id);
      expect(history.items.map((item) => item.type)).toEqual([
        REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT,
        REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
      ]);

      await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });
    });

    it('takes points that had already matured out of available', async () => {
      const { user, clicked } = await earn();

      await prisma.rewardTransaction.updateMany({
        where: { userId: user.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });
      await maturation.sweep();
      expect((await rewards.getBalance(user.id)).available).toBe(171);

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery(clicked.subId, { reversed: '1' }))
        .expect(200);
      await drainPostbacks();

      // A chargeback arriving after maturation is the normal case, not an
      // edge one — it is why the hold period exists at all.
      expect((await rewards.getBalance(user.id)).available).toBe(0);
      await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });
    });

    it('records the reversal even when there was nothing to take back', async () => {
      // A rejected conversion was never credited. The chargeback still has to
      // be recorded: the provider told us something happened.
      const { user, clicked } = await earn({ status: '2' });

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery(clicked.subId, { reversed: '1' }))
        .expect(200);
      await drainPostbacks();

      expect(await prisma.conversion.count()).toBe(2);
      expect((await rewards.getHistory(user.id)).total).toBe(0);
      await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });
    });
  });

  // --- The user's own view -------------------------------------------------

  describe('the balance surface', () => {
    it('shows the caller three buckets, not one number', async () => {
      const { user } = await earn();

      const response = await request(server())
        .get('/rewards/balance')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        pending: 171,
        available: 0,
        locked: 0,
        total: 171,
      });
    });

    it('requires authentication', async () => {
      await request(server()).get('/rewards/balance').expect(401);
      await request(server()).get('/rewards/history').expect(401);
    });

    it('shows one user nothing of another', async () => {
      const { user: earner } = await earn();
      const other = await createUser();

      const response = await request(server())
        .get('/rewards/history')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);

      // Ownership is enforced in the handler from the token, not from a
      // parameter a caller could change (§6.2).
      expect(response.body.total).toBe(0);
      expect((await rewards.getHistory(earner.id)).total).toBe(1);
    });

    it('explains each movement, including when it becomes withdrawable', async () => {
      const { user } = await earn();

      const response = await request(server())
        .get('/rewards/history')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      const entry = response.body.items[0];
      expect(entry.type).toBe(REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT);
      expect(entry.amountPoints).toBe(171);
      expect(entry.pendingDelta).toBe(171);
      expect(entry.maturesAt).not.toBeNull();
      expect(entry.holdPeriodDays).toBe(14);
    });

    it('has no endpoint that lets anyone move their own points', async () => {
      const { user } = await earn();
      const auth = { Authorization: `Bearer ${user.token}` };

      /*
       * Points move because something happened — a conversion, a chargeback, a
       * withdrawal — and each has its own surface. A write here would be a way
       * to move money with no event behind it, which is exactly what the
       * transaction history exists to make impossible.
       */
      await request(server()).post('/rewards/balance').set(auth).send({ available: 999 }).expect(404);
      await request(server()).patch('/rewards/balance').set(auth).send({ available: 999 }).expect(404);
      await request(server()).post('/rewards/history').set(auth).send({}).expect(404);

      expect((await rewards.getBalance(user.id)).available).toBe(0);
    });
  });

  // --- Idempotency, all the way down ---------------------------------------

  describe('replaying the pipeline credits nothing twice', () => {
    it('survives the same postback being processed repeatedly', async () => {
      const { user } = await earn();
      const postback = await prisma.providerPostback.findFirstOrThrow();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await postbackProcessor.process({
          name: 'postback-process',
          data: { postbackId: postback.id },
          id: 'replay',
          attemptsMade: attempt,
        } as unknown as Job);
      }

      // Each layer refuses on its own terms: the postback is PROCESSED, the
      // conversion's unique key holds, and no second credit is written.
      expect(await prisma.conversion.count()).toBe(1);
      expect((await rewards.getHistory(user.id)).total).toBe(1);
      expect((await rewards.getBalance(user.id)).pending).toBe(171);
    });

    it('survives the maturation sweep running repeatedly', async () => {
      const { user } = await earn();

      await prisma.rewardTransaction.updateMany({
        where: { userId: user.id },
        data: { maturesAt: new Date(Date.now() - 1000) },
      });

      await maturation.sweep();
      await expect(maturation.sweep()).resolves.toMatchObject({ matured: 0 });
      await maturation.sweep();

      expect((await rewards.getBalance(user.id)).available).toBe(171);
      await expect(rewards.reconcile(user.id)).resolves.toMatchObject({ balanced: true });
    });
  });
});
