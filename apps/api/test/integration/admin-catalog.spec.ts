import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ADMIN_ACTIONS, ERROR_CODES, SYNC_MODES } from '@gemone/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { QUEUES } from '../../src/core/queue/queue.constants';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';

/**
 * The catalog administration surface, end to end — including the queue.
 *
 * Uses a real Redis (§18.3). The behaviour worth verifying is not that an
 * endpoint returns 200: it is that the sync request is *enqueued* rather than
 * run inline, that an offer cannot be pulled by someone who is not an admin,
 * and that pulling one is recorded.
 */
describe('admin catalog surface (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let queue: Queue;

  let providerId: string;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `catalog-admin-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    providers = app.get(ProvidersService);
    catalog = app.get(CatalogSyncService);
    queue = app.get<Queue>(getQueueToken(QUEUES.CATALOG));
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await app?.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    // Clicks reference users, offers and providers, so they go first.
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
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.provider.deleteMany();

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
  });

  const server = () => app.getHttpServer();

  async function createUser(role: 'USER' | 'ADMIN' = 'USER') {
    const email = nextEmail();
    const response = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
      const relogin = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return { id: relogin.body.user.id, token: relogin.body.accessToken };
    }

    return { id: response.body.user.id, token: response.body.accessToken };
  }

  describe('role-based authorization', () => {
    it('protects every catalog endpoint', async () => {
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${user.token}` };
      const id = '0192f0a0-0000-7000-8000-0000000000aa';

      // Declared on the controller so a new endpoint is protected by default;
      // this is what keeps that true as endpoints are added.
      await request(server()).get('/admin/catalog/offers').set(auth).expect(403);
      await request(server()).get('/admin/catalog/sync-runs').set(auth).expect(403);
      await request(server()).get(`/admin/catalog/offers/${id}`).set(auth).expect(403);
      await request(server())
        .patch(`/admin/catalog/offers/${id}/active`)
        .set(auth)
        .send({ active: false, reason: 'testing access control' })
        .expect(403);
      await request(server())
        .post(`/admin/catalog/providers/${providerId}/sync`)
        .set(auth)
        .send({ mode: SYNC_MODES.FULL })
        .expect(403);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      await request(server()).get('/admin/catalog/offers').expect(401);
    });
  });

  describe('browsing the catalog', () => {
    it('lists synchronized offers with their provider slug', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get('/admin/catalog/offers')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.total).toBe(2);
      expect(response.body.items[0].providerSlug).toBe('mock');
      // The reward the user would see, alongside what the provider pays us.
      expect(response.body.items[0].rewardPoints).toBeGreaterThan(0);
    });

    it('filters by active state and by country', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };

      const gb = await request(server())
        .get('/admin/catalog/offers?country=GB')
        .set(auth)
        .expect(200);
      expect(gb.body.items).toHaveLength(1);

      const inactive = await request(server())
        .get('/admin/catalog/offers?isActive=false')
        .set(auth)
        .expect(200);
      expect(inactive.body.items).toEqual([]);
    });

    it('resolves /sync-runs as a route, not as an offer id', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');

      // Route order matters: declared after `offers/:id`, this path would be
      // parsed as an offer id and rejected as a malformed UUID.
      const response = await request(server())
        .get('/admin/catalog/sync-runs')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].mode).toBe(SYNC_MODES.FULL);
      expect(response.body.items[0].providerSlug).toBe('mock');
    });

    it('rejects a malformed offer id with 422, not 400', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .get('/admin/catalog/offers/not-a-uuid')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(422);
    });
  });

  describe('activation', () => {
    it('deactivates an offer, records the reason, and marks the source ADMIN', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');
      const offer = await prisma.offer.findFirstOrThrow();

      const response = await request(server())
        .patch(`/admin/catalog/offers/${offer.id}/active`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ active: false, reason: 'advertiser reported a broken landing page' })
        .expect(200);

      expect(response.body.isActive).toBe(false);
      expect(response.body.deactivationSource).toBe('ADMIN');

      const audit = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' } });
      expect(audit[0]!.action).toBe(ADMIN_ACTIONS.OFFER_DEACTIVATED);
      expect(audit[0]!.reason).toBe('advertiser reported a broken landing page');
    });

    it('demands a reason', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');
      const offer = await prisma.offer.findFirstOrThrow();

      const response = await request(server())
        .patch(`/admin/catalog/offers/${offer.id}/active`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ active: false })
        .expect(422);

      expect(response.body.error.fields[0].field).toBe('reason');
    });

    it('writes no audit entry when the transition is refused', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');
      const offer = await prisma.offer.findFirstOrThrow();
      await prisma.adminAuditLog.deleteMany();

      // Already active.
      const response = await request(server())
        .patch(`/admin/catalog/offers/${offer.id}/active`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ active: true, reason: 'a redundant change' })
        .expect(409);

      expect(response.body.error.code).toBe(ERROR_CODES.OFFER_INVALID_STATE_TRANSITION);
      // An audit trail describing a change that did not happen is worse than
      // no entry at all.
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('has no delete endpoint', async () => {
      await catalog.sync(providerId, SYNC_MODES.FULL);
      const admin = await createUser('ADMIN');
      const offer = await prisma.offer.findFirstOrThrow();

      // Clicks will reference offers, so removal is `isActive = false`.
      await request(server())
        .delete(`/admin/catalog/offers/${offer.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404);
    });
  });

  describe('requesting a sync', () => {
    it('enqueues the work instead of running it inline', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .post(`/admin/catalog/providers/${providerId}/sync`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ mode: SYNC_MODES.FULL })
        .expect(201);

      expect(response.body).toEqual({ enqueued: true, providerId, mode: SYNC_MODES.FULL });

      /*
       * The API accepted the job and did not do the work. Running a sync in
       * the request would hold the connection open for as long as a provider
       * takes to answer, put that latency on the API's event loop, and lose
       * the work if the admin closed the tab (§1.2).
       */
      const waiting = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(waiting.map((job) => job.name)).toContain('catalog-sync');
      expect(waiting[0]!.data).toMatchObject({ providerId, requestedBy: admin.id });

      // Nothing was synced by the request itself.
      expect(await prisma.offer.count()).toBe(0);
    });

    it('records the request as an administrative act', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .post(`/admin/catalog/providers/${providerId}/sync`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ mode: SYNC_MODES.INCREMENTAL })
        .expect(201);

      const audit = await prisma.adminAuditLog.findMany();
      // The *request* is the administrative act; what the sync then did is
      // recorded by the run.
      expect(audit[0]!.action).toBe(ADMIN_ACTIONS.CATALOG_SYNC_REQUESTED);
      expect(audit[0]!.after).toEqual({ mode: SYNC_MODES.INCREMENTAL });
    });

    it('enqueues a second request rather than deduplicating it', async () => {
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .post(`/admin/catalog/providers/${providerId}/sync`)
        .set(auth)
        .send({ mode: SYNC_MODES.FULL })
        .expect(201);
      await request(server())
        .post(`/admin/catalog/providers/${providerId}/sync`)
        .set(auth)
        .send({ mode: SYNC_MODES.FULL })
        .expect(201);

      /*
       * Unlike the scheduled path, which deduplicates by job id. A repeated
       * tick is an accident; an admin pressing the button twice is a decision
       * — they saw the first result and want another run. Discarding it would
       * look exactly like the button being broken.
       */
      expect(await queue.getJobs(['waiting', 'delayed', 'active'])).toHaveLength(2);
    });

    it('rejects an unknown mode', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .post(`/admin/catalog/providers/${providerId}/sync`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ mode: 'SORT_OF' })
        .expect(422);
    });

    it('404s for a provider that does not exist, without enqueueing', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .post('/admin/catalog/providers/0192f0a0-0000-7000-8000-0000000000ff/sync')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ mode: SYNC_MODES.FULL })
        .expect(404);

      expect(await queue.getJobs(['waiting', 'delayed', 'active'])).toHaveLength(0);
    });
  });
});
