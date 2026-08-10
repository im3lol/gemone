import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { ERROR_CODES, POSTBACK_STATES, SYNC_MODES } from '@gemone/contracts';
import type { Queue } from 'bullmq';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { QUEUES } from '../../src/core/queue/queue.constants';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';

/**
 * The public postback surface over HTTP — ARCHITECTURE.md §10.2, §19.1.
 *
 * §10.2's status codes are chosen for provider *retry behaviour* rather than
 * REST purity, and a status code is not something a service test can verify:
 * it is produced by the exception filter, the framework's defaults, and the
 * controller's own annotations together. This file is where that table is
 * actually asserted.
 */
describe('postback surface (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;
  let queue: Queue;

  let providerId: string;

  const SECRET = process.env.PROVIDER_MOCK_SECRET ?? 'mock-fixture-secret';
  const password = 'correct-horse-battery-staple';

  let counter = 0;
  const nextEmail = () => `postback-http-${++counter}.${Date.now()}@example.com`;
  const nextTransactionId = () => `TX-HTTP-${Date.now()}-${++counter}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // `rawBody` matches main.ts: a provider that signs its body signs the
    // bytes, and a test app without it would exercise a different pipeline.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    providers = app.get(ProvidersService);
    catalog = app.get(CatalogSyncService);
    configuration = app.get(ConfigurationService);
    queue = app.get<Queue>(getQueueToken(QUEUES.POSTBACKS));
  });

  afterAll(async () => {
    // Every accepted postback enqueues a job, and nothing consumes this queue
    // yet. Left behind, they are residue the next run counts as its own.
    await queue?.obliterate({ force: true }).catch(() => undefined);
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
    await queue.obliterate({ force: true }).catch(() => undefined);

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
    await catalog.sync(providerId, SYNC_MODES.FULL);
  });

  const server = () => app.getHttpServer();

  /** Signs as the adapter verifies: sorted `key=value`, excluding `sig`. */
  function sign(query: Record<string, string>): Record<string, string> {
    const canonical = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');

    return { ...query, sig: createHmac('sha256', SECRET).update(canonical).digest('hex') };
  }

  function conversionQuery(overrides: Record<string, string> = {}): Record<string, string> {
    return sign({
      campaign_id: 'MK-100241',
      currency: 'USD',
      event_time: '2026-08-02T10:00:00Z',
      payout: '2.45',
      reversed: '0',
      status: '1',
      sub_id: 'not-resolved-at-intake',
      transaction_id: nextTransactionId(),
      ...overrides,
    });
  }

  async function createAdmin() {
    const email = nextEmail();
    await request(server()).post('/auth/register').send({ email, password }).expect(201);
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });

    const login = await request(server())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return { token: login.body.accessToken as string };
  }

  // --- §10.2, the table ----------------------------------------------------

  describe('response codes, chosen around provider retry behaviour', () => {
    it('accepts with 200, not 201', async () => {
      /*
       * Nest answers a POST with 201 by default. Some networks treat anything
       * other than a literal 200 as a failed delivery and retry it — which
       * manufactures exactly the duplicates the constraint then has to
       * absorb.
       */
      const response = await request(server())
        .post('/postback/mock')
        .query(conversionQuery())
        .expect(200);

      expect(response.body).toEqual({ status: 'accepted' });
    });

    it('answers a duplicate with 200', async () => {
      const query = conversionQuery();

      await request(server()).post('/postback/mock').query(query).expect(200);

      // It was already processed. A 4xx would make some providers retry and
      // others open a support ticket.
      const repeat = await request(server())
        .post('/postback/mock')
        .query(query)
        .expect(200);

      expect(repeat.body).toEqual({ status: 'duplicate' });
    });

    it('answers a bad signature with 401', async () => {
      // Genuinely rejected, and it must be visible in provider dashboards.
      const response = await request(server())
        .post('/postback/mock')
        .query({ ...conversionQuery(), sig: 'f'.repeat(64) })
        .expect(401);

      expect(response.body.error.code).toBe(ERROR_CODES.POSTBACK_SIGNATURE_INVALID);
    });

    it('answers a source outside the allowlist with 403', async () => {
      await providers.update(providerId, { postbackIpRanges: ['198.51.100.0/24'] });

      const response = await request(server())
        .post('/postback/mock')
        .query(conversionQuery())
        .expect(403);

      expect(response.body.error.code).toBe(ERROR_CODES.POSTBACK_SOURCE_NOT_ALLOWED);
    });

    it('answers a malformed payload with 400', async () => {
      // Retrying identical malformed input is pointless.
      const response = await request(server())
        .post('/postback/mock')
        .query(sign({ campaign_id: 'MK-100241' }))
        .expect(400);

      expect(response.body.error.code).toBe(ERROR_CODES.POSTBACK_PAYLOAD_INVALID);
    });

    it('answers an unknown endpoint with 404', async () => {
      await request(server())
        .post('/postback/no-such-network')
        .query(conversionQuery())
        .expect(404);
    });

    it('never answers 5xx for input it simply refuses', async () => {
      /*
       * §10.2's governing principle: return 5xx only when a retry could
       * plausibly succeed. Every other 5xx manufactures duplicates we then
       * have to deduplicate.
       */
      const refusals = [
        request(server()).post('/postback/mock').query({ sig: 'nope' }),
        request(server()).post('/postback/unknown').query(conversionQuery()),
        request(server()).post('/postback/mock').send('not-even-a-query'),
        request(server()).get('/postback/mock'),
      ];

      for (const response of await Promise.all(refusals)) {
        expect(response.status).toBeLessThan(500);
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  // --- The surface itself --------------------------------------------------

  describe('the endpoint', () => {
    it('needs no authentication', async () => {
      /*
       * Unauthenticated by *necessity* (§19.2) — providers cannot hold our
       * credentials. Every other endpoint is protected by the global guard,
       * so this asserts the opt-out is actually in place rather than assumed.
       */
      await request(server()).post('/postback/mock').query(conversionQuery()).expect(200);
    });

    it('accepts GET as readily as POST', async () => {
      // Some networks send a query string, some a form body. An endpoint that
      // accepts one shape is one half the integrations cannot use.
      await request(server()).get('/postback/mock').query(conversionQuery()).expect(200);

      expect(await prisma.providerPostback.count()).toBe(1);
    });

    it('accepts a form-encoded body', async () => {
      const query = conversionQuery();

      await request(server())
        .post('/postback/mock')
        .query(query)
        .type('form')
        .send({ note: 'delivered' })
        .expect(200);

      const stored = await prisma.providerPostback.findFirstOrThrow();
      expect(stored.payload).toMatchObject({ body: { note: 'delivered' } });
    });

    it('does not reject unknown parameters the way every other endpoint does', async () => {
      /*
       * §19.3 rejects unknown properties everywhere else. Here they *are* the
       * payload: a provider adding a field would otherwise make every
       * conversion fail validation for a field nobody needed. Validation is
       * the adapter's `parsePostback`, which is strict about what it requires
       * and indifferent to what it does not.
       */
      await request(server())
        .post('/postback/mock')
        .query({ ...conversionQuery(), an_unexpected_new_field: 'whatever' })
        .expect(401); // the signature no longer covers the extra field...

      const query = conversionQuery({ an_unexpected_new_field: 'whatever' });
      await request(server()).post('/postback/mock').query(query).expect(200);
    });

    it('resolves the slug case-insensitively', async () => {
      await request(server()).post('/postback/MOCK').query(conversionQuery()).expect(200);
    });
  });

  describe('client IP resolution', () => {
    beforeEach(async () => {
      await providers.update(providerId, { postbackIpRanges: ['203.0.113.0/24'] });
    });

    it('ignores X-Forwarded-For when nothing is trusted in front', async () => {
      /*
       * The security property. If a header any caller can send decided the
       * source address, the allowlist would be a check the attacker passes by
       * typing — which is worse than having no allowlist, because it reads as
       * configured.
       */
      await request(server())
        .post('/postback/mock')
        .set('X-Forwarded-For', '203.0.113.10')
        .query(conversionQuery())
        .expect(403);
    });

    it('uses X-Forwarded-For once a proxy is trusted', async () => {
      app.getHttpAdapter().getInstance().set('trust proxy', 1);

      // Behind Caddy this is the only way the provider's address reaches us.
      await request(server())
        .post('/postback/mock')
        .set('X-Forwarded-For', '203.0.113.10')
        .query(conversionQuery())
        .expect(200);

      const stored = await prisma.providerPostback.findFirstOrThrow();
      expect(stored.sourceIp).toBe('203.0.113.10');
    });
  });

  // --- The admin surface ---------------------------------------------------

  describe('the admin surface', () => {
    it('refuses a regular user', async () => {
      const email = nextEmail();
      const registration = await request(server())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const auth = { Authorization: `Bearer ${registration.body.accessToken}` };

      // The raw payload is a provider's own data and never appears on a
      // user-facing surface (§15.3).
      await request(server()).get('/admin/postbacks').set(auth).expect(403);
      await request(server())
        .get('/admin/postbacks/0192f0a0-0000-7000-8000-0000000000aa')
        .set(auth)
        .expect(403);
    });

    it('shows an investigator the raw payload', async () => {
      const query = conversionQuery();
      await request(server()).post('/postback/mock').query(query).expect(200);

      const admin = await createAdmin();
      const stored = await prisma.providerPostback.findFirstOrThrow();

      const response = await request(server())
        .get(`/admin/postbacks/${stored.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.providerSlug).toBe('mock');
      expect(response.body.externalTransactionId).toBe(query.transaction_id);
      expect(response.body.payload.query.transaction_id).toBe(query.transaction_id);
    });

    it('filters the quarantine and rejection queues by state', async () => {
      await request(server()).post('/postback/mock').query(conversionQuery()).expect(200);
      await request(server())
        .post('/postback/mock')
        .query(sign({ campaign_id: 'MK-100241' }))
        .expect(400);

      const admin = await createAdmin();
      const auth = { Authorization: `Bearer ${admin.token}` };

      // "Show me what could not be read" is the first question on this screen.
      const rejected = await request(server())
        .get(`/admin/postbacks?state=${POSTBACK_STATES.REJECTED}`)
        .set(auth)
        .expect(200);

      expect(rejected.body.total).toBe(1);
      expect(rejected.body.items[0].errorDetail).toContain('sub_id');

      const received = await request(server())
        .get(`/admin/postbacks?state=${POSTBACK_STATES.RECEIVED}`)
        .set(auth)
        .expect(200);

      expect(received.body.total).toBe(1);
    });

    it('rejects an unknown state instead of ignoring the filter', async () => {
      const admin = await createAdmin();

      // A filter silently dropped returns everything, which on a quarantine
      // screen reads as "nothing is quarantined".
      await request(server())
        .get('/admin/postbacks?state=NONSENSE')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(422);
    });

    it('keeps the payload off the list view', async () => {
      await request(server()).post('/postback/mock').query(conversionQuery()).expect(200);
      const admin = await createAdmin();

      const response = await request(server())
        .get('/admin/postbacks')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.items[0].payload).toBeUndefined();
      expect(response.body.items[0].externalTransactionId).toBeDefined();
    });

    it('has no endpoint that can change or remove a postback', async () => {
      await request(server()).post('/postback/mock').query(conversionQuery()).expect(200);

      const admin = await createAdmin();
      const auth = { Authorization: `Bearer ${admin.token}` };
      const stored = await prisma.providerPostback.findFirstOrThrow();

      /*
       * DATABASE.md §3.4: rows are never deleted or edited. They are the
       * replay source when processing has a bug and the evidence in a
       * provider dispute — an admin who could edit one could change what a
       * provider is recorded as having sent, which is the fact a dispute
       * turns on.
       */
      await request(server()).delete(`/admin/postbacks/${stored.id}`).set(auth).expect(404);
      await request(server())
        .patch(`/admin/postbacks/${stored.id}`)
        .set(auth)
        .send({ state: POSTBACK_STATES.PROCESSED })
        .expect(404);

      const unchanged = await prisma.providerPostback.findUniqueOrThrow({
        where: { id: stored.id },
      });
      expect(unchanged.state).toBe(POSTBACK_STATES.RECEIVED);
    });
  });
});
