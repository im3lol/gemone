import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  CONVERSION_STATUSES,
  POSTBACK_STATES,
  QUARANTINE_REASONS,
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
import { POSTBACK_JOBS, QUEUES } from '../../src/core/queue/queue.constants';
import { CatalogSyncProcessor } from '../../src/jobs/catalog-sync.processor';
import { PostbackProcessProcessor } from '../../src/jobs/postback-process.processor';
import { ConversionsService } from '../../src/modules/conversions/conversions.service';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { WorkerModule } from '../../src/worker.module';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * The whole chain, from a provider's HTTP request to a conversion row.
 *
 * Everything else tests a stage. This is the seam test: a real postback over
 * HTTP, a real job on a real queue, and the worker's own processor turning it
 * into a conversion — plus the admin surface that has to be able to explain
 * the result afterwards.
 *
 * The `WorkerModule` is used deliberately. It is the only module graph that
 * loads the processor at all (§1.2), so a test against `AppModule` would pass
 * with the consumer missing — which is exactly the failure this file exists to
 * catch.
 */
describe('conversion processing over the wire (integration)', () => {
  let app: INestApplication;
  let worker: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;
  let conversions: ConversionsService;
  let processor: PostbackProcessProcessor;
  let queue: Queue;

  let providerId: string;
  let offerId: string;

  const SECRET = process.env.PROVIDER_MOCK_SECRET ?? 'mock-fixture-secret';
  const password = 'correct-horse-battery-staple';

  let counter = 0;
  const nextEmail = () => `conv-http-${++counter}.${Date.now()}@example.com`;
  const nextTransactionId = () => `TX-E2E-${Date.now()}-${++counter}`;

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
    queue = app.get<Queue>(getQueueToken(QUEUES.POSTBACKS));

    conversions = worker.get(ConversionsService);
    processor = worker.get(PostbackProcessProcessor);

    /*
     * The worker's BullMQ consumer is shut down, and the processor is driven
     * directly below.
     *
     * A live consumer races every assertion in this file: it drains the queue
     * on its own schedule, so "the job was enqueued" and "the job produced a
     * conversion" collapse into the same flaky observation — the first run of
     * this file failed exactly that way. Closing the *Queue* is not enough;
     * `@Processor` starts a BullMQ **Worker**, which is what has to stop.
     *
     * The delivery leg is still asserted, by checking the job and its payload
     * before running it (TODO T11 tracks automating a live-consumer run).
     */
    await processor.worker.waitUntilReady();
    await processor.worker.close().catch(() => undefined);

    /*
     * The catalog consumer goes too, for a reason that took a suite run to
     * surface: `WorkerModule` also registers the repeatable `catalog-tick`,
     * and a tick firing mid-test synchronizes the provider — creating offers
     * and sync runs *between* this file's cleanup statements, so
     * `provider.deleteMany()` then fails on a foreign key it had just cleared.
     *
     * It passed in isolation and failed in the suite, because the schedule
     * lives in Redis and survives from whichever file booted a worker first.
     */
    const catalogProcessor = worker.get(CatalogSyncProcessor);
    await catalogProcessor.worker.waitUntilReady();
    await catalogProcessor.worker.close().catch(() => undefined);
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
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
    await catalog.sync(providerId, SYNC_MODES.FULL);

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

  function postbackQuery(overrides: Record<string, string> = {}): Record<string, string> {
    return sign({
      campaign_id: 'MK-100241',
      currency: 'USD',
      event_time: '2026-08-02T12:00:00Z',
      payout: '2.45',
      reversed: '0',
      status: '1',
      sub_id: 'placeholder',
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

  /** A real click over HTTP, so the `sub_id` is signed by the running key. */
  async function click(token: string) {
    const response = await request(server())
      .post('/clicks')
      .set('Authorization', `Bearer ${token}`)
      .send({ offerId })
      .expect(201);

    return response.body as { id: string; subId: string; rewardPoints: number };
  }

  /** Runs the queued job through the worker's own processor. */
  async function drain(): Promise<unknown[]> {
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    const results: unknown[] = [];

    for (const job of jobs) {
      results.push(await processor.process(job as Job));
    }

    return results;
  }

  // --- The whole chain -----------------------------------------------------

  describe('a user clicks, a provider reports, points are owed', () => {
    it('carries a click through to a conversion', async () => {
      const user = await createUser();
      const clicked = await click(user.token);

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery({ sub_id: clicked.subId }))
        .expect(200);

      const stored = await prisma.providerPostback.findFirstOrThrow();
      const queued = await queue.getJobs(['waiting', 'delayed']);

      // The delivery leg: one job, naming the row that was just archived.
      expect(queued).toHaveLength(1);
      expect((queued[0] as Job).name).toBe(POSTBACK_JOBS.PROCESS);
      expect((queued[0] as Job).data.postbackId).toBe(stored.id);

      await drain();

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.clickId).toBe(clicked.id);
      expect(conversion.userId).toBe(user.id);
      expect(conversion.status).toBe(CONVERSION_STATUSES.CREDITED);
      expect(conversion.rewardPoints).toBe(171);

      // And the promise the user was shown is still reachable, unchanged, for
      // the promised-versus-paid question this whole chain exists to answer.
      expect(clicked.rewardPoints).toBe(171);
    });

    it('leaves the postback processed and the queue empty', async () => {
      const user = await createUser();
      const clicked = await click(user.token);

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery({ sub_id: clicked.subId }))
        .expect(200);
      await drain();

      const stored = await prisma.providerPostback.findFirstOrThrow();
      expect(stored.state).toBe(POSTBACK_STATES.PROCESSED);
    });

    it('does not enqueue a second job for a duplicate delivery', async () => {
      const user = await createUser();
      const clicked = await click(user.token);
      const query = postbackQuery({ sub_id: clicked.subId });

      await request(server()).post('/postback/mock').query(query).expect(200);
      await request(server()).post('/postback/mock').query(query).expect(200);

      // Two deliveries, one event, one job, one conversion. Each layer refuses
      // the duplicate on its own terms.
      expect(await queue.getJobs(['waiting', 'delayed'])).toHaveLength(1);

      await drain();
      expect(await prisma.conversion.count()).toBe(1);
    });

    it('quarantines a postback for a sub_id nobody issued, end to end', async () => {
      // The provider is answered 200 — the delivery was fine, the attribution
      // is not — and a human is left something to look at (§10.2).
      await request(server())
        .post('/postback/mock')
        .query(postbackQuery({ sub_id: 'AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB' }))
        .expect(200);

      await drain();

      const stored = await prisma.providerPostback.findFirstOrThrow();
      expect(stored.state).toBe(POSTBACK_STATES.QUARANTINED);
      expect(stored.errorDetail).toBe(QUARANTINE_REASONS.SUB_ID_INVALID);
      expect(await prisma.conversion.count()).toBe(0);
    });
  });

  describe('the worker refuses work it does not recognise', () => {
    it('throws on an unknown job name rather than completing it', async () => {
      // A job name nobody handles, marked completed, is the quietest possible
      // way for conversions to stop being recorded.
      await expect(
        processor.process({ name: 'not-a-real-job', data: {} } as Job),
      ).rejects.toThrow(/Unknown postback job/);
    });
  });

  // --- The admin surface ---------------------------------------------------

  describe('the admin surface', () => {
    async function convertOne() {
      const user = await createUser();
      const clicked = await click(user.token);
      await request(server())
        .post('/postback/mock')
        .query(postbackQuery({ sub_id: clicked.subId }))
        .expect(200);
      await drain();

      return { user, clicked };
    }

    it('refuses a regular user', async () => {
      const user = await createUser();
      const auth = { Authorization: `Bearer ${user.token}` };

      await request(server()).get('/admin/conversions').set(auth).expect(403);
      await request(server())
        .get('/admin/conversions/0192f0a0-0000-7000-8000-0000000000aa')
        .set(auth)
        .expect(403);
    });

    it('explains a conversion completely enough to answer a dispute', async () => {
      const { user, clicked } = await convertOne();
      const admin = await createUser('ADMIN');
      const conversion = await prisma.conversion.findFirstOrThrow();

      const response = await request(server())
        .get(`/admin/conversions/${conversion.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      /*
       * Everything needed to answer "I completed this and was not paid what I
       * was promised": who, which click, which raw postback, what the provider
       * paid, what rule turned that into points.
       */
      expect(response.body.userId).toBe(user.id);
      expect(response.body.clickId).toBe(clicked.id);
      expect(response.body.providerSlug).toBe('mock');
      expect(response.body.payoutAmountMinor).toBe(245);
      expect(response.body.providerStatus).toBe('confirmed');
      expect(response.body.rewardPoints).toBe(171);
      expect(response.body.pointsPerMinorUnit).toBe(1);
      expect(response.body.rewardSharePercent).toBe(70);
      expect(response.body.postbackId).toBeDefined();

      // And the raw bytes are one hop away, on a surface an admin already has.
      await request(server())
        .get(`/admin/postbacks/${response.body.postbackId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
    });

    it('filters the review queue by status', async () => {
      await convertOne();
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };

      const attributed = await request(server())
        .get(`/admin/conversions?status=${CONVERSION_STATUSES.CREDITED}`)
        .set(auth)
        .expect(200);
      expect(attributed.body.total).toBe(1);

      const held = await request(server())
        .get(`/admin/conversions?status=${CONVERSION_STATUSES.HELD}`)
        .set(auth)
        .expect(200);
      expect(held.body.total).toBe(0);
    });

    it('rejects an unknown status instead of ignoring the filter', async () => {
      const admin = await createUser('ADMIN');

      // A filter silently dropped returns everything, which on a review queue
      // reads as "nothing needs reviewing".
      await request(server())
        .get('/admin/conversions?status=NONSENSE')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(422);
    });

    it('has no endpoint that can change or remove a conversion', async () => {
      await convertOne();
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };
      const conversion = await prisma.conversion.findFirstOrThrow();

      /*
       * A conversion is what a user is owed for work they did, and the reward
       * flow has not even credited it yet. An admin who could edit one could
       * change what they are owed.
       */
      await request(server())
        .delete(`/admin/conversions/${conversion.id}`)
        .set(auth)
        .expect(404);
      await request(server())
        .patch(`/admin/conversions/${conversion.id}`)
        .set(auth)
        .send({ status: CONVERSION_STATUSES.CREDITED })
        .expect(404);

      const unchanged = await prisma.conversion.findUniqueOrThrow({
        where: { id: conversion.id },
      });
      expect(unchanged.status).toBe(CONVERSION_STATUSES.CREDITED);
    });

    it('exposes no conversion endpoint to the user it belongs to, yet', async () => {
      const { user } = await convertOne();

      /*
       * Deliberate. What a user wants to know about a conversion is what it
       * paid them, and that answer does not exist until the reward flow does
       * (TODO T25). An endpoint returning points that have not been credited
       * would promise a balance nobody can spend.
       */
      await request(server())
        .get('/conversions/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
    });
  });

  // --- Nothing is lost -----------------------------------------------------

  describe('replayability', () => {
    it('turns an unattributable postback into a conversion once the click exists', async () => {
      const user = await createUser();
      const clicked = await click(user.token);

      // Quarantined for a reason that later stopped being true — the shape a
      // restore-then-reprocess leaves behind.
      await prisma.click.update({
        where: { id: clicked.id },
        data: { attributionExpiresAt: new Date(Date.now() - 1000) },
      });

      await request(server())
        .post('/postback/mock')
        .query(postbackQuery({ sub_id: clicked.subId }))
        .expect(200);
      await drain();

      const quarantined = await prisma.providerPostback.findFirstOrThrow();
      expect(quarantined.state).toBe(POSTBACK_STATES.QUARANTINED);

      /*
       * The archive kept everything, so an admin extending the window and
       * putting the row back into RECEIVED is a complete recovery — no
       * re-delivery from the provider, no lost conversion.
       */
      await prisma.click.update({
        where: { id: clicked.id },
        data: { attributionExpiresAt: new Date(Date.now() + 86_400_000) },
      });
      await prisma.providerPostback.update({
        where: { id: quarantined.id },
        data: { state: POSTBACK_STATES.RECEIVED },
      });

      const result = await conversions.process(quarantined.id);

      expect(result.outcome).toBe('converted');
      expect(await prisma.conversion.count()).toBe(1);
    });
  });
});
