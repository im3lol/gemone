import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { InvalidationBus } from '../../src/core/events/invalidation.bus';
import {
  INVALIDATION_CHANNEL,
  INVALIDATION_PUBLISHER,
  INVALIDATION_SUBSCRIBER,
} from '../../src/core/events/invalidation.constants';
import { CatalogSyncProcessor } from '../../src/jobs/catalog-sync.processor';
import { PostbackProcessProcessor } from '../../src/jobs/postback-process.processor';
import { RewardMaturationProcessor } from '../../src/jobs/reward-maturation.processor';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { ProviderRegistry } from '../../src/modules/providers/registry/provider-registry';
import { REWARDS_HOLD_PERIOD_DAYS } from '../../src/modules/rewards/rewards.config';
import { WorkerModule } from '../../src/worker.module';

/**
 * Cross-process cache invalidation — ARCHITECTURE.md §14.3, TODO T3.
 *
 * ## What this file exists to prove, and why nothing else could
 *
 * Every other integration test in this suite runs one Nest container, and a
 * single container cannot fail the way T3 describes. The bug *is* the second
 * process: an admin changes a reward rate through `api`, and `worker` — which
 * is where conversions are priced and credited — keeps using the value it
 * cached at boot. Reproduced before this feature as:
 *
 * ```text
 * PUT /admin/configuration/offers.reward_share_percent  →  50
 * GET  (api process)                                    →  50
 * catalog re-sync (worker process)                      →  priced at 85
 * ```
 *
 * So this file runs **two containers over one Redis and one Postgres**, writes
 * through the HTTP surface of the first, and reads through the services of the
 * second — with no manual `invalidateAll()` anywhere. Every other spec in the
 * suite calls that in `beforeEach`; here it would erase the only thing being
 * measured.
 *
 * `worker` is the second container rather than a second `AppModule` on purpose:
 * it is the process the bug actually harmed, and using it means the graph under
 * test is the deployed one.
 */
describe('cross-process cache invalidation (integration)', () => {
  /** The writer. Stands in for the `api` process. */
  let api: INestApplication;
  /** The reader. The real `worker` graph, with its own caches. */
  let worker: TestingModule;

  let prisma: PrismaService;
  let apiConfiguration: ConfigurationService;
  let apiProviders: ProvidersService;

  let workerConfiguration: ConfigurationService;
  let workerRegistry: ProviderRegistry;
  let workerBus: InvalidationBus;
  let workerSubscriber: Redis;

  /**
   * How many times the worker's subscriber has come back.
   *
   * Counted so the publisher-recovery test can prove the worker never
   * disconnected — otherwise D61 would heal that scenario and D64 would be
   * passing for the wrong reason.
   */
  let workerResyncCount = 0;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `invalidation-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const apiRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    api = apiRef.createNestApplication();
    api.use(cookieParser());
    api.useGlobalPipes(createValidationPipe());
    await api.init();

    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();

    prisma = api.get(PrismaService);
    apiConfiguration = api.get(ConfigurationService);
    apiProviders = api.get(ProvidersService);

    workerConfiguration = worker.get(ConfigurationService);
    workerRegistry = worker.get(ProviderRegistry);
    workerBus = worker.get(InvalidationBus);
    workerSubscriber = worker.get<Redis>(INVALIDATION_SUBSCRIBER);

    // Attached after `init`, so the first `ready` is already past and every
    // one counted here is a reconnection.
    workerSubscriber.on('ready', () => {
      workerResyncCount += 1;
    });

    /*
     * The queue consumers are closed but the container is kept. This file is
     * about the worker's *caches*, and a live BullMQ worker would race every
     * test's cleanup — the failure mode T11 documents at length.
     */
    for (const processor of [
      worker.get(PostbackProcessProcessor),
      worker.get(RewardMaturationProcessor),
      worker.get(CatalogSyncProcessor),
    ]) {
      await processor.worker.waitUntilReady();
      await processor.worker.close().catch(() => undefined);
    }
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
  });

  beforeEach(async () => {
    // Ordered by dependency, deepest first. `users` gains a balance row on
    // registration (D36), so it can never be the first thing truncated.
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
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.provider.deleteMany();

    /*
     * The one place this file clears caches by hand: between tests, so a value
     * left over from the previous one cannot be mistaken for a value that
     * propagated. Never inside a test.
     */
    apiConfiguration.invalidateAll();
    workerConfiguration.invalidateAll();

    await apiProviders.reload();
    await worker.get(ProvidersService).reload();
  });

  it('gives the two containers different instance ids', () => {
    /*
     * The premise of every test below. If they shared one, each would discard
     * the other's messages as its own echo and the whole file would pass while
     * measuring nothing.
     */
    expect(api.get(InvalidationBus).instanceId).not.toBe(workerBus.instanceId);
  });

  describe('a configuration change made through the admin API', () => {
    it('reaches the other process without a restart', async () => {
      /*
       * T3, stated as a test. Before §14.3 landed, the final assertion here
       * returned the default — for the life of the worker process.
       */
      const admin = await createAdmin();

      // Warm the worker's cache first, so this cannot pass by never having
      // cached anything. Without a prior read there is nothing stale to fix.
      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 30,
        reason: 'a longer hold while we watch chargebacks',
      }).expect(200);

      await eventually(
        () => workerConfiguration.get<number>(REWARDS_HOLD_PERIOD_DAYS.key),
        (value) => value === 30,
        'the worker to serve the new hold period',
      );
    });

    it('reaches the other process when the override is removed again', async () => {
      /*
       * A reset is a change like any other and the *more* dangerous direction:
       * an admin who lowers a limit and then reverts it expects the revert to
       * take effect everywhere the lowering did.
       */
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 45, reason: 'temporary' })
        .expect(200);
      await eventually(
        () => workerConfiguration.get<number>(REWARDS_HOLD_PERIOD_DAYS.key),
        (value) => value === 45,
        'the worker to serve the temporary hold period',
      );

      await reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'back to the default' })
        .expect(200);

      await eventually(
        () => workerConfiguration.get<number>(REWARDS_HOLD_PERIOD_DAYS.key),
        (value) => value === REWARDS_HOLD_PERIOD_DAYS.defaultValue,
        'the worker to return to the default',
      );
    });

    it('leaves keys nobody touched alone', async () => {
      /*
       * The invalidation is per entry, not a broadcast flush. A change to one
       * key that emptied every process's whole cache would be correct and
       * would also turn each admin edit into a re-read of everything.
       */
      const admin = await createAdmin();

      await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key);
      await prisma.configurationValue.create({
        data: {
          id: crypto.randomUUID(),
          key: REWARDS_HOLD_PERIOD_DAYS.key,
          scopeType: 'GLOBAL',
          scopeId: '',
          value: 99,
          valueType: 'number',
          updatedBy: 'test',
        },
      });

      // A different key changes. The row written behind the service's back
      // must still be invisible to the worker, because nothing told it to
      // re-read *that* key.
      await set(admin, 'clicks.attribution_window_days', {
        value: 21,
        reason: 'unrelated change',
      }).expect(200);

      await eventually(
        () => workerConfiguration.get<number>('clicks.attribution_window_days'),
        (value) => value === 21,
        'the unrelated key to propagate',
      );

      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
    });
  });

  describe('a provider change made through the admin API', () => {
    it('reaches the other process registry', async () => {
      /*
       * §7.3: "cutting off a misbehaving provider takes seconds and no
       * deploy." That was true on the writing process only — and the process
       * that runs catalog syncs and prices conversions is the other one.
       */
      const admin = await createAdmin();
      const provider = await apiProviders.create({ slug: 'mock', displayName: 'Mock' });

      await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: true, reason: 'switching the pilot on' })
        .expect(200);

      await eventually(
        async () => workerRegistry.find('mock')?.isEnabled,
        (enabled) => enabled === true,
        'the worker registry to see the provider enabled',
      );

      await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: false, reason: 'misbehaving' })
        .expect(200);

      await eventually(
        async () => workerRegistry.find('mock')?.isEnabled,
        (enabled) => enabled === false,
        'the worker registry to see the provider disabled',
      );
    });
  });

  describe('the channel is best-effort, so the receiver is conservative', () => {
    it('drops every cached value when it reconnects', async () => {
      /*
       * Redis pub/sub has no backlog. A message published while a process is
       * disconnected is gone, and there is no sequence number to notice the
       * gap with — so a subscriber that comes back has to assume it missed
       * everything.
       *
       * Arranged the only way that is honest: change the row *without* going
       * through the service, so no message is ever published. That is exactly
       * what a message lost to a blip looks like from the worker's side.
       */
      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      await prisma.configurationValue.create({
        data: {
          id: crypto.randomUUID(),
          key: REWARDS_HOLD_PERIOD_DAYS.key,
          scopeType: 'GLOBAL',
          scopeId: '',
          value: 77,
          valueType: 'number',
          updatedBy: 'a-process-that-never-told-anyone',
        },
      });

      // Still stale, because nothing has been broadcast. This is the state a
      // network blip leaves behind.
      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      // ioredis emits `ready` again after every successful reconnect.
      workerSubscriber.emit('ready');

      await eventually(
        () => workerConfiguration.get<number>(REWARDS_HOLD_PERIOD_DAYS.key),
        (value) => value === 77,
        'the reconnect to drop the stale value',
      );
    });

    it('drops every cached value when it receives a message it cannot read', async () => {
      /*
       * The rolling-deploy case: a process on the old build hears from one on
       * the new build. Each unreadable message still means a value it has
       * cached just changed, so ignoring them would make the old processes
       * silently stale for the length of the deploy — at the one moment nobody
       * is watching for it.
       */
      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      await prisma.configurationValue.create({
        data: {
          id: crypto.randomUUID(),
          key: REWARDS_HOLD_PERIOD_DAYS.key,
          scopeType: 'GLOBAL',
          scopeId: '',
          value: 88,
          valueType: 'number',
          updatedBy: 'a-newer-build',
        },
      });

      // A message from a protocol version this build does not have.
      const publisher = api.get<Redis>(INVALIDATION_PUBLISHER);
      await publisher.publish(
        INVALIDATION_CHANNEL,
        JSON.stringify({ v: 99, origin: 'a-newer-build', domain: 'configuration', entry: {} }),
      );

      await eventually(
        () => workerConfiguration.get<number>(REWARDS_HOLD_PERIOD_DAYS.key),
        (value) => value === 88,
        'the unreadable message to be treated as "everything changed"',
      );
    });
  });

  describe('a broadcast lost because the publisher was down', () => {
    it('is made good when the publisher recovers, with no subscriber ever disconnecting', async () => {
      /*
       * D64 — the mirror image of the reconnect case above, and the reason it
       * needs its own test rather than sharing that one.
       *
       * Here **only the sending connection fails**. The worker's subscriber is
       * connected throughout, so nothing on its side will ever resync — and
       * configuration has no periodic re-read to heal it the way the provider
       * registry does. Before D64 the value written in this window stayed
       * wrong on the worker until the key was written again or the process
       * restarted.
       *
       * Staged by dropping the api's publisher connection alone, which is the
       * one thing an integration test can do that a Redis outage cannot: a
       * Redis outage takes the subscribers with it and hides the bug.
       */
      const admin = await createAdmin();
      const publisher = api.get<Redis>(INVALIDATION_PUBLISHER);
      const subscriberResyncs = () => workerResyncCount;

      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      const resyncsBefore = subscriberResyncs();
      publisher.disconnect();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 21,
        reason: 'written while the publisher was down',
      }).expect(200);

      // The write succeeded and the api is correct; the worker is not, and
      // nothing has happened that could tell it so.
      expect(await workerConfiguration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      await publisher.connect();

      await eventually(
        () => workerConfiguration.get<number>(REWARDS_HOLD_PERIOD_DAYS.key),
        (value) => value === 21,
        'the recovered publisher to announce what it could not send',
      );

      /*
       * The assertion that makes this a different test from the reconnect one.
       * If the worker's subscriber had dropped, D61 would have healed this and
       * D64 would be untested.
       */
      expect(subscriberResyncs()).toBe(resyncsBefore);
    });
  });

  // --- Helpers -------------------------------------------------------------

  /**
   * Waits for a value to become what it should, rather than sleeping.
   *
   * Propagation is asynchronous by nature — a Redis round trip and a
   * `setImmediate` apart — so a fixed sleep is either flaky or slow, and there
   * is no callback to await. Polling to a deadline is the honest shape; the
   * deadline is generous because a *slow* propagation is a different finding
   * from a broken one, and this assertion is about the second.
   */
  async function eventually<T>(
    read: () => Promise<T> | T,
    matches: (value: T) => boolean,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + 5_000;
    let last: T = await read();

    while (Date.now() < deadline) {
      last = await read();
      if (matches(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Timed out waiting for ${what}. Last value: ${JSON.stringify(last)}`);
  }

  function server() {
    return api.getHttpServer();
  }

  interface Caller {
    id: string;
    token: string;
  }

  async function createAdmin(): Promise<Caller> {
    const email = nextEmail();

    const registration = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    await prisma.user.update({
      where: { id: registration.body.user.id },
      data: { role: 'ADMIN' },
    });

    const login = await request(server()).post('/auth/login').send({ email, password }).expect(200);

    return { id: registration.body.user.id, token: login.body.accessToken };
  }

  function set(
    caller: Caller,
    key: string,
    body: { value: unknown; scope?: string; scopeId?: string; reason: string },
  ) {
    return request(server())
      .put(`/admin/configuration/${key}`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send(body);
  }

  function reset(caller: Caller, key: string, body: { reason: string }) {
    return request(server())
      .post(`/admin/configuration/${key}/reset`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send(body);
  }
});
